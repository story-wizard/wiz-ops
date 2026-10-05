import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {observationBinding,observationChanges,retainObservation} from '../desktop/observations.mjs';
import {validateToolParams} from '../desktop/agent-proof.mjs';

const session={pid:123,processStart:'start',generation:1,guiHash:'package'},params={selector:{class:'Button'}},binding=observationBinding(session,params);
const envelope=matches=>({binding,value:{matches,truncated:false,inspectionIncomplete:false}});
test('observation changes preserve exact values and identities without confusing reordering with edits',()=>{
 const before=envelope([{id:'a',enabled:true,value:0},{id:'b',text:'Save'}]);
 const after=envelope([{id:'b',text:'Save'},{id:'a',enabled:false,value:false,visibleRect:{x:1,y:2}},{id:'c',text:'Undo'}]);
 const diff=observationChanges(before,after);assert.equal(diff.unchangedCount,1);assert.deepEqual(diff.added,[after.value.matches[2]]);assert.deepEqual(diff.noLongerReturned,[]);
 assert.equal(diff.changed[0].id,'a');assert.deepEqual(diff.changed[0].fields.find(f=>f.field==='value'),{field:'value',before:0,after:false,beforePresent:true,afterPresent:true});
 assert.deepEqual(diff.changed[0].fields.find(f=>f.field==='visibleRect').after,{x:1,y:2});
 assert.throws(()=>observationChanges(before,{...after,binding:{...binding,generation:2}}),e=>e.code==='observation_binding_changed');
 assert.throws(()=>observationChanges(before,envelope([{id:'a'},{id:'a'}])),e=>e.code==='invalid_observation');
});
test('truncated selections cannot establish deletion and query/process changes cannot reuse a baseline',()=>{
 const before=envelope([{id:'a'},{id:'b'}]),after=envelope([{id:'a'}]);after.value.truncated=true;
 const diff=observationChanges(before,after);assert.deepEqual(diff.noLongerReturned,['b']);assert.equal(diff.completeSelection,false);
 for(const mutate of [b=>b.pid++,b=>b.started='other',b=>b.packageHash='other',b=>b.query.scope='other',b=>b.query.selector={text:'Other'},b=>b.query.selectors=[{id:'other'}],b=>b.query.limit=1]){const bad=structuredClone(after);mutate(bad.binding);assert.throws(()=>observationChanges(before,bad),e=>e.code==='observation_binding_changed');}
});
test('retained observation deltas use only hash-checked session-owned snapshots',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-observation-'),s={...session,root};
 try{
  validateToolParams('observe',{...params,since:'token'});assert.throws(()=>validateToolParams('find',{since:'token'}));
  const initial=await retainObservation(s,params,{...envelope([{id:'a',text:'before'}]).value,observedAt:'first'});
  const next=await retainObservation(s,{...params,since:initial.observationId},{...envelope([{id:'a',text:'after'}]).value,observedAt:'second'});
  assert.equal((next.matches||next.changes.changed.map(c=>c.current))[0].text,'after');assert.notEqual(next.observationId,initial.observationId);
  const stored=JSON.parse(await readFile(root+'/observations/'+next.observationId+'.json'));assert.equal(stored.value.matches[0].text,'after');
  for(const since of ['../escape','',{},'00000000-0000-4000-8000-000000000000'])await assert.rejects(()=>retainObservation(s,{...params,since},initial),e=>e.status==='Blocked');
  stored.value.matches[0].text='tampered';await writeFile(root+'/observations/'+next.observationId+'.json',JSON.stringify(stored));
  await assert.rejects(()=>retainObservation(s,{...params,since:next.observationId},initial),e=>e.code==='observation_changed');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('a repeated observation returns the smaller full or delta selection and retains the complete state',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-observation-size-'),s={...session,root};
 try{
  const value=matches=>({...envelope(matches).value,observedAt:'now'});
  const first=await retainObservation(s,params,value([{id:'a',model:Array.from({length:12},(_,i)=>['long media name '+i+'x'.repeat(100)])}]));
  const second=await retainObservation(s,{...params,since:first.observationId},value([{id:'a',model:[['one result']]}]));
  assert.equal(second.encoding,'full');assert.deepEqual(second.matches,[{id:'a',model:[['one result']]}]);assert.equal(second.since,first.observationId);
  const large=Array.from({length:20},(_,i)=>({id:String(i),text:'large control '+i+'x'.repeat(100)}));
  const baseline=await retainObservation(s,params,value(large));
  const delta=await retainObservation(s,{...params,since:baseline.observationId},value(large));
  assert.equal(delta.encoding,'delta');assert.equal(delta.matches,undefined);assert.equal(delta.changes.unchangedCount,20);
  const stored=JSON.parse(await readFile(root+'/observations/'+delta.observationId+'.json'));assert.deepEqual(stored.value.matches,large);
 }finally{await rm(root,{recursive:true,force:true});}
});
