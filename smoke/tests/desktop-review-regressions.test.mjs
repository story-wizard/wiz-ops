import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const smoke=fileURLToPath(new URL('../',import.meta.url));
async function reviewedSource(relative){
 return process.env.ATHANOR_REVIEW_BASELINE
  ?execFileSync('/usr/bin/git',['-C',smoke,'show',process.env.ATHANOR_REVIEW_BASELINE+':smoke/'+relative],{encoding:'utf8'})
  :readFile(path.join(smoke,relative),'utf8');
}

test('pointer hit testing excludes the system cursor and still blocks real overlays',{skip:process.platform!=='darwin'},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-cursor-regression-'));
 try{
  const source=await readFile(path.join(smoke,'desktop/macos-input.swift'),'utf8'),start=source.indexOf('func pointerOverlay('),end=source.indexOf('func children(',start);assert.ok(start>=0&&end>start);
  const program=`import Foundation
import CoreGraphics
struct InputError:Error {let message:String,code:String,diagnostics:[String:Any]}
${source.slice(start,end)}
let cursor:[String:Any]=[kCGWindowOwnerName as String:"Window Server",kCGWindowOwnerPID as String:433,kCGWindowLayer as String:NSNumber(value:CGWindowLevelForKey(.cursorWindow))]
let target:[String:Any]=[kCGWindowOwnerPID as String:123,kCGWindowNumber as String:5]
let notification:[String:Any]=[kCGWindowOwnerName as String:"NotificationCenter",kCGWindowOwnerPID as String:456,kCGWindowNumber as String:9,kCGWindowLayer as String:25]
let capture:[String:Any]=[kCGWindowOwnerName as String:"Screenshot",kCGWindowOwnerPID as String:789,kCGWindowNumber as String:10,kCGWindowLayer as String:NSNumber(value:CGWindowLevelForKey(.cursorWindow))]
let systemUI:[String:Any]=[kCGWindowOwnerName as String:"Window Server",kCGWindowOwnerPID as String:433,kCGWindowLayer as String:25]
precondition(pointerOverlay(cursor));precondition(!pointerOverlay(target));precondition(!pointerOverlay(notification));precondition(!pointerOverlay(capture));precondition(!pointerOverlay(systemUI))
let top=[cursor,target].first{!pointerOverlay($0)}
try requirePointerWindow(top,at:CGPoint(x:10,y:10),pid:123,window:5,starting:true)
for cover in [notification,capture,systemUI]{
 do{try requirePointerWindow([cursor,cover,target].first{!pointerOverlay($0)},at:CGPoint(x:10,y:10),pid:123,window:5,starting:true);fatalError("Overlay allowed")}catch let error as InputError{precondition(error.code=="pointer_occluded")}
}
print("Cursor excluded; all real overlays blocked")
`;
  const file=path.join(root,'cursor.swift'),binary=path.join(root,'cursor');await writeFile(file,program);
  execFileSync('/usr/bin/swiftc',['-module-cache-path',path.join(root,'module-cache'),file,'-o',binary],{encoding:'utf8',timeout:60000});assert.match(execFileSync(binary,[],{encoding:'utf8'}),/all real overlays blocked/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('bounded scene inspection distinguishes exactly full data from omitted items',{skip:process.platform!=='darwin'||spawnSync('pkg-config',['--exists','Qt6Widgets']).status!==0},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-scene-limits-'));
 try{
  const original=await reviewedSource('desktop/native/bridge.cpp');
  const textStart=original.indexOf('if(auto* p=qobject_cast<QGraphicsView*>(w);p&&p->scene())'),textEnd=original.indexOf('// Read the packaged public getters',textStart);
  const itemsStart=original.indexOf('if(auto* p=qobject_cast<QGraphicsView*>(w);p&&p->scene())',textEnd),itemsEnd=original.indexOf('if(auto* p=qobject_cast<QTabBar*>',itemsStart);
  assert.ok(textStart>=0&&textEnd>textStart&&itemsStart>textEnd&&itemsEnd>itemsStart);
  const source=path.join(root,'probe.cpp'),binary=path.join(root,'probe');
  await writeFile(source,`#include <QtWidgets>
#include <dlfcn.h>
#include <iostream>
QString id(QObject*){return "fixture";}
QJsonObject observe(QWidget* w){QJsonObject item;${original.slice(textStart,textEnd)}${original.slice(itemsStart,itemsEnd)}return item;}
int main(int argc,char** argv){
 QApplication app(argc,argv);QGraphicsScene scene;QGraphicsView view(&scene);
 for(int i=0;i<128;i++){auto* item=scene.addRect(0,0,10,10);item->setFlag(QGraphicsItem::ItemIsSelectable);}
 for(int i=0;i<256;i++)scene.addText("label");
 auto full=observe(&view);std::cout<<QJsonDocument(full).toJson(QJsonDocument::Compact).toStdString()<<"\\n";
 scene.addRect(0,0,10,10)->setFlag(QGraphicsItem::ItemIsSelectable);scene.addText("extra");
 std::cout<<QJsonDocument(observe(&view)).toJson(QJsonDocument::Compact).toStdString()<<"\\n";
}
`);
  const flags=execFileSync('pkg-config',['--cflags','--libs','Qt6Widgets'],{encoding:'utf8'}).trim().split(/\s+/);
  execFileSync('/usr/bin/clang++',['-std=c++17',source,'-o',binary,...flags],{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});
  const [full,partial]=execFileSync(binary,[],{env:{...process.env,QT_QPA_PLATFORM:'offscreen'},encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}).trim().split('\n').map(JSON.parse);
  assert.equal(full.sceneItems.length,128);assert.equal(full.sceneText.length,256);assert.equal(full.sceneItemsTruncated,false);assert.equal(full.sceneTextTruncated,false);
  assert.equal(partial.sceneItems.length,128);assert.equal(partial.sceneText.length,256);assert.equal(partial.sceneItemsTruncated,true);assert.equal(partial.sceneTextTruncated,true);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('native wheel events retain the verified target point, not the previous cursor position',{skip:process.platform!=='darwin'},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-wheel-regression-'));
 try{
  const original=await reviewedSource('desktop/macos-input.swift'),start=original.indexOf('func scrollEvent('),end=original.indexOf('func emit(',start);assert.ok(start>=0&&end>start);
  const source=path.join(root,'wheel.swift'),binary=path.join(root,'wheel');
  await writeFile(source,'import Foundation\nimport CoreGraphics\n'+original.slice(start,end)+`\nlet point=CGPoint(x:987,y:654)\nguard let event=scrollEvent(at:point,deltaX:200,deltaY:100) else { fatalError("No event") }\nprecondition(event.location==point,"Wheel escaped its observed target")\nprecondition(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis1)==(-100))\nprecondition(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis2)==(-200))\nprint("Verified wheel point and deltas")\n`);
  execFileSync('/usr/bin/swiftc',['-module-cache-path',path.join(root,'module-cache'),source,'-o',binary],{encoding:'utf8',timeout:60000});
  assert.match(execFileSync(binary,[],{encoding:'utf8',timeout:5000}),/Verified wheel/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('media search rejects inert dispatch and waits for filtered results before clearing',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-search-regression-'));
 try{
  const original=await reviewedSource('desktop/check-paths.mjs');
  for(const mode of ['no-op','async-filter']){
   const owned=path.join(root,mode);await mkdir(owned);
   const session=path.join(owned,'session.json');await writeFile(session,JSON.stringify({root:owned,selectedChecks:['D-MEDIA-SEARCH'],main:{id:'tl_fixture'}}));
   const stub=path.join(owned,'adapter.mjs');
   await writeFile(stub,`import {appendFile} from 'node:fs/promises';
const full=['pattern_24.mov','motion_25.mp4','Secondary'];let query='',ticks=0,submitted=false;
export async function nativeCall(file,op,p={}){
 if(op==='text')query=p.text;
 if(op==='key'&&p.key==='Return'){submitted=true;ticks=0;}
 if(op!=='inspect')return {dispatched:true};
 if(submitted&&query)ticks++;
 const filtered=${JSON.stringify(mode)}==='async-filter'&&query==='pattern_24'&&submitted&&ticks>=4;
 const names=filtered?['pattern_24.mov']:full;
 const status=query?(filtered?'1 result':submitted?'Searching…':''):'';
 await appendFile(${JSON.stringify(path.join(owned,'trace.jsonl'))},JSON.stringify({query,names,status})+'\\n');
 return {widgets:[{id:'field',class:'MediaSearchField',text:query},{id:'tree',class:'QTreeView',model:names.map(x=>[x])},{name:'mediaSearchStatus',text:status}]};
}
export async function desktopCall(){return {timeline:{name:'Fixture'},tracks:[],links:[]};}
`);
   const transformed=original.replace(/from '(\.\.?\/[^']+)'/g,(match,relative)=>"from '"+pathToFileURL(relative==='./adapter.mjs'?stub:path.resolve(smoke,'desktop',relative)).href+"'");
   const executable=path.join(owned,'check-paths.mjs');await writeFile(executable,transformed);
   try{execFileSync(process.execPath,[executable,session],{encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']});}catch(e){if(e.status!==1)throw e;}
   const report=JSON.parse(await readFile(path.join(owned,'desktop-paths-report.json'),'utf8')),result=report.results.find(r=>r.id==='D-MEDIA-SEARCH');
   if(mode==='no-op')assert.notEqual(result.status,'Pass','An unchanged full media model must not prove search');
   else{
    assert.equal(result.status,'Pass',result.error);
    assert.deepEqual(result.evidence.results,['pattern_24.mov'],'Search evidence excludes known nonmatches');
    const trace=(await readFile(path.join(owned,'trace.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(trace.some(x=>x.query==='pattern_24'&&x.names.length===3),'Async boundary returned old rows before completion');
    const filteredAt=trace.findIndex(x=>x.query==='pattern_24'&&x.names.length===1);assert.ok(filteredAt>=0);
    assert.ok(trace.slice(filteredAt+1).some(x=>x.query===''&&x.names.length===3),'Clearing restores the complete original model');
   }
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a focused bin duplicate prepares no timeline and still detects a wrong reopened label',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-focused-bin-'));
 try{
  const source=path.join(root,'motion.mov'),state=path.join(root,'assets.json'),file=path.join(root,'session.json');await writeFile(source,'fixture bytes');
  await writeFile(state,JSON.stringify([{asset_id:'motion',display_name:'Motion',local_path:source}]));
  const session={root,bundle:root,pid:1,generation:1,assets:{motion:'motion'},selectedChecks:['D-BIN-DUPLICATE']};await writeFile(file,JSON.stringify(session));
  const stub=path.join(root,'adapter.mjs');
  await writeFile(stub,`import {readFile,writeFile} from 'node:fs/promises';
const state=${JSON.stringify(state)};let selected,menu=false,editing=null;
const assets=async()=>JSON.parse(await readFile(state,'utf8'));
export async function desktopCall(file,op){
 if(op==='media.list_assets')return {assets:await assets()};
 if(op==='project.checkpoint')return {};
 throw Error('Unrelated setup/action: '+op);
}
export async function nativeCall(file,op,p={}){
 const rows=await assets();
 if(op==='inspect')return {widgets:[{id:'main',class:'MainWindow',active:true},
  {id:'bin',window:'main',class:'QTreeView',model:rows.map(a=>[process.env.BAD_BIN_LABEL&&a.asset_id==='copy'?'Wrong label':a.display_name])},
  ...(menu?[{id:'menu',class:'QMenu',menuItems:[{text:'Duplicate',enabled:true,x:0,y:0,width:20,height:10},{text:'Rename...',enabled:true,x:0,y:20,width:20,height:10}]}]:[]),
  ...(editing?[{id:'edit',window:'main',class:'QLineEdit',text:editing.name}]:[])]};
 if(op==='item-click'){selected=rows.find(a=>a.display_name===p.text);menu=true;}
 if(op==='click'&&p.target==='menu'){
  menu=false;
  if(p.y<20){rows.push({...selected,asset_id:'copy',display_name:'Motion copy'});await writeFile(state,JSON.stringify(rows));}
  else editing={id:selected.asset_id,name:selected.display_name,value:selected.display_name};
 }
 if(op==='text')editing.value=p.text;
 if(op==='key'&&p.key==='Return'){rows.find(a=>a.asset_id===editing.id).display_name=editing.value;await writeFile(state,JSON.stringify(rows));editing=null;}
 return {dispatched:true};
}
export async function captureDesktopFailure(){return {};}
`);
  const rewrite=(source,folder)=>source.replace(/from '(\.\.?\/[^']+)'/g,(match,relative)=>"from '"+pathToFileURL(relative==='./adapter.mjs'?stub:relative==='./check-support.mjs'?path.join(root,'check-support.mjs'):path.resolve(smoke,folder,relative)).href+"'");
  const support=(await readFile(path.join(smoke,'desktop/check-support.mjs'),'utf8')).replace('const until=waitForObservation;','const until=fn=>waitForObservation(fn,{timeoutMs:100,intervalMs:1});');
  await writeFile(path.join(root,'check-support.mjs'),rewrite(support,'desktop'));
  const script=path.join(root,'check-selection-bin.mjs');await writeFile(script,rewrite(await reviewedSource('desktop/check-selection-bin.mjs'),'desktop'));
  execFileSync(process.execPath,[script,file],{encoding:'utf8',timeout:5000,stdio:['ignore','pipe','pipe']});
  const initial=JSON.parse(await readFile(path.join(root,'desktop-selection-bin-report.json')));assert.deepEqual(initial.results.map(r=>[r.id,r.status]),[['D-BIN-DUPLICATE','Pass']]);
  assert.equal(initial.results[0].evidence.independentName,true);assert.equal((JSON.parse(await readFile(state))).find(a=>a.asset_id==='motion').display_name,'Motion');
  await writeFile(file,JSON.stringify({...session,pid:2,generation:2}));
  execFileSync(process.execPath,[script,file,'verify'],{encoding:'utf8',timeout:5000,stdio:['ignore','pipe','pipe']});
  assert.equal(JSON.parse(await readFile(path.join(root,'desktop-bin-reopen-report.json'))).results[0].status,'Pass');
  assert.throws(()=>execFileSync(process.execPath,[script,file,'verify'],{env:{...process.env,BAD_BIN_LABEL:'1'},encoding:'utf8',timeout:5000,stdio:['ignore','pipe','pipe']}),e=>e.status===1);
  const wrong=JSON.parse(await readFile(path.join(root,'desktop-bin-reopen-report.json'))).results;
  assert.deepEqual(wrong.map(r=>[r.id,r.status]),[['D-BIN-DUPLICATE','Fail']]);assert.match(wrong[0].error,/missing Bin duplicate renamed/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('the production Swift pointer scope balances its down on focus loss, owner loss and completion',{skip:process.platform!=='darwin'},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-pointer-regression-'));
 try{
  const original=await reviewedSource('desktop/macos-input.swift');
  const start=original.indexOf('var held=false,lastPoint=from'),end=original.indexOf('let duration=',start);
  assert.ok(start>=0&&end>start,'Locate the production pointer scope');
  // Compile the real dispatch/cleanup scope with fake platform boundaries; never invoke HID or AX APIs.
  const block=original.slice(start,end);
  const guardStart=original.indexOf('func requirePointerWindow('),guardEnd=original.indexOf('func children(',guardStart);assert.ok(guardStart>=0&&guardEnd>guardStart);
  const program=`import Foundation
import CoreGraphics
struct InputError: Error { let message:String; var code="input_denied"; var diagnostics:[String:Any]=[:] }
func require(_ condition:Bool,_ message:String)throws{if !condition{throw InputError(message:message)}}
enum CGEventType {case leftMouseDown,leftMouseDragged,leftMouseUp}
enum CGMouseButton {case left}
enum CGEventTapLocation {case cghidEventTap}
enum CGEventField {case mouseEventClickState,eventSourceUserData}
final class CGEvent {
 var flags=CGEventFlags()
 var location:CGPoint
 let type:CGEventType
 init?(mouseEventSource:Any?,mouseType:CGEventType,mouseCursorPosition:CGPoint,mouseButton:CGMouseButton){type=mouseType;location=mouseCursorPosition}
 func setIntegerValueField(_ field:CGEventField,value:Int64){}
 func post(tap:CGEventTapLocation){events.append(type == .leftMouseDown ? "down" : type == .leftMouseUp ? "up" : "drag")}
}
final class AXUIElement {}
enum AXError {case success}
func AXUIElementCreateSystemWide()->AXUIElement{AXUIElement()}
func AXUIElementCopyElementAtPosition(_ element:AXUIElement,_ x:Float,_ y:Float,_ hit:inout AXUIElement?)->AXError{hit=AXUIElement();return .success}
func AXUIElementGetPid(_ element:AXUIElement,_ pid:inout Int32){pid=123}
func attribute(_ element:AXUIElement,_ name:String)->Any?{AXUIElement()}
func frame(_ element:AXUIElement)->CGRect?{CGRect(origin:CGPoint(x:0,y:0),size:CGSize(width:100,height:100))}
let kCGWindowOwnerPID="pid",kCGWindowNumber="number",kCGWindowOwnerName="owner",kCGWindowLayer="layer",kCGWindowBounds="bounds",kAXWindowAttribute="window"
${original.slice(guardStart,guardEnd)}
var events:[String]=[],owner=true,front=true,pointerCleanupReleased=false,inputInterrupted=false
let flags=CGEventFlags()
func verifyOwner()throws{try require(owner,"Owner gone")}
func foreground()->Bool{front}
func topWindow(_ point:CGPoint)->[String:Any]?{[kCGWindowOwnerPID:NSNumber(value:123),kCGWindowNumber:NSNumber(value:5)]}
func run(_ scenario:String)throws{
 let from=CGPoint(x:10,y:10),to=CGPoint(x:20,y:20),button=CGMouseButton.left,downType=CGEventType.leftMouseDown,upType=CGEventType.leftMouseUp,dragType=CGEventType.leftMouseDragged
 let windowServer=true,pid:Int32=123,number=NSNumber(value:5),bounds=CGRect(origin:CGPoint(x:0,y:0),size:CGSize(width:100,height:100))
 var dispatched=false,result:[String:Any]=[:]
 if scenario=="preinput-denial"{front=false}
 ${block}
 try mouse(downType,from)
 if scenario=="focus-lost"{front=false}
 if scenario=="owner-lost"{owner=false}
 try mouse(dragType,to)
 try mouse(upType,to)
 _=dispatched;_=result
}
for scenario in ["focus-lost","owner-lost","normal","preinput-denial"]{
 events=[];owner=true;front=true
 do{try run(scenario)}catch{}
 print(scenario+":"+events.joined(separator:","))
}
`;
  const swift=path.join(root,'probe.swift'),binary=path.join(root,'probe');await writeFile(swift,program);
  execFileSync('/usr/bin/swiftc',['-module-cache-path',path.join(root,'module-cache'),swift,'-o',binary],{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});
  const rows=Object.fromEntries(execFileSync(binary,[],{encoding:'utf8',timeout:5000}).trim().split('\n').map(x=>x.split(':')));
  for(const scenario of ['focus-lost','owner-lost'])assert.equal(rows[scenario],'down,up',scenario+' must release the driver’s outstanding press');
  assert.equal(rows.normal,'down,drag,up','Normal input releases exactly once');assert.equal(rows['preinput-denial'],'','Denied input emits no events');
 }finally{await rm(root,{recursive:true,force:true});}
});
