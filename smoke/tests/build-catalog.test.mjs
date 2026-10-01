import http from 'node:http';
import {main} from '../scripts/smoke.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseGitHubResponse,githubCatalogClient,enrichPRAuthors,buildPRReferences,mergeCatalogBuilds} from '../build-catalog.mjs';
import {findBuilds} from '../builds.mjs';

test('GitHub validators retain unchanged metadata and reuse PR authors without downloading them again',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'build-etag-'));let requests=0;
 try{
  const response=parseGitHubResponse('HTTP/2.0 200 OK\nEtag: W/"first"\r\n\r\n{"user":{"login":"author"}}');assert.equal(response.etag,'W/"first"');
  assert.equal(parseGitHubResponse('HTTP/2.0 304 Not Modified\nEtag: W/"first"\r\n\r\n').status,304);
  const request=async(endpoint,etag)=>{requests++;assert.equal(endpoint,'repos/story-wizard/wizard/pulls/123');if(requests===1){assert.equal(etag,undefined);return response;}assert.equal(etag,'W/"first"');return {status:304};};
  const get=githubCatalogClient(root,request);assert.equal((await get('repos/story-wizard/wizard/pulls/123')).user.login,'author');
  const fresh=githubCatalogClient(root,request);assert.equal((await fresh('repos/story-wizard/wizard/pulls/123')).user.login,'author');assert.equal(fresh.stats.unchanged,1);
  assert.equal((await fresh('repos/story-wizard/wizard/pulls/123',{stable:true})).user.login,'author');assert.equal(requests,2);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('PR author filtering uses all referenced component PRs, independent of the workflow requester',async()=>{
 const build={tag:'vfeature-wizard-123-core-wizard-core-456',releaseNotes:'See https://github.com/story-wizard/wizard/pull/123 and https://github.com/story-wizard/wizard-ai/pull/789',requestedBy:'automation-account'};
 assert.equal(buildPRReferences(build).length,3);
 const builds=await enrichPRAuthors([build,build],async endpoint=>({user:{login:endpoint.includes('wizard-core')?'core-author':'app-author'},html_url:'https://github.com/example'}));
 assert.deepEqual(builds[0].prAuthors,['app-author','core-author']);assert.equal(builds[0].requestedBy,'automation-account');assert.equal(builds[0].pullRequests.length,3);assert.equal(builds[0].authorStatus,'Complete');
 const failed=await enrichPRAuthors([build],async()=>{throw Error('offline');});assert.deepEqual(failed[0].prAuthors,[]);assert.equal(failed[0].authorStatus,'Unknown');
});

test('durable catalog survives reopening, refreshes explicitly, and preserves prior data when GitHub is unavailable',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'build-catalog-')),calls=[];
 let title='Original';
 const get=async endpoint=>{calls.push(endpoint);if(endpoint==='user')return {login:'app-author'};if(endpoint.includes('/releases?'))return [{tag_name:'vfeature-wizard-123',name:title,body:'<!-- wizard-build: abc123 run:101 -->',published_at:'2026-10-01',author:{login:'github-actions[bot]'},assets:[{id:1,name:'Wizard-macOS.zip',size:123}]}];if(endpoint.includes('/runs?'))return {workflow_runs:[{id:101,actor:{login:'automation-account'}}]};if(endpoint.endsWith('/pulls/123'))return {user:{login:'app-author'}};throw Error(endpoint);};
 try{
  let result=await findBuilds(root,{get});assert.deepEqual(result.builds[0].prAuthors,['app-author']);assert.equal(result.currentUser,'app-author');assert.equal(result.builds[0].requestedBy,'automation-account');
  const retained=JSON.parse(await readFile(result.catalogPath));assert.equal(retained.format,'wizard-build-catalog/v1');assert.equal(retained.currentUser,undefined);assert.equal(retained.builds[0].app,undefined,'Shared catalog must not store machine-local app paths');
  calls.length=0;result=await findBuilds(root,{get});assert.deepEqual(calls,['user']);assert.equal(result.builds[0].label,'Original');
  title='Updated';result=await findBuilds(root,{get,refresh:true});assert.equal(result.builds[0].label,'Updated');
  result=await findBuilds(root,{get:async()=>{throw Error('offline');},refresh:true});assert.equal(result.builds[0].label,'Updated');assert.match(result.refreshError,/retained/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('incremental catalog merges preserve historical builds and consumer annotations',()=>{
 const old={assetId:1,channel:'Tagged',publishedAt:'2026-09-01',label:'Old',annotations:{tester:'review'}},incoming={assetId:2,channel:'Nightly',publishedAt:'2026-10-01',label:'New'};
 const merged=mergeCatalogBuilds([old],[incoming]);assert.deepEqual(merged.map(b=>b.assetId),[2,1]);assert.equal(merged[1].listedRecently,false);
 const updated=mergeCatalogBuilds(merged,[{...old,label:'Renamed',annotations:undefined}]);assert.equal(updated[1].label,'Renamed');assert.deepEqual(updated[1].annotations,{tester:'review'});
});

test('agent author selection includes mixed-author builds and ignores requester-only matches',async()=>{
 const requests=[],server=http.createServer((req,res)=>{requests.push(req.url);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({currentUser:'MyUser',builds:[{assetId:1,prAuthors:['MyUser','OtherUser'],requestedBy:'bot'},{assetId:2,prAuthors:['OtherUser'],requestedBy:'MyUser'}]}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{let r=await main(['builds','--author','me','--refresh','--server',base]);assert.deepEqual(r.result.builds.map(b=>b.assetId),[1]);assert.equal(requests[0],'/api/builds?refresh=1');r=await main(['builds','--author','myuser,otheruser','--server',base]);assert.deepEqual(r.result.builds.map(b=>b.assetId),[1,2]);}finally{await new Promise(resolve=>server.close(resolve));}
});

test('agent runtime import accepts an installed tools configuration without forwarding harness metadata',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'tools-config-'));let received;
 const server=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{received=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'registered-tools'}));});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const runtime={app:'/Tools.app',cli:'/cli',qtPlugin:'/plugin'},file=path.join(root,'desktop-runtime.json');await writeFile(file,JSON.stringify({runtime,harness:{id:'source-version'}}));const result=await main(['runtime','--file',file,'--server','http://127.0.0.1:'+server.address().port]);assert.deepEqual(received,runtime);assert.equal(result.result.id,'registered-tools');}finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
