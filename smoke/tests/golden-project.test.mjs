import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inspectGoldenProject,goldenRoleCandidates} from '../runner/golden-project.mjs';
import {main} from '../scripts/smoke.mjs';

test('supplied project intake preserves source, identities and unknown media; roles require recorded predicates',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'athanor-golden-intake-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const project=path.join(root,'Supplied.wiz'),clips=path.join(project,'assets','clips');await mkdir(clips,{recursive:true});
  const metadata={wiz_format_version:'2.12.0',name:'Supplied',entry_timeline_id:'tl-main',media_roots:[{id:'source',path:'/not-mounted/source'}]};
  const projectBytes=JSON.stringify(metadata);await writeFile(path.join(project,'project.json'),projectBytes);
  const asset=(id,technical)=>({id,asset:id+'.mov',path:'/not-mounted/source/'+id+'.mov',media_root_id:'source',technical});
  for(const a of [asset('long',{media_kind:'video',codec:'prores',probe_duration:7200,audio_detected:true}),asset('short',{media_kind:'video',codec:'h264',probe_duration:2,audio_detected:false}),asset('unknown',{media_kind:'video'})])await writeFile(path.join(clips,a.id+'.json'),JSON.stringify(a));
  await mkdir(path.join(project,'timelines','tl-main'),{recursive:true});await writeFile(path.join(project,'timelines','tl-main','timeline.otio'),JSON.stringify({name:'Main','OTIO_SCHEMA':'Timeline.1'}));
  await writeFile(path.join(project,'timelines','index.json'),JSON.stringify({timelines:[{timeline_id:'tl-main'}]}));
  const inventory=await inspectGoldenProject(project);
  assert.equal(await readFile(path.join(project,'project.json'),'utf8'),projectBytes);
  assert.deepEqual(inventory.assets.map(a=>a.id),['long','short','unknown']);
  assert.equal(inventory.timelines[0].id,'tl-main');
  assert.equal(inventory.qualification.executionEnabled,false);
  assert.ok(inventory.assets.every(a=>a.mediaAvailability==='Unchecked'&&a.mediaSha256===null));
  const match=goldenRoleCandidates(inventory,[{role:'long-video',kind:'video',minDurationSeconds:600,hasAudio:true},{role:'short-video',maxDurationSeconds:10},{role:'audio-only',kind:'audio'}]);
  assert.deepEqual(match.roles.map(r=>r.candidates.map(a=>a.assetId)),[['long'],['short'],[]]);
  assert.equal(match.executionEnabled,false);
  assert.throws(()=>goldenRoleCandidates({...inventory,assets:[]},[{role:'video'}]),/changed/);
  assert.throws(()=>goldenRoleCandidates(inventory,[{role:'x',minDurationSeconds:5,maxDurationSeconds:1}]),/range/);
  assert.throws(()=>goldenRoleCandidates(inventory,[{role:'x'},{role:'x'}]),/duplicate/);
  assert.throws(()=>goldenRoleCandidates(inventory,[{role:'x',unsupported:true}]),/Invalid/);
  const out=path.join(root,'inventory.json');
  const envelope=await main(['golden','inspect','--path',project,'--out',out]);assert.equal(envelope.result.sha256,inventory.sha256);
  await assert.rejects(main(['golden','inspect','--path',project,'--out',out]),/EEXIST/);
  await assert.rejects(main(['golden','inspect','--path',project,'--out',path.join(project,'intake.json')]),/supplied project/);
  await writeFile(path.join(root,'roles.json'),JSON.stringify([{role:'video',minDurationSeconds:10}]));
  assert.deepEqual((await main(['golden','roles','--file',out,'--requirements',path.join(root,'roles.json')])).result.roles[0].candidates.map(a=>a.assetId),['long']);
  await symlink(clips,path.join(project,'linked-clips'));await rm(clips,{recursive:true});await symlink(path.join(project,'linked-clips'),clips);
  await assert.rejects(inspectGoldenProject(project));
});

test('intake rejects malformed, duplicate and linked asset records rather than inventing a media inventory',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'athanor-golden-invalid-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const project=path.join(root,'Input.wiz'),clips=path.join(project,'assets','clips');await mkdir(clips,{recursive:true});
  await writeFile(path.join(project,'project.json'),JSON.stringify({name:'Input',wiz_format_version:'2.12.0'}));
  await writeFile(path.join(clips,'a.json'),JSON.stringify({id:'same'}));await writeFile(path.join(clips,'b.json'),JSON.stringify({id:'same'}));
  await assert.rejects(inspectGoldenProject(project),/duplicate/);
  await rm(path.join(clips,'b.json'));await symlink(path.join(clips,'a.json'),path.join(clips,'b.json'));await assert.rejects(inspectGoldenProject(project),/Unsupported/);
  await rm(path.join(clips,'b.json'));await writeFile(path.join(clips,'a.json'),'[1]');await assert.rejects(inspectGoldenProject(project),/metadata object/);
  await assert.rejects(inspectGoldenProject('relative.wiz'),/absolute/);
});

test('legacy project keeps registry-only assets and labels decimal-rate duration estimates',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'athanor-golden-legacy-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const project=path.join(root,'Legacy.wiz'),clips=path.join(project,'assets','clips');await mkdir(clips,{recursive:true});
  await writeFile(path.join(project,'project.json'),JSON.stringify({name:'Legacy',wiz_format_version:'2.10.0'}));
  await writeFile(path.join(clips,'camera.json'),JSON.stringify({id:'camera',asset:'Camera.mxf',technical:{media_kind:'video',duration_frames:1200,frame_rate:24,audio_detected:true}}));
  const registry={assets:[{asset_id:'camera',asset_url:'Camera.mxf',media_root_id:'camera-root',bytes:1024},{asset_id:'sfx',asset_url:'Effect.aac',media_root_id:'missing-root',bytes:64}],media_roots:[{id:'missing-root',path:'/another/machine/sounds'}]};
  await writeFile(path.join(project,'assets','index.json'),JSON.stringify(registry));
  await mkdir(path.join(project,'timelines','cut'),{recursive:true});
  await writeFile(path.join(project,'timelines','cut','timeline.otio'),JSON.stringify({name:'Cut',metadata:{wiz:{kind:'editorial'}},tracks:{OTIO_SCHEMA:'Stack.1',children:[{OTIO_SCHEMA:'Track.1',children:[{OTIO_SCHEMA:'Clip.2'},{OTIO_SCHEMA:'Gap.1'}]}]}}));
  const x=await inspectGoldenProject(project);assert.deepEqual(x.assets.map(a=>a.id),['camera','sfx']);assert.equal(x.registeredAssetCount,2);
  assert.equal(x.assets[0].metadata.durationSeconds,50);assert.equal(x.assets[0].metadata.durationBasis,'estimate-from-saved-frame-count-and-decimal-rate');assert.equal(x.assets[0].metadata.frameRate,null);
  assert.equal(x.assets[1].metadataRecordPresent,false);assert.equal(x.assets[1].metadata.kind,null);assert.equal(x.assets[1].mediaAvailability,'Unchecked');assert.equal(x.metadataGaps[0].assetId,'sfx');
  assert.deepEqual(x.timelines[0].structure,{clips:1,tracks:1,gaps:1});assert.equal(x.timelines[0].kind,'editorial');
  assert.deepEqual(goldenRoleCandidates(x,[{role:'long-camera',minDurationSeconds:40},{role:'audio',kind:'audio'}]).roles.map(r=>r.candidates.map(a=>a.assetId)),[['camera'],[]]);
  registry.assets.push(registry.assets[1]);await writeFile(path.join(project,'assets','index.json'),JSON.stringify(registry));await assert.rejects(inspectGoldenProject(project),/duplicate registry/);
});
