import test from 'node:test';
import assert from 'node:assert/strict';
import {dockDragPoint,dockDropPoint,exposedDockDropPoint} from '../desktop/ui-workflows.mjs';

test('panel docking targets the named owned Qt dock tab rather than empty title bar or native chrome',()=>{
 const window={id:'float',window:'float',class:'ads::CFloatingDockContainer',title:'Media',visible:true,width:1085,height:234};
 const tab={id:'tab',window:'float',name:'dockWidgetTabLabel',text:'Media',visible:true,width:32,height:20};
 const bar={id:'bar',window:'float',class:'ads::CDockAreaTitleBar',visible:true,width:1085,height:26},unrelated={...tab,id:'other',window:'main'};
 const point=dockDragPoint({widgets:[window,unrelated,bar,tab]},'float');
 assert.equal(point.target,'tab');assert.equal(point.chrome,undefined);
 assert.ok(point.x>=0&&point.x<tab.width&&point.y>=0&&point.y<tab.height);
 for(const widgets of [[window,unrelated,bar],[window,tab,{...tab,id:'duplicate'}],[{...window,class:'MainWindow'},tab],[window,{...tab,text:'Preview'}]])assert.throws(()=>dockDragPoint({widgets},'float'));
});

test('dock drops use the destination panel area rather than a fraction of the main window',()=>{
 const area={id:'area',window:'main',class:'ads::CDockAreaWidget',x:411,y:0,width:1221,height:473};
 const panel={id:'preview',window:'main',parent:'area',class:'WizPanelDock',title:'Preview'};
 const other={...area,id:'foreign',window:'other',x:0,y:0,width:400,height:300};
 const point=dockDropPoint({widgets:[other,area,panel]},'main','Preview');
 assert.deepEqual(point,{toTarget:'main',toX:1021.5,toY:236.5});
 for(const widgets of [[other,panel],[area,{...panel,window:'other'}],[area,panel,{...panel,id:'duplicate'}]])assert.throws(()=>dockDropPoint({widgets},'main','Preview'));
});

test('cross-window docking rejects a destination covered by its floating source',()=>{
 const owner={id:'main',window:'main',nativeWindow:1,width:1000,height:700,x:0,y:0},source={id:'float',window:'float',class:'ads::CFloatingDockContainer',nativeWindow:2},area=(id,x)=>({id,window:'main',class:'ads::CDockAreaWidget',x,y:0,width:500,height:600}),panel=(id,title)=>({id:title,window:'main',class:'WizPanelDock',parent:id,title});
 const ui={widgets:[owner,source,area('preview',500),panel('preview','Preview'),area('media',0),panel('media','Media')]},native={windows:[{window:1,frame:{x:0,y:0,width:1000,height:728}},{window:2,frame:{x:500,y:0,width:500,height:728}}]};
 assert.equal(exposedDockDropPoint(ui,native,'main','float').toX,250);
 native.windows[1].frame={x:0,y:0,width:1000,height:728};assert.throws(()=>exposedDockDropPoint(ui,native,'main','float'),e=>e.status==='Blocked');
 assert.throws(()=>exposedDockDropPoint(ui,{windows:[]},'main','float'),e=>e.status==='Blocked');
});
