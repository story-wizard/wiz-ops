import test from 'node:test';
import assert from 'node:assert/strict';
import {dockDragPoint} from '../desktop/ui-workflows.mjs';

test('panel docking targets the owned Qt title bar rather than macOS window chrome',()=>{
 const window={id:'float',window:'float',class:'ads::CFloatingDockContainer',visible:true,width:1085,height:234};
 const bar={id:'bar',window:'float',class:'ads::CDockAreaTitleBar',visible:true,width:1085,height:26};
 const unrelated={...bar,id:'other',window:'main'};
 const point=dockDragPoint({widgets:[window,unrelated,bar]},'float');
 assert.equal(point.target,'bar');assert.equal(point.chrome,undefined);
 assert.ok(point.x>=0&&point.x<bar.width&&point.y>=0&&point.y<bar.height);
 for(const widgets of [[window,unrelated],[window,bar,{...bar,id:'duplicate'}],[{...window,class:'MainWindow'},bar]])assert.throws(()=>dockDragPoint({widgets},'float'));
});
