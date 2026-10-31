import test from 'node:test';
import assert from 'node:assert/strict';
import {timelineToggle,trackHeaderPoint,timelineToolActive} from '../desktop/timeline-controls.mjs';
import {spellNodeGeometry} from '../desktop/graph-geometry.mjs';
import {spellBlurRadius} from '../desktop/spell-controls.mjs';

test('timeline toggles bind the owning panel even when another timeline has identical labels',()=>{
 const action=owner=>({id:owner,name:'timelineLinkedSelectionAction',owner,enabled:true,checked:false,checkable:true}),view={timelinePanel:'owned',window:'main'};
 assert.equal(timelineToggle({actions:[action('foreign'),action('owned')]},view,'linked').id,'owned');
 for(const actions of [[action('foreign')],[action('owned'),action('owned')],[{...action('owned'),enabled:false}]])assert.throws(()=>timelineToggle({actions},view,'linked'),e=>e.status==='Blocked');
 assert(timelineToolActive({widgets:[{window:'main',name:'toolbarTool_timeline_slip',enabled:true,checked:true,tooltip:'Slip (T)'}]},view,'Slip'));
 assert(!timelineToolActive({widgets:[{window:'other',name:'toolbarTool_timeline_slip',enabled:true,checked:true,tooltip:'Slip (T)'}]},view,'Slip'));
});
test('track headers use observed row placement and reject unreviewed layouts before input',()=>{
 const row={width:145,rowTop:240,rowHeight:60,kind:'video'};
 assert.deepEqual(trackHeaderPoint(row,'lock'),{x:21,y:283});
 assert.deepEqual(trackHeaderPoint(row,'target'),{x:129,y:256});
 assert.deepEqual(trackHeaderPoint({...row,rowTop:0,rowHeight:24,kind:'audio'},'lock'),{x:55,y:12});
 for(const change of [{width:160},{rowHeight:0},{rowTop:NaN},{kind:'unknown'}])assert.throws(()=>trackHeaderPoint({...row,...change},'lock'),e=>e.status==='Blocked');
});
test('Spell card targeting follows authored identity and position with no parameter-label dependency',()=>{
 const overview={document_id:'doc',document_fingerprint:'revision',nodes:[{node_ref:'native:stable',node_id:7,type:'gaussian_blur'}]},raw={document_id:'doc',document_fingerprint:'revision',state_source:'live_registry',scene:{graph_layout:{positions:{'node:7':[300,80]}}}},view={class:'DetachedGraphView',sceneItemsTruncated:false,sceneItems:[{sceneX:300,sceneY:80,width:100,height:200,labels:['Changed label']}]};
 assert.equal(spellNodeGeometry(view,overview,raw,'native:stable'),view.sceneItems[0]);
 for(const mutate of [x=>x.raw.document_id='other',x=>x.raw.document_fingerprint='stale',x=>x.view.sceneItemsTruncated=true,x=>x.view.sceneItems.push({...x.view.sceneItems[0]}),x=>x.raw.scene.graph_layout.positions={}]){const x=structuredClone({view,overview,raw});mutate(x);assert.throws(()=>spellNodeGeometry(x.view,x.overview,x.raw,'native:stable'),e=>e.status==='Blocked');}
 assert.equal(spellBlurRadius({controls:{horizontal_radius:{effective:17},vertical_radius:{effective:17},uniform_radius:{effective:true}}}),17);
 assert.throws(()=>spellBlurRadius({controls:{horizontal_radius:{effective:17},vertical_radius:{effective:5}}}));
});
