import test from 'node:test';
import assert from 'node:assert/strict';
import {graphNodeGeometry,graphGroupGeometry,graphNodeOutputGeometry} from '../desktop/graph-geometry.mjs';
const owner='clip:timeline:clip';
function observed(){
 const graph={timeline_id:'timeline',clip_id:'clip',nodes:['source','blur'].map(node_id=>({node_id,owners:[owner]})),presentation:{groups:[{id:'source-group',collapsed:true,hidden:false,members:['node:source']}]}};
 const geometry=nodeId=>({nodeId,x:10,y:20,width:100,height:80,labels:[],ports:[{side:'output',x:110,y:40}]});
 return {graph,view:{class:'RenderGraphView',graphId:owner,timelineId:'timeline',sceneItemsTruncated:false,sceneItems:[geometry('blur'),geometry('source-group')]}};
}
test('native graph identity resolves unlabeled nodes and binds the source group before fixture expansion',()=>{
 const {view,graph}=observed();assert.equal(graphNodeGeometry(view,graph,'blur').nodeId,'blur');assert.equal(graphGroupGeometry(view,graph,'source-group').nodeId,'source-group');
 assert.throws(()=>graphNodeOutputGeometry(view,graph,'source'),e=>e.status==='Blocked','A hidden member cannot supply an invented port');
 view.sceneItems.push({...view.sceneItems[0],nodeId:'source'});graph.presentation.groups[0].collapsed=false;
 assert.deepEqual(graphNodeOutputGeometry(view,graph,'source'),{side:'output',x:110,y:40});
});
test('foreign, incomplete or ambiguous observations never become physical targets',()=>{
 for(const mutate of [x=>x.view.graphId='clip:other:clip',x=>delete x.view.graphId,x=>x.view.timelineId='other',x=>x.view.sceneItemsTruncated=true,x=>x.graph.nodes[1].owners=['clip:other:clip'],x=>x.view.sceneItems.push({...x.view.sceneItems[0]}),x=>x.view.sceneItems[0].width=0]){
  const x=observed();mutate(x);assert.throws(()=>graphNodeGeometry(x.view,x.graph,'blur'),e=>e.status==='Blocked');
 }
 for(const mutate of [x=>x.view.sceneItems[0].ports.push({side:'output',x:111,y:50}),x=>x.view.sceneItems[0].ports[0].x=NaN]){
  const x=observed();mutate(x);assert.throws(()=>graphNodeOutputGeometry(x.view,x.graph,'blur'),e=>e.status==='Blocked');
 }
 for(const mutate of [x=>x.graph.presentation.groups[0].hidden=true,x=>x.graph.presentation.groups.push({...x.graph.presentation.groups[0]})]){
  const x=observed();mutate(x);assert.throws(()=>graphGroupGeometry(x.view,x.graph,'source-group'),e=>e.status==='Blocked');
 }
});
