import test from 'node:test';
import assert from 'node:assert/strict';
import {graphNodeGeometry,graphOutputGeometry} from '../desktop/graph-geometry.mjs';

const owner='clip:timeline:clip',edge={from_node:'source',from_slot:'output',to_node:'blur',to_slot:'input',type:'pixel'};
function observed(){
 const graph={timeline_id:'timeline',clip_id:'clip',nodes:['source','blur'].map(node_id=>({node_id,owners:[owner]})),edges:[edge],presentation:{groups:[{id:'source-group',collapsed:true,hidden:false,members:['node:source']}]}};
 const geometry=nodeId=>({nodeId,x:10,y:20,width:100,height:80,labels:[],ports:[{side:'output',x:110,y:40}]});
 return {graph,view:{class:'RenderGraphView',graphId:owner,sceneItemsTruncated:false,sceneItems:[geometry('blur'),geometry('source-group')]}};
}
test('native graph identity resolves unlabeled nodes and a collapsed source boundary without hidden-node geometry',()=>{
 const {view,graph}=observed();
 assert.equal(graphNodeGeometry(view,graph,'blur').nodeId,'blur');
 assert.deepEqual(graphOutputGeometry(view,graph,edge),{side:'output',x:110,y:40});
 graph.edges.push({...edge,to_node:'another'}); // One producer may fan out through the same published boundary.
 assert.equal(graphOutputGeometry(view,graph,edge).x,110);
 graph.presentation.groups=[];view.sceneItems.push({...view.sceneItems[0],nodeId:'source'});
 assert.equal(graphOutputGeometry(view,graph,edge).x,110);
});
test('foreign, incomplete or ambiguous observations never become physical targets',()=>{
 for(const mutate of [
  x=>x.view.graphId='clip:other:clip',x=>x.view.sceneItemsTruncated=true,
  x=>x.graph.nodes[1].owners=['clip:other:clip'],
  x=>x.view.sceneItems.push({...x.view.sceneItems[0]}),
  x=>x.view.sceneItems[0].width=0,
 ]){const x=observed();mutate(x);assert.throws(()=>graphNodeGeometry(x.view,x.graph,'blur'),e=>e.status==='Blocked');}
 for(const mutate of [
  x=>x.graph.edges=[],x=>x.graph.nodes[0].owners=[],
  x=>x.graph.presentation.groups.push({...x.graph.presentation.groups[0],id:'other'}),
  x=>{x.graph.presentation.groups[0].members.push('node:blur');x.graph.edges.push({...edge,from_node:'blur',to_node:'external'});},
  x=>x.view.sceneItems[1].ports.push({side:'output',x:111,y:50}),
  x=>x.view.sceneItems[1].ports[0].x=NaN,
 ]){const x=observed();mutate(x);assert.throws(()=>graphOutputGeometry(x.view,x.graph,edge),e=>e.status==='Blocked');}
});
