import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,chmod,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {releaseBuilds,importBuild,localBuilds,receiveArchive} from '../builds.mjs';
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
   const imported=await importBuild(root,{path:zip});assert.ok(imported.app.startsWith(path.join(root,'builds')));assert.match(imported.archiveHash,/^[a-f0-9]{64}$/);assert.equal((await localBuilds(root)).length,1);assert.equal((await importBuild(root,{path:zip})).app,imported.app);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
