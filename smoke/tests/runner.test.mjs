import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseEnvelope,OutcomeError,bounds,same,snapshotState,PackagedEngine,command} from '../runner/engine.mjs';
import {executeCourse} from '../runner/run.mjs';
import {validateFixtures} from '../runner/fixtures.mjs';
import {digest,sha,writeJSON} from '../runner/files.mjs';
import {parseIngest,verifyIngestSidecar} from '../runner/ingest.mjs';
import {parsePPM,pixelStats,pixelDifference,visibleImage} from '../runner/pixels.mjs';
import {selectorNamesTimeline,widgetPixelDifference} from '../desktop/check-support.mjs';

test('scope pixel evidence rejects incomplete captures and detects a frozen plot',()=>{
  const sample=n=>({sampleWidth:64,sampleHeight:32,sampleRgb:Buffer.alloc(64*32*3,n).toString('base64')});
  assert.equal(widgetPixelDifference(sample(0),sample(0)),0);
  assert.equal(widgetPixelDifference(sample(0),sample(100)),100);
  assert.throws(()=>widgetPixelDifference(sample(0),{...sample(0),sampleRgb:'AA=='}),/Incomplete/);
  assert.throws(()=>widgetPixelDifference(sample(0),{...sample(0),sampleWidth:32}),/Invalid/);
});

test('timeline relaunch compares the selected name without confusing it with open-tab count',()=>{
  assert.equal(selectorNamesTimeline('Main (2)','Main'),true);
  assert.equal(selectorNamesTimeline('Main (1)','Main'),true);
  assert.equal(selectorNamesTimeline('Main (1) (2)','Main (1)'),true);
  assert.equal(selectorNamesTimeline('Secondary (2)','Main'),false);
  assert.equal(selectorNamesTimeline('Main alternate (1)','Main'),false);
  assert.equal(selectorNamesTimeline(undefined,'Main'),false);
});

test('still exports retain fractional timeline rates and reject the wrong returned frame',async()=>{
  const {ProjectSession,still,frame}=await import('../runner/interactions.mjs');
  const root=await mkdtemp(path.join(tmpdir(),'smoke-fractional-'));
  try{
    let wrong=false,observed;
    const engine={root,async call(bundle,op,params){
      observed=params;
      if(op==='timeline.create'){assert.equal(params.video_format.preset,'hd_1080p_23_976');return {timeline_id:'timeline_fractional',tracks:[{kind:'video',track_id:'track_v'},{kind:'audio',track_id:'track_a'}]};}
      await writeFile(params.output,Buffer.concat([Buffer.from('P6\n1920 1080\n255\n'),Buffer.alloc(1920*1080*3)]));
      return {output:params.output,timeline_frame:params.time.value+(wrong?1:0)};
    }};
    const c=new ProjectSession(engine,'fractional',{files:[]});await mkdir(path.dirname(c.bundle),{recursive:true});c.main=await c.timeline('Fractional',23.976);
    assert.equal(c.main.fps,24000/1001);await still(c,'at-one-second',1.001);
    assert.deepEqual(observed.time,{value:24,rate:24000/1001});
    wrong=true;await assert.rejects(()=>frame(c,'wrong',24),/wrong path or timeline frame/);
    await assert.rejects(()=>frame(c,'fraction',.5),/nonnegative frame/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('pixel evidence rejects truncated, blank and wrong-size renders and detects changed pixels',()=>{
  const image=pixels=>parsePPM(Buffer.concat([Buffer.from('P6\n# fixture\n2 1\n255\n'),Buffer.from(pixels)]));
  const black=image([0,0,0,0,0,0]),pattern=image([10,0,0,255,255,255]);
  assert.equal(pattern.pixels[0],10,'A newline-valued first pixel is payload, not header whitespace');
  assert.throws(()=>image([0,0,0]),/incomplete/);assert.throws(()=>visibleImage(black),/visible/);
  visibleImage(pattern);assert.equal(pixelDifference(pattern,pattern),0);assert.ok(pixelDifference(pattern,black)>100);
  assert.equal(pixelStats(black).edgeEnergy,0);assert.ok(pixelStats(pattern).edgeEnergy>0);
  assert.throws(()=>pixelDifference(pattern,{...pattern,width:1}),/different dimensions/);
});

test('success envelopes do not replace behavioral assertions; error and unknown states fail closed',()=>{
  const good={code:0,stdout:JSON.stringify({ok:true,result:{}})};
  assert.deepEqual(parseEnvelope(good,'project.create').result,{});
  assert.throws(()=>parseEnvelope({...good,code:1},'project.create'));
  assert.throws(()=>parseEnvelope({code:0,stdout:'{"ok":false,"error":{"code":"oops"}}'},'edit'));
  assert.throws(()=>parseEnvelope({...good,timedOut:true},'edit'),e=>e.status==='Unknown');
  assert.throws(()=>parseEnvelope({...good,stdout:'partial'},'edit'),e=>e.status==='Unknown');
  assert.throws(()=>parseEnvelope({code:2,stdout:'',stderr:'wiz-cli: --format is supported only by timeline inspect\n'},'project.create'),e=>e.status==='Unknown'&&e.message.includes('exit 2')&&e.message.includes('--format is supported only by timeline inspect'));
  assert.throws(()=>parseEnvelope({code:1,stdout:'{"ok":false,"error":{"code":"invalid_params"}}'},'split',['locked_or_protected']));
  assert.throws(()=>bounds({timeline_range:{start_seconds:1,end_seconds:5},source:{source_range:{start_seconds:1,end_seconds:5}}},0,4,1,5));
  assert.throws(()=>snapshotState({timeline:{},tracks:[],next_cursor:'more'}));
  same({numerator:24,denominator:1},{denominator:1,numerator:24},'Object property order is irrelevant');
});

test('the real CLI adapter pins endpoint, bundle and observed revision and journals its request',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'smoke-adapter-'));
  try{
    const app=path.join(root,'Fake.app'),macos=path.join(app,'Contents/MacOS');await mkdir(macos,{recursive:true});
    const fake=`#!${process.execPath}\nconst args=process.argv.slice(2);if(args.includes('--format')){console.error('wiz-cli: --format is supported only by timeline inspect');process.exit(2);}if(!args.includes('--json')){console.error('Expected JSON envelope output');process.exit(2);}const params=JSON.parse(args[args.indexOf('--params')+1]);console.log(JSON.stringify({ok:true,bundle_version:'observed-next',result:{args,params}}));`;
    await writeFile(path.join(macos,'wiz-cli'),fake,{mode:0o700});
    const schema={operations:{'timeline.update':{required:['bundle','expect_revision','timeline_id'],properties:{bundle:{},expect_revision:{},timeline_id:{}},additionalProperties:false}}};
    const engine=new PackagedEngine({app},root,'fixture-run',schema);engine.child={exitCode:null,signalCode:null};engine.url='http://127.0.0.1:31415';engine.caseId='contract';engine.env={PATH:'/usr/bin:/bin'};const bundle=path.join(root,'owned.wiz');engine.revisions.set(bundle,'observed-before');
    const result=await engine.call(bundle,'timeline.update',{timeline_id:'timeline_known'});
    assert.equal(result.params.expect_revision,'observed-before');assert.equal(result.args[result.args.indexOf('--url')+1],engine.url);assert.ok(result.args.includes('--no-spawn'));assert.equal(result.args[result.args.indexOf('--bundle')+1],bundle);assert.equal(engine.revisions.get(bundle),'observed-next');
    assert.equal(JSON.parse(await readFile(path.join(root,'operations.jsonl'),'utf8')).params.expect_revision,'observed-before');
    await assert.rejects(()=>engine.call('/tmp/unowned.wiz','timeline.update',{timeline_id:'x'}));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a timed-out command is stopped and cannot become a passing receipt',async()=>{
  const result=await command(process.execPath,['-e','setTimeout(()=>{},30000)'],{timeout:50});assert.equal(result.timedOut,true);assert.throws(()=>parseEnvelope(result,'mutation'),e=>e.status==='Unknown');
});

test('ingest requires successful per-asset completion and current durable source evidence, even on exit zero',()=>{
  const snapshot={job_id:'ing_job',wiz_path:'/owned/project.wiz',status:'succeeded',error:null,summary:{operations_failed:[],operations_run:[{operation:'add_clip',asset_id:'asset_a',status:'ok'},{operation:'finalize_project',status:'ok'}]}};
  const receipt=s=>({code:0,stdout:'===WIZ_INGEST_SNAPSHOT_BEGIN_v1===\n'+JSON.stringify(s)+'\n===WIZ_INGEST_SNAPSHOT_END_v1==='});
  assert.equal(parseIngest(receipt(snapshot),snapshot.wiz_path,['asset_a']).job_id,'ing_job');
  assert.throws(()=>parseIngest(receipt({...snapshot,status:'failed',error:'missing dependency'}),snapshot.wiz_path,['asset_a']),/missing dependency/);
  assert.throws(()=>parseIngest(receipt(snapshot),snapshot.wiz_path,['asset_b']),/did not complete/);
  assert.throws(()=>parseIngest(receipt(snapshot),'/wrong/project.wiz',['asset_a']),/wrong project/);
  assert.throws(()=>parseIngest({...receipt(snapshot),timedOut:true},snapshot.wiz_path,['asset_a']),e=>e.status==='Unknown');
  assert.throws(()=>verifyIngestSidecar({id:'asset_a',technical:{file_hash:'source_a'}},'asset_a'),/no current completed ingest/);
  assert.throws(()=>verifyIngestSidecar({id:'asset_a',technical:{file_hash:'source_a'},coverage:{ingest_complete:{source_hash:'stale'}}},'asset_a'),/no current completed ingest/);
  verifyIngestSidecar({id:'asset_a',technical:{file_hash:'source_a'},coverage:{ingest_complete:{source_hash:'source_a'}}},'asset_a');
});

test('cancellation stops an owned process group and retains an unknown receipt',async()=>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),80);
  try{const result=await command(process.execPath,['-e','setTimeout(()=>{},30000)'],{signal:controller.signal,processGroup:true});assert.equal(result.aborted,true);assert.throws(()=>parseEnvelope(result,'ingest'),e=>e.status==='Unknown');}finally{clearTimeout(timer);}
});

test('fixture corruption is rejected before an engine is started',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'smoke-fixtures-'));
  try{const files=[];for(let i=0;i<6;i++){const file=`fixture-${i}.bin`;await writeFile(path.join(root,file),String(i));files.push({id:`fixture-${i}`,file,sha256:await sha(path.join(root,file))});}const content={format:'wizard-smoke-fixtures/v1',version:1,files};await writeJSON(path.join(root,'manifest.json'),{...content,sha256:digest(content)});await validateFixtures(root);const duplicate={...content,files:[files[0],files[0],...files.slice(2)]};await writeJSON(path.join(root,'manifest.json'),{...duplicate,sha256:digest(duplicate)});await assert.rejects(()=>validateFixtures(root),/unique/);await writeJSON(path.join(root,'manifest.json'),{...content,sha256:digest(content)});await writeFile(path.join(root,'fixture-0.bin'),'changed');await assert.rejects(()=>validateFixtures(root),/Fixture changed/);}finally{await rm(root,{recursive:true,force:true});}
});

test('wrong successful readback fails a case; unknown mutations are not retried and block later cases',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'smoke-course-'));
  try{
    const course={timeoutSeconds:5,caseTimeoutSeconds:1,cases:[{id:'A-CLI-01',scope:'connection'},{id:'IN-03',scope:'external media'}]},events=[];let calls=0;
    const engine={root,child:{pid:1,exitCode:null,signalCode:null},revisions:new Map(),async call(bundle,op){calls++;this.revisions.set(bundle,'revision');return op==='project.get_name'?{name:'wrong project'}:{};}};
    let results=await executeCourse({course,engine,fixtures:{files:[]},onResult:async(c,status)=>events.push([c.id,status])});
    assert.deepEqual(results.map(r=>r.status),['Fail','Blocked']);assert.equal(calls,2);
    engine.call=async()=>{calls++;throw new OutcomeError('ambiguous mutation','Unknown');};calls=0;
    results=await executeCourse({course,engine,fixtures:{files:[]},onResult:async()=>{}});assert.deepEqual(results.map(r=>r.status),['Unknown','Blocked']);assert.equal(calls,1,'an unknown mutation must never be replayed');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('cached model identity hashes symlink targets, not just their link paths',async()=>{
  const {symlink}=await import('node:fs/promises');const {fingerprint}=await import('../runner/files.mjs');
  const root=await mkdtemp(path.join(tmpdir(),'smoke-model-'));
  try{await mkdir(path.join(root,'snapshot'));const blob=path.join(root,'weights');await writeFile(blob,'original');await symlink(blob,path.join(root,'snapshot','weights.bin'));const first=await fingerprint(path.join(root,'snapshot'),{followFileLinks:true});await writeFile(blob,'modified');assert.notEqual((await fingerprint(path.join(root,'snapshot'),{followFileLinks:true})).sha256,first.sha256);}finally{await rm(root,{recursive:true,force:true});}
});

test('shared search helper rejects incomplete or unavailable evidence even with successful matches',async()=>{
  const {search}=await import('../runner/interactions.mjs');const result={completion:'complete',truncated:false,matches:[{item_id:'known'}],source_runs:[{source:'name',state:'ready',exhaustive:true,error:null}]};
  const c={async call(){return structuredClone(result);}};assert.equal((await search(c,'known')).matches[0].item_id,'known');
  result.completion='partial';await assert.rejects(()=>search(c,'known'),/incomplete/);result.completion='complete';result.source_runs[0].exhaustive=false;await assert.rejects(()=>search(c,'known'),/ready and exhaustive/);
});


test('relocated CLI entry points execute from paths with spaces and URL characters',async()=>{
 const {spawnSync}=await import('node:child_process'),{snapshotSource}=await import('../kits.mjs');
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'smoke entry # %-')));
 try{
  const source=path.join(root,'workspace');await snapshotSource(source);
  const run=spawnSync(process.execPath,[path.join(source,'runner/run.mjs')],{encoding:'utf8',timeout:15000});
  const prepare=spawnSync(process.execPath,[path.join(source,'runner/prepare.mjs'),'--check','--data-dir',path.join(root,'no-plan')],{encoding:'utf8',timeout:15000});
  assert.deepEqual([run.status,prepare.status],[2,1],'Both commands must execute their admission/preflight checks, not exit silently');
  assert.match(run.stderr,/requires --execute --run-id/);assert.match(prepare.stderr,/prepared.json/);
 }finally{await rm(root,{recursive:true,force:true});}
});
