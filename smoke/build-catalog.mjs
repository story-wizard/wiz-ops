import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {externalPath,digest} from './runner/files.mjs';
const exec=promisify(execFile),pending=new Map();
export const catalogDirectory=dataDir=>externalPath(process.env.WIZARD_BUILD_CATALOG_DIR||path.join(dataDir,'build-catalog'));
export async function atomicCatalogJSON(file,value){file=externalPath(file);await mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(value,null,2)+'\n');await rename(temp,file);}finally{await rm(temp,{force:true});}}
export function parseGitHubResponse(stdout){const boundary=stdout.search(/\r?\n\r?\n/),headers=boundary<0?stdout:stdout.slice(0,boundary),status=Number(headers.match(/^HTTP\/\S+\s+(\d+)/)?.[1]),etag=headers.match(/^etag:\s*(.+)$/im)?.[1].trim()||null;return {status,etag,data:status===304?null:JSON.parse(stdout.slice(boundary).trim())};}
async function requestGitHub(endpoint,etag){let stdout;try{({stdout}=await exec('gh',['api','--include',endpoint,...(etag?['-H','If-None-Match: '+etag]:[])],{timeout:30000,maxBuffer:16*1024**2}));}catch(e){if(!/^HTTP\/\S+\s+304/.test(e.stdout||''))throw e;stdout=e.stdout;}return parseGitHubResponse(stdout);}
export function githubCatalogClient(directory,request=requestGitHub){
 const inFlight=new Map(),stats={changed:0,unchanged:0,reused:0};
 async function load(endpoint,{stable=false}={}){
  const file=path.join(directory,'github',digest(endpoint)+'.json');let previous;try{previous=JSON.parse(await readFile(file,'utf8'));if(previous.endpoint!==endpoint)throw Error('GitHub cache endpoint differs.');}catch(e){if(e.code!=='ENOENT')throw e;}
  // PR authorship is retained; recheck it after a day, or when GitHub supplied no author.
  if(stable&&previous?.data?.user?.login&&Date.now()-Date.parse(previous.checkedAt)<86400000){stats.reused++;return previous.data;}
  let result;try{result=await request(endpoint,previous?.etag);}catch(e){if(stable&&previous?.data?.user?.login){stats.reused++;return previous.data;}throw e;}
  if(result.status===304){if(!previous)throw Error('GitHub returned 304 without a retained response.');stats.unchanged++;await atomicCatalogJSON(file,{...previous,checkedAt:new Date().toISOString()});return previous.data;}
  if(result.status!==200)throw Error('GitHub metadata request failed: '+result.status);
  stats.changed++;await atomicCatalogJSON(file,{endpoint,etag:result.etag,checkedAt:new Date().toISOString(),data:result.data});return result.data;
 }
 const get=(endpoint,options)=>{if(!inFlight.has(endpoint))inFlight.set(endpoint,load(endpoint,options).finally(()=>inFlight.delete(endpoint)));return inFlight.get(endpoint);};get.stats=stats;return get;
}
export function buildPRReferences(build){
 const refs=new Map(),add=(repo,number)=>refs.set(repo+'#'+number,{repository:'story-wizard/'+repo,number:Number(number)});
 for(const m of (build.tag||'').matchAll(/(?:^|-)(wizard(?:-(?:core|ai|release))?)-(\d+)(?=-|$)/g))add(m[1],m[2]);
 for(const m of (build.releaseNotes||'').matchAll(/https:\/\/github\.com\/story-wizard\/(wizard(?:-(?:core|ai|release))?)\/pull\/(\d+)\b/g))add(m[1],m[2]);
 return [...refs.values()];
}
export async function enrichPRAuthors(builds,get){
 const refs=new Map(builds.flatMap(buildPRReferences).map(p=>[p.repository+'#'+p.number,p])),queue=[...refs.values()],resolved=new Map();
 // ponytail: six read-only requests at a time; use a shared broker if multiple tools need coordinated rate budgets.
 await Promise.all(Array.from({length:Math.min(6,queue.length)},async()=>{while(queue.length){const ref=queue.shift(),key=ref.repository+'#'+ref.number;try{const pr=await get(`repos/${ref.repository}/pulls/${ref.number}`,{stable:true});resolved.set(key,{...ref,author:pr.user?.login||null,url:pr.html_url||null});}catch{resolved.set(key,{...ref,author:null,url:null});}}}));
 return builds.map(build=>{const pullRequests=buildPRReferences(build).map(p=>resolved.get(p.repository+'#'+p.number)),prAuthors=[...new Set(pullRequests.map(p=>p.author).filter(Boolean))].sort();return {...build,pullRequests,prAuthors,authorStatus:pullRequests.length&&pullRequests.every(p=>p.author)?'Complete':prAuthors.length?'Partial':'Unknown'};});
}
export async function readBuildCatalog(directory){try{const catalog=JSON.parse(await readFile(path.join(directory,'catalog.json'),'utf8'));if(catalog.format!=='wizard-build-catalog/v1'||catalog.repository!=='story-wizard/wizard-release'||!Array.isArray(catalog.builds)||!Number.isFinite(Date.parse(catalog.fetchedAt))||catalog.builds.some(b=>!Number.isSafeInteger(b.assetId)||typeof b.tag!=='string'||typeof b.label!=='string'||!Array.isArray(b.prAuthors)||b.prAuthors.some(a=>typeof a!=='string')))throw Error('Unsupported build catalog.');return catalog;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export function refreshBuildCatalog(directory,refresh,page=1){
 const active=pending.get(directory);if(active)return active.page===page?active.promise:active.promise.catch(()=>{}).then(()=>refreshBuildCatalog(directory,refresh,page));
 const promise=refresh().finally(()=>pending.delete(directory));pending.set(directory,{page,promise});return promise;
}

export function mergeCatalogBuilds(previous,incoming){
 const builds=new Map(previous.map(b=>[b.assetId,{...b,listedRecently:false}]));
 for(const b of incoming){const old=builds.get(b.assetId),sameRun=b.buildRunId&&b.buildRunId===old?.buildRunId;builds.set(b.assetId,{...b,listedRecently:true,...(sameRun&&!b.requestedBy?{requestedBy:old.requestedBy,buildEvent:old.buildEvent,buildRunUrl:old.buildRunUrl}:{}),...(old?.annotations?{annotations:old.annotations}:{})});}
 return [...builds.values()].sort((a,b)=>['Release','Nightly','Tagged'].indexOf(a.channel)-['Release','Nightly','Tagged'].indexOf(b.channel)||b.publishedAt.localeCompare(a.publishedAt));
}

export function buildCatalogPage(catalog,params){
 const selected=key=>params.getAll(key).filter(Boolean),matches=(value,key)=>!selected(key).length||selected(key).includes(value),query=(params.get('search')||'').toLowerCase(),since=params.get('since')||'';
 const authors=selected('author').map(a=>a==='me'?catalog.currentUser:a);if(authors.some(a=>!a))throw Error('Authenticate GitHub or choose an explicit PR author.');
 const filtered=catalog.builds.filter(b=>(!authors.length||(b.prAuthors.length?b.prAuthors:['Unknown']).some(a=>authors.some(w=>w.toLowerCase()===a.toLowerCase())))&&matches(b.channel,'channel')&&matches(b.architecture,'architecture')&&matches(b.app?'Downloaded':'Available to download','availability')&&(!since||b.publishedAt.slice(0,10)>=since)&&(!query||[b.label,b.tag,b.asset,...b.prAuthors,...(b.pullRequests||[]).map(p=>p.repository+'#'+p.number)].join(' ').toLowerCase().includes(query)));
 const size=params.get('pageSize')||'50';if(size!=='all'&&(!/^\d+$/.test(size)||Number(size)<1||Number(size)>500))throw Error('Choose 1–500 builds per page, or all.');
 const pageSize=size==='all'?Math.max(1,filtered.length):Number(size),pageCount=Math.max(1,Math.ceil(filtered.length/pageSize)),requested=Number(params.get('page')||1);if(!Number.isSafeInteger(requested)||requested<1||requested>10000)throw Error('Choose a positive build page number.');
 const page=Math.min(requested,pageCount),facets={authors:[...new Set(catalog.builds.flatMap(b=>b.prAuthors.length?b.prAuthors:['Unknown']))].sort()};
 return {...catalog,total:catalog.builds.length,matching:filtered.length,page,pageSize,pageCount,facets,builds:filtered.slice((page-1)*pageSize,page*pageSize)};
}
