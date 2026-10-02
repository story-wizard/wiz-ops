import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,appendFile,readFile,chmod,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {releaseBuilds,importBuild,localBuilds,receiveArchive,withDownloadProgress,assertBuildIdentity} from '../builds.mjs';
import {Readable} from 'node:stream';
test('finder orders published Mac ZIPs by channel then date and validates archive inputs',async()=>{
 const asset={id:1,name:'Wizard-macOS.zip',size:123,browser_download_url:'https://example.com/Wizard-macOS.zip'};
 const release=(tag,date)=>({tag_name:tag,name:tag,published_at:date,assets:[asset,{...asset,name:'Windows.zip'}]});
 const builds=releaseBuilds([release('vfeature','2026-10-01'),release('nightly-2026.10.01','2026-10-01'),release('vstory-weekly-26-09-24','2026-09-25'),{...release('v0.7.0','2026-10-01'),draft:true}]);
 assert.deepEqual(builds.map(b=>b.channel),['Release','Nightly','Tagged']);assert.equal(builds.length,3);
 const root=await mkdtemp(path.join(tmpdir(),'smoke-builds-'));
 try{
  await assert.rejects(()=>importBuild(root,{url:'http://example.com/a.zip'}),/HTTPS/);
  await assert.rejects(()=>importBuild(root,{tag:'tag',path:'/tmp/file.zip'}),/Choose one/);
  await receiveArchive(Readable.from(['archive']),path.join(root,'stream.zip'));assert.equal(await readFile(path.join(root,'stream.zip'),'utf8'),'archive');
  const check=path.resolve('scripts/validate-build-zip.py');
  for(const [name,link] of [['../escape',null],['folder/link','../../escape'],['safe/file',null]]){
   const zip=path.join(root,'test.zip');execFileSync('python3',['-c',`import zipfile,stat,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n i=zipfile.ZipInfo(sys.argv[2]);i.external_attr=(stat.S_IFLNK|0o777)<<16 if sys.argv[3] else 0;z.writestr(i,sys.argv[3] or 'ok')`,zip,name,link||'']);
   if(name==='safe/file')execFileSync('python3',[check,zip]);else assert.throws(()=>execFileSync('python3',[check,zip],{stdio:'pipe'}));
  }
  if(process.platform==='darwin'){
   const app=path.join(root,'Wizard.app');await mkdir(path.join(app,'Contents/MacOS'),{recursive:true});await writeFile(path.join(app,'Contents/Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>wizard</string></dict></plist>');await writeFile(path.join(app,'Contents/MacOS/wizard'),'fixture');await chmod(path.join(app,'Contents/MacOS/wizard'),0o755);
   const zip=path.join(root,'valid.zip');execFileSync('/usr/bin/ditto',['-c','-k','--keepParent',app,zip]);
   const progress=[];const imported=await importBuild(root,{path:zip},{onProgress:p=>progress.push(p)});assert.deepEqual(progress.filter(p=>p.completedSteps!==undefined).map(p=>p.completedSteps),[0,1,2,3,4]);assert.ok(imported.app.startsWith(path.join(root,'builds')));assert.match(imported.archiveHash,/^[a-f0-9]{64}$/);assert.equal((await localBuilds(root)).length,1);assert.equal((await importBuild(root,{path:zip})).app,imported.app);
   await appendFile(path.join(imported.app,'Contents/MacOS/wizard'),'changed');const listed=await localBuilds(root,{verify:false});assert.equal(listed[0].available,true);assert.throws(()=>assertBuildIdentity(listed,imported.app,'changed-hash'),/Cached build package changed/);assert.equal((await localBuilds(root))[0].available,false);assertBuildIdentity([...listed,{app:imported.app,source:'local'}],imported.app,'changed-hash');
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('workflow requester is separate from PR authors and the release publisher',()=>{
 const asset={id:1,name:'Wizard-macOS.zip'},release=(tag,body)=>({tag_name:tag,body,published_at:'2026-10-01',author:{login:'github-actions[bot]'},assets:[asset]});
 const builds=releaseBuilds([release('vfeature','<!-- wizard-build: abc123 run:101 -->'),release('manual-2026-r102',''),release('vlegacy','')],[{id:101,actor:{login:'original-user'},triggering_actor:{login:'rerun-user'},event:'workflow_dispatch'},{id:102,actor:{login:'another-user'},event:'workflow_dispatch'}]);
 assert.equal(builds[0].requestedBy,'rerun-user');assert.equal(builds[0].buildRunId,'101');assert.equal(builds[1].requestedBy,'another-user');assert.equal(builds[2].requestedBy,null);assert.equal(builds[2].publisher,'github-actions[bot]');
});

test('archive progress observes bytes during transfer and preserves completion/failure', {timeout:5000},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'smoke-transfer-'));const events=[];
 try{
  await receiveArchive(Readable.from([Buffer.alloc(3),Buffer.alloc(5)]),path.join(root,'upload.zip'),{totalBytes:8,stage:'Receiving ZIP',onProgress:p=>events.push(p)});
  assert.deepEqual(events.map(p=>p.bytes),[0,3,8]);assert.ok(events.every(p=>p.totalBytes===8&&p.stage==='Receiving ZIP'));assert.equal((await readFile(path.join(root,'upload.zip'))).length,8);
  let observed;const intermediate=new Promise(resolve=>{observed=resolve;});const downloadEvents=[],file=path.join(root,'download.zip');
  const result=await withDownloadProgress(file,8,p=>{downloadEvents.push(p);if(p.bytes===4)observed();},async()=>{await writeFile(file,Buffer.alloc(4));await intermediate;await appendFile(file,Buffer.alloc(4));return 'received';});
  assert.equal(result,'received');assert.ok(downloadEvents.some(p=>p.bytes===4&&p.totalBytes===8));assert.equal(downloadEvents.at(-1).bytes,8);
  await assert.rejects(()=>withDownloadProgress(path.join(root,'missing.zip'),null,()=>{},async()=>{throw Error('Transfer failed');}),/Transfer failed/);
 }finally{await rm(root,{recursive:true,force:true});}
});
