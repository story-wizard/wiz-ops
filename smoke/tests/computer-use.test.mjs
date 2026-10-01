import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {prepareUI,recordUI,retainedUI,selectedUICourse,verifyUICopy} from '../desktop/computer-use.mjs';
import {fingerprint,digest,writeJSON} from '../runner/files.mjs';

test('computer-use pass preserves the selected package, requires evidence and keeps outcomes separate',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'smoke-ui-')),id='11111111-1111-4111-8111-111111111111',parent=path.join(data,'runs',id),app=path.join(data,'Selected.app');
 try{
  await mkdir(parent,{recursive:true});await mkdir(path.join(app,'Contents'),{recursive:true});await writeFile(path.join(app,'Contents/binary'),'selected package');await symlink('binary',path.join(app,'Contents/alias'));
  const content={app,version:'fixture',packageHash:(await fingerprint(app,{packageTree:true})).sha256};await writeJSON(path.join(parent,'plan.json'),{...content,planHash:digest(content)});
  const prepared=await prepareUI(data,id,{checks:['C-UI-05-PROJECTLESS','C-LP-02-NEW','C-LP-02-SAVE-AS','C-SB-02-SHORTCUTS','C-SB-09-DOCK']}),root=prepared.root;assert.equal((await fingerprint(prepared.app,{packageTree:true})).sha256,content.packageHash);assert.ok(prepared.results.every(r=>r.status==='Not run'));
  await writeJSON(path.join(root,'pass.json'),{...prepared,sourcePackageHash:'f'.repeat(64)});await assert.rejects(()=>retainedUI(data,id),/source package differs/);
  await writeJSON(path.join(root,'pass.json'),{...prepared,packageHash:'f'.repeat(64)});await assert.rejects(()=>retainedUI(data,id),/runtime identity differs/);
  await writeJSON(path.join(root,'pass.json'),prepared);
  await assert.rejects(()=>prepareUI(data,id),e=>e.code==='EEXIST');
  await assert.rejects(()=>prepareUI(data,id,{cocoaPlugin:path.join(app,'Contents/binary'),cocoaSha256:'f'.repeat(64)}),/reviewed SHA-256/);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1cAAAAASUVORK5CYII=','base64');await writeFile(path.join(root,'evidence/prefs.png'),png);
  const input={id:'C-UI-05-PROJECTLESS',revision:1,status:'Pass',note:'Visible application preferences and return to the hub',artifacts:['evidence/prefs.png']};
  await assert.rejects(()=>recordUI(data,id,{...input,artifacts:[]}),/require a retained screenshot/);
  await assert.rejects(()=>recordUI(data,id,{...input,artifacts:['../plan.json']}),/evidence\/NAME/);
  const recorded=await recordUI(data,id,input);assert.equal(recorded.state,'Partial');assert.equal(recorded.revision,2);assert.equal(recorded.results[0].status,'Pass');
  await assert.rejects(()=>recordUI(data,id,input),/revision changed/);
  await assert.rejects(()=>recordUI(data,id,{...input,revision:2}),/already recorded/);
  for(const name of ['First','Copy']){
   const bundle=path.join(root,'projects',name+'.wiz');await mkdir(path.join(bundle,'timelines/tl_fixture'),{recursive:true});await writeJSON(path.join(bundle,'project.json'),{name:'Release UI First'});await writeJSON(path.join(bundle,'timelines/index.json'),{timelines:[{timeline_id:'tl_fixture'}]});await writeFile(path.join(bundle,'timelines/tl_fixture/timeline.otio'),'saved timeline');
  }
  const next={id:'C-LP-02-NEW',revision:2,status:'Pass',note:'Created the requested empty project through the dialog',artifacts:['evidence/prefs.png'],project:'projects/First.wiz'};
  assert.equal((await recordUI(data,id,next)).results[1].saved.name,'Release UI First');
  const save={...next,id:'C-LP-02-SAVE-AS',revision:3,project:'projects/Copy.wiz',original:'projects/First.wiz'};
  await writeFile(path.join(root,'projects/Copy.wiz/timelines/tl_fixture/timeline.otio'),'lost timeline');await assert.rejects(()=>recordUI(data,id,save),/preserve the original timeline bytes/);
  await writeFile(path.join(root,'projects/Copy.wiz/timelines/tl_fixture/timeline.otio'),'saved timeline');await recordUI(data,id,save);
  await recordUI(data,id,{id:'C-SB-02-SHORTCUTS',revision:4,status:'Unknown',note:'Owned app exited during input',artifacts:[]});
  const remaining={id:'C-SB-09-DOCK',revision:5,status:'Pass',note:'An attempted continuation',artifacts:['evidence/prefs.png']};
  await assert.rejects(()=>recordUI(data,id,remaining),/uncertain UI action stops this pass/);
  assert.equal((await recordUI(data,id,{...remaining,status:'Blocked'})).state,'Unknown');
  await writeFile(path.join(root,'evidence/prefs.png'),'replaced evidence');await assert.rejects(()=>retainedUI(data,id),/artifact changed/);
  assert.equal(JSON.parse(await readFile(path.join(parent,'plan.json'))).packageHash,content.packageHash,'Companion observations never rewrite the automated plan');
 }finally{await rm(data,{recursive:true,force:true});}
});

test('UI selection and runtime evidence refuse unrelated package changes',()=>{
 assert.deepEqual(selectedUICourse(['C-SB-02-SHORTCUTS','C-UI-05-PROJECT']).cases.map(c=>c.id),['C-SB-02-SHORTCUTS','C-UI-05-PROJECT']);
 for(const checks of [[],['missing'],['C-SB-02-SHORTCUTS','C-SB-02-SHORTCUTS']])assert.throws(()=>selectedUICourse(checks),/unique check IDs/);
 assert.throws(()=>selectedUICourse(['C-LP-02-REOPEN']),/New Project first/);
 assert.throws(()=>selectedUICourse(['C-LP-02-SAVE-AS','C-LP-02-NEW']),/New Project first/);
 const source={sha256:'stock',entries:[['Contents/MacOS/wizard-bin',1,'same'],['Contents/PlugIns/platforms/libqcocoa.dylib',1,'stock']]};
 const patched={sha256:'patched',entries:[source.entries[0],['Contents/PlugIns/platforms/libqcocoa.dylib',2,'patched']]};
 assert.doesNotThrow(()=>verifyUICopy(source,patched,true));assert.throws(()=>verifyUICopy(source,patched),/Owned copy differs/);
 assert.throws(()=>verifyUICopy(source,{...patched,entries:[['Contents/MacOS/wizard-bin',1,'changed'],patched.entries[1]]},true),/only the Cocoa plugin/);
 assert.throws(()=>verifyUICopy(source,{...patched,entries:[...patched.entries,['extra',1,'new']]},true),/only the Cocoa plugin/);
 assert.throws(()=>verifyUICopy(source,source,true),/only the Cocoa plugin/);
});
