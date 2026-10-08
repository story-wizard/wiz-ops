import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {windowPoint,physicalInput,requireClipGeometry,validatePhysicalInput} from '../desktop/physical-input.mjs';
test('direct shared physical input rejects unsupported parameters before reading a session or sending input',async()=>{
 await assert.rejects(()=>physicalInput('/no-such-owned-session.json','drag',{target:'view',x:1,y:1,toX:2,toY:2,duration:800}),e=>e.status==='Blocked'&&e.code==='unknown_parameter');
 await assert.rejects(()=>physicalInput('/no-such-owned-session.json','key',{target:'view',key:'cmd+s',durationMs:800}),e=>e.status==='Blocked'&&e.code==='unknown_parameter');
});
test('clip binding compares numeric geometry regardless of JSON order and rejects stale or invalid rectangles',()=>{
 const actual={height:56,width:195,x:49,y:83};
 requireClipGeometry(actual,{x:49,y:83,width:195,height:56});
 for(const expected of [{...actual,x:50},{...actual,width:194}])assert.throws(()=>requireClipGeometry(actual,expected),e=>e.status==='Blocked'&&e.code==='input_binding_rejected');
 for(const expected of [{x:49},{...actual,width:0},{...actual,x:NaN},{...actual,width:'195'},null])assert.throws(()=>requireClipGeometry(actual,expected),e=>e.status==='Blocked'&&e.code==='invalid_clip_geometry');
 validatePhysicalInput('drag',{target:'view',x:1,y:1,toX:2,toY:2,durationMs:800,expectedClip:actual,clipId:'clip'});
 assert.throws(()=>validatePhysicalInput('drag',{target:'view',duration:800}),e=>e.code==='unknown_parameter');
});
test('pointer binding rejects clipped and offscreen controls before input',()=>{
 const window={id:'main',window:'main',width:200,height:100},native={frame:{width:200,height:128}},widget={id:'field',window:'main',x:10,y:5,width:100,height:40,visibleRect:{x:0,y:10,width:100,height:20}};
 assert.deepEqual(windowPoint(widget,window,native,50,20),{x:60,y:53});
 for(const point of [[50,5],[50,30]])assert.throws(()=>windowPoint(widget,window,native,...point),e=>e.status==='Blocked');
 assert.throws(()=>windowPoint({...widget,visibleRect:{x:0,y:0,width:0,height:0}},window,native,50,20),e=>e.status==='Blocked');
});
test('native gesture admission rejects escaped curves and malformed held modifiers without input',{skip:process.platform!=='darwin'},async()=>{
 const root=await mkdtemp('/private/tmp/athanor-gesture-contract-');
 try{
  const source=await readFile(new URL('../desktop/macos-input.swift',import.meta.url),'utf8'),helpers=source.slice(source.indexOf('func gestureModifiers('),source.indexOf('// Resolve the Unix process'));
  await writeFile(root+'/probe.swift','import Foundation\nimport CoreGraphics\nstruct InputError:Error {let message:String}\nfunc require(_ ok:Bool,_ message:String) throws {if !ok {throw InputError(message:message)}}\n'+helpers+`\nlet bounds=CGRect(x:0,y:0,width:200,height:100)
let request:[String:Any]=["command":"drag","window":10,"x":10.0,"y":10.0,"toX":80.0,"toY":20.0,"path":[["x":10.0,"y":10.0],["x":40.0,"y":50.0],["x":80.0,"y":20.0]],"modifiers":["shift","alt"]]
let path=try gesturePath(request,bounds);precondition(path?.count==3)
let modifiers=try gestureModifiers(request);precondition(modifiers.map{$0.1}==[56,58])
for change:[String:Any] in [["path":[["x":11.0,"y":10.0],["x":80.0,"y":20.0]]],["path":[["x":10.0,"y":10.0],["x":200.0,"y":20.0]]],["toWindow":11],["path":[]]] {var bad=request;bad.merge(change){_,new in new};var rejected=false;do{_ = try gesturePath(bad,bounds)}catch{rejected=true};precondition(rejected)}
for names in [["shift","shift"],["unknown"]] {var bad=request;bad["modifiers"]=names;var rejected=false;do{_ = try gestureModifiers(bad)}catch{rejected=true};precondition(rejected)}
print("Native curved path and modifier admission verified")\n`);
  execFileSync('/usr/bin/swiftc',['-module-cache-path',root+'/cache',root+'/probe.swift','-o',root+'/probe'],{timeout:60000});
  assert.match(execFileSync(root+'/probe',{encoding:'utf8',timeout:5000}),/admission verified/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('foreground readiness returns immediately when ready, waits for arrival and rejects absence',{skip:process.platform!=='darwin'},async()=>{
 const root=await mkdtemp('/private/tmp/athanor-foreground-');
 try{
  const source=await readFile(new URL('../desktop/macos-input.swift',import.meta.url),'utf8'),helper=source.slice(source.indexOf('@MainActor func waitForForeground('),source.indexOf('@main struct NativeInput'));
  await writeFile(root+'/probe.swift',`import Foundation
nonisolated(unsafe) var inputInterrupted=false
struct InputError:Error {let message:String}
func require(_ ok:Bool,_ message:String) throws {if !ok {throw InputError(message:message)}}
${helper}
@main struct Probe {static func main() async throws {
 let ready=try await waitForForeground({true});precondition(ready<100,"Ready input must not pay a fixed settling delay")
 var reads=0;_ = try await waitForForeground({reads+=1;return reads>=3});precondition(reads>=3)
 var rejected=false;do{_ = try await waitForForeground({false})}catch{rejected=true};precondition(rejected)
 inputInterrupted=true;rejected=false;do{_ = try await waitForForeground({false})}catch{rejected=true};precondition(rejected)
 print("Foreground readiness verified")
}}`);
  execFileSync('/usr/bin/swiftc',['-parse-as-library','-module-cache-path',root+'/cache',root+'/probe.swift','-o',root+'/probe'],{timeout:60000});assert.match(execFileSync(root+'/probe',{encoding:'utf8',timeout:5000}),/readiness verified/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('native window ownership ignores off-display placeholders but preserves real occlusion and secondary displays',{skip:process.platform!=='darwin'},async()=>{
 const root=await mkdtemp('/private/tmp/athanor-window-ownership-');
 try{
  const source=await readFile(new URL('../desktop/macos-input.swift',import.meta.url),'utf8'),helpers=source.slice(source.indexOf('func pointerOverlay('),source.indexOf('func requirePointerWindow('));
  await writeFile(root+'/probe.swift',`import Foundation
import CoreGraphics
${helpers}
func window(_ pid:Int,_ rect:CGRect,_ layer:Int=0) -> [String:Any] { [kCGWindowOwnerPID as String:pid,kCGWindowOwnerName as String:"App",kCGWindowLayer as String:layer,kCGWindowAlpha as String:1.0,kCGWindowBounds as String:rect.dictionaryRepresentation] }
let displays=[CGRect(x:0,y:0,width:1920,height:1080),CGRect(x:-1920,y:0,width:1920,height:1080)]
let placeholder=window(1,CGRect(x:1e9,y:1e9,width:1,height:1)),wizard=window(2,CGRect(x:0,y:0,width:900,height:800)),secondary=window(3,CGRect(x:-1500,y:20,width:500,height:500))
func pid(_ value:[String:Any]?) -> Int? { (value?[kCGWindowOwnerPID as String] as? NSNumber)?.intValue }
precondition(pid(topVisibleWindow([placeholder,wizard],displays:displays))==2)
precondition(pid(topVisibleWindow([placeholder,secondary,wizard],displays:displays))==3)
let overlay=window(4,CGRect(x:100,y:100,width:300,height:200),8)
precondition(pid(topVisibleWindow([overlay,wizard],displays:displays))==2)
precondition(pid(topVisibleWindow([overlay,wizard],displays:displays,at:CGPoint(x:150,y:150)))==4)
precondition(topVisibleWindow([wizard],displays:[])==nil)
precondition(topVisibleWindow([placeholder],displays:displays,at:CGPoint(x:1e9,y:1e9))==nil)
precondition(pid(topVisibleWindow([window(5,CGRect.zero),wizard],displays:displays))==2)
print("Display-bounded ownership verified")
`);
  execFileSync('/usr/bin/swiftc',['-module-cache-path',root+'/cache',root+'/probe.swift','-o',root+'/probe'],{timeout:60000});assert.match(execFileSync(root+'/probe',{encoding:'utf8',timeout:5000}),/ownership verified/);
 }finally{await rm(root,{recursive:true,force:true});}
});
