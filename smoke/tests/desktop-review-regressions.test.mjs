import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const smoke=fileURLToPath(new URL('../',import.meta.url));
async function reviewedSource(relative){
 return process.env.ATHANOR_REVIEW_BASELINE
  ?execFileSync('/usr/bin/git',['-C',smoke,'show',process.env.ATHANOR_REVIEW_BASELINE+':smoke/'+relative],{encoding:'utf8'})
  :readFile(path.join(smoke,relative),'utf8');
}

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

test('the production Swift pointer scope balances its down on focus loss, owner loss and completion',{skip:process.platform!=='darwin'},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-pointer-regression-'));
 try{
  const original=await reviewedSource('desktop/macos-input.swift');
  const start=original.indexOf('var held=false,lastPoint=from'),end=original.indexOf('let duration=',start);
  assert.ok(start>=0&&end>start,'Locate the production pointer scope');
  // Compile the real dispatch/cleanup scope with fake platform boundaries; never invoke HID or AX APIs.
  const block=original.slice(start,end);
  const program=`import Foundation
import CoreGraphics
struct InputError: Error { let message:String }
func require(_ condition:Bool,_ message:String)throws{if !condition{throw InputError(message:message)}}
enum CGEventType {case leftMouseDown,leftMouseDragged,leftMouseUp}
enum CGMouseButton {case left}
enum CGEventTapLocation {case cghidEventTap}
enum CGEventField {case mouseEventClickState,eventSourceUserData}
final class CGEvent {
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
let kCGWindowOwnerPID="pid",kCGWindowNumber="number",kAXWindowAttribute="window"
var events:[String]=[],owner=true,front=true,pointerCleanupReleased=false
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
