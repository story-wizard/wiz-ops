import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('foreground ownership ignores off-display WindowManager placeholders while retaining visible occluders',{skip:process.platform!=='darwin'},async()=>{
 const source=await readFile(new URL('../desktop/macos-input.swift',import.meta.url),'utf8');
 const helper=source.split('\n').filter(line=>line.startsWith('func windowIntersectsDisplay(')||line.startsWith('func dockHitBlocksPointer(')).join('\n');assert.ok(helper);
 const root=await mkdtemp(path.join(tmpdir(),'athanor-visible-window-'));
 try{
  const file=path.join(root,'test.swift');await writeFile(file,`import Foundation\nimport CoreGraphics\nimport ApplicationServices\n${helper}\nlet displays=[CGRect(x:0,y:0,width:1676,height:908),CGRect(x:-1200,y:0,width:1200,height:800)]\nprecondition(!windowIntersectsDisplay(CGRect(x:1000000000,y:1000000000,width:1,height:1),displays))\nprecondition(windowIntersectsDisplay(CGRect(x:418,y:207,width:820,height:528),displays))\nprecondition(windowIntersectsDisplay(CGRect(x:1670,y:200,width:100,height:100),displays))\nprecondition(windowIntersectsDisplay(CGRect(x:-1100,y:100,width:100,height:100),displays))\nprecondition(!windowIntersectsDisplay(CGRect(x:10,y:10,width:0,height:20),displays))\nprecondition(!dockHitBlocksPointer(.noValue))\nprecondition(dockHitBlocksPointer(.success))\nprecondition(dockHitBlocksPointer(.cannotComplete))\nprecondition(dockHitBlocksPointer(.apiDisabled))\n`);
  const r=spawnSync('/usr/bin/swift',[file],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  assert.match(source,/windowIntersectsDisplay\(r,displayBounds\) && \(at\.map\(r\.contains\)/);
 }finally{await rm(root,{recursive:true,force:true});}
});
