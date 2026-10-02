import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {beginProof,verifyCheckpoint} from '../desktop/agent-proof.mjs';
const defs=JSON.parse(await readFile(new URL('../desktop/physical-editor-course.json',import.meta.url))).cases;
const edge={from_node:'t',from_slot:'output',to_node:'b',to_slot:'input',type:'pixel'},out={from_node:'b',from_slot:'output',to_node:'c',to_slot:'fg',type:'pixel'};
const graph={graph_id:'graph',timeline_id:'timeline',clip_id:'clip',nodes:[{node_id:'t',type:'transform_2d',params:{}},{node_id:'b',type:'gaussian_blur',params:{radius:12},owners:['clip:timeline:clip'],bypassed:false},{node_id:'c',type:'composite',params:{}}],edges:[out]};
const node={nodeId:'b',labels:['Radius'],x:60,y:60,sceneX:200,sceneY:200,width:50,height:60,ports:[{side:'input',x:60,y:70},{side:'output',x:110,y:70}]};
const view={id:'view',window:'window',viewport:'viewport',class:'RenderGraphView',graphId:'graph',timelineId:'timeline',sceneItems:[node,{nodeId:'t',labels:['Scale'],ports:[{side:'output',x:30,y:40}]}]};
function fixture(id,base=graph){const proof=beginProof(defs.find(c=>c.id===id)),session={proofTarget:'view',proofRead:{timeline_id:'timeline',clip_id:'clip'}};const result=verifyCheckpoint(proof,'baseline',base,{widgets:[view]},session);Object.assign(proof,{baseline:structuredClone(base),binding:result.binding});return {proof,session};}
function verify(f,id,g,ui=view){const point=f.proof.contract.checkpoints.find(c=>c.id===id);f.proof.actions.push(...(point?.actions||[]).map(id=>({...f.proof.contract.actions.find(a=>a.id===id),receipt:{status:'Dispatched'}})));return verifyCheckpoint(f.proof,id,g,{widgets:[ui]},f.session);}
test('graph proof binds the displayed graph/node and cannot rebaseline away old actions or taint',()=>{
 const f=fixture('P-RG-MOVE');f.proof.tainted=true;
 const alias={...view,graphId:'clip:timeline:clip'},contract=beginProof(defs.find(c=>c.id==='P-RG-MOVE'));const binding=verifyCheckpoint(contract,'baseline',graph,{widgets:[alias]},f.session).binding;assert.equal(binding.uiGraphId,alias.graphId);
 assert.throws(()=>verifyCheckpoint(f.proof,'baseline',graph,{widgets:[view]},f.session),e=>e.code==='baseline_frozen');assert.equal(f.proof.tainted,true);
 for(const bad of [{...view,graphId:'other'},{...view,graphId:'clip:timeline:other'},{...view,timelineId:'other'},{...view,sceneItems:[{...node,nodeId:'other'},view.sceneItems[1]]}])assert.throws(()=>verifyCheckpoint(beginProof(defs.find(c=>c.id==='P-RG-MOVE')),'baseline',graph,{widgets:[bad]},f.session),e=>e.code==='wrong_fixture');
});
test('wire accepts the exact edge and its derived incidence but rejects unrelated changes and wrong ports',()=>{
 const f=fixture('P-RG-WIRE'),changed=structuredClone(graph);changed.edges.push(edge);changed.nodes[0].outgoing=[edge];changed.nodes[1].incoming=[edge];
 assert.equal(verify(f,'changed',changed).matched,true);
 const wrong=structuredClone(changed);wrong.edges[1].to_slot='mask';assert.equal(verify(f,'changed',wrong).matched,false);
 const extra=structuredClone(changed);extra.edges.push({...edge,to_node:'c'});assert.equal(verify(f,'changed',extra).matched,false);
 const altered=structuredClone(changed);altered.nodes[1].params.radius=99;assert.equal(verify(f,'changed',altered).matched,false);
 assert.equal(verify(f,'restored',graph).matched,true);assert.equal(verify(f,'redone',changed).matched,true);
});
test('move requires graph preservation and pan requires scene preservation',()=>{
 const f=fixture('P-RG-MOVE'),moved={...view,sceneItems:[{...node,sceneX:225,sceneY:220,x:85,y:80},view.sceneItems[1]]};
 const result=verify(f,'moved',graph,moved);assert.equal(result.matched,true);f.proof.checkpoints.moved={observed:graph,observedUI:result.observedUI};
 assert.equal(verify(f,'panned',graph,{...moved,sceneItems:[{...moved.sceneItems[0],x:100,y:90},view.sceneItems[1]]}).matched,true);
 assert.equal(verify(f,'panned',graph,{...moved,sceneItems:[{...moved.sceneItems[0],sceneX:300},view.sceneItems[1]]}).matched,false);
 const corrupt=structuredClone(graph);corrupt.nodes[1].params.radius=99;assert.equal(verify(f,'moved',corrupt,moved).matched,false);
 assert.equal(verifyCheckpoint(f.proof,'resolve-unchanged',graph,{widgets:[moved]},f.session).matched,true);
 assert.equal(verifyCheckpoint(f.proof,'resolve-unchanged',graph,{widgets:[view]},f.session).matched,false);
 f.session.agentUnknown={params:{actionId:'move'}};assert.equal(verifyCheckpoint(f.proof,'resolve-completed',graph,{widgets:[moved]},f.session).matched,true);assert.equal(f.proof.checkpoints.changed,undefined);
});
test('clipboard accepts one matching serial copy and exact delete/two Undo states',()=>{
 const connected={...graph,edges:[edge,out]},f=fixture('P-RG-CLIPBOARD',connected),copy={...graph.nodes[1],node_id:'copy'},pasted={...connected,nodes:[...connected.nodes,copy],edges:[edge,{...out,to_node:'copy',to_slot:'input'},{...out,from_node:'copy'}]},display={...view,sceneItems:[...view.sceneItems,{...node,nodeId:'copy',sceneX:250,sceneY:250,x:110,y:110}]};
 assert.equal(verify(f,'pasted',pasted,display).matched,true);f.proof.checkpoints.pasted={observed:pasted};
 for(const change of [x=>x.nodes.at(-1).owners=['clip:other:clip'],x=>delete x.nodes.at(-1).owners,x=>x.nodes.at(-1).params={radius:17},x=>x.nodes[0].params={unexpected:1},x=>x.edges.push({...edge,to_node:'c'})]){const bad=structuredClone(pasted);change(bad);assert.equal(verify(f,'pasted',bad,display).matched,false);}
 assert.equal(verify(f,'deleted',connected).matched,true);assert.equal(verify(f,'paste-restored',pasted,display).matched,true);assert.equal(verify(f,'restored',connected).matched,true);assert.equal(verify(f,'restored',pasted,display).matched,false);
});
