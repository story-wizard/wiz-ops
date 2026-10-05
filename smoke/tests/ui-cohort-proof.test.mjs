import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyGradeIsolation,verifyRestoredGraph,verifyMeterSamples,verifySearchIdentity} from '../desktop/ui-cohort-proof.mjs';
const before={nodes:[{node_id:'source',type:'media_input',params:{asset_id:'fixture'}},{node_id:'grade',type:'primary',params:{'grade.primary.gamma':1}}],edges:[{from_node:'source',to_node:'grade'}]};
test('grade oracle rejects a no-op, a wrong target, lost identities and unrelated parameter writes',()=>{
 const after=structuredClone(before);after.nodes[1].params['grade.primary.gamma']=1.2;
 assert.equal(verifyGradeIsolation(before,after,'grade.primary.').changes.length,1);
 assert.throws(()=>verifyGradeIsolation(before,before,'grade.primary.'));
 for(const mutate of [g=>g.nodes[0].params.asset_id='other',g=>g.nodes.shift(),g=>g.edges[0].from_node='absent',g=>g.edges[0].to_node='source',g=>g.nodes[1].params.radius=10]){const broken=structuredClone(after);mutate(broken);assert.throws(()=>verifyGradeIsolation(before,broken,'grade.primary.'));}
 verifyRestoredGraph(before,structuredClone(before));assert.throws(()=>verifyRestoredGraph(before,after));
});
test('meter oracle requires repeated active response and a decaying tail',()=>{
 verifyMeterSamples(.005,[.08,.09,.085],[.035,.01,.004,.003,.002]);
 assert.throws(()=>verifyMeterSamples(.005,[.005,.005,.005],[0,0,0]));
 assert.throws(()=>verifyMeterSamples(.005,[.08,.09,.085],[.08,.08,.08]));
 assert.throws(()=>verifyMeterSamples(.005,[.08,NaN,.085],[0,0,0]));
});
test('live search oracle binds the expected identity rather than any named row',()=>{
 verifySearchIdentity([{id:'new'}],'new');assert.throws(()=>verifySearchIdentity([{id:'old'}],'new'));assert.throws(()=>verifySearchIdentity([{id:'new'},{id:null}],'new'));
});
