import test from 'node:test';
import {ownedRuntime} from './fixtures/owned-runtime.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,mkdir,realpath,writeFile,readFile,lstat,rm,rename,symlink,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {registerDisposableApp,retireDisposableApp,inspectDisposableApp} from '../desktop/disposable-app.mjs';
async function fixture(t){
 const data=await realpath(await mkdtemp(path.join(tmpdir(),'athanor-retire-'))),root=path.join(data,'desktop-Test'),app=path.join(root,'Wizard Smoke.app'),sourceApp=path.join(data,'Official.app'),file=path.join(root,'session.json');
 t.after(()=>rm(data,{recursive:true,force:true}));await mkdir(path.join(app,'Contents/MacOS/logs'),{recursive:true});await mkdir(sourceApp);await writeFile(path.join(sourceApp,'keep'),'official');await writeFile(path.join(app,'Contents/MacOS/logs/log.txt'),'diagnostic');await writeFile(path.join(root,'evidence.txt'),'evidence');await mkdir(path.join(root,'Golden.wiz'));
 const session={root,dataDir:data,app,sourceApp,guiHash:'a'.repeat(64),state:'Stopped',generation:0};await writeJSON(file,session);const record=await registerDisposableApp(session);await mkdir(path.join(record.mirror,'Contents/MacOS/logs'),{recursive:true});await writeFile(path.join(record.mirror,'Contents/MacOS/logs/mirror.txt'),'mirror diagnostic');await writeJSON(file,session);
 let acquired=0,released=0;return {data,root,app,sourceApp,file,session,record,options:{acquire:async()=>{acquired++;return {release:async()=>{released++;}};}},counts:()=>({acquired,released})};
}
const terminal={status:'Pass',known:true,phase:'terminal-test'};
const exists=async p=>{try{await lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
test('terminal cleanup removes only registered stopped App and exact Python mirror, retaining logs, project, evidence and source',async t=>{
 const f=await fixture(t),neighbor=path.join(f.root,'home/Library/Caches/Wizard/python/neighbor');await writeFile(neighbor,'keep');
 const child=spawn(process.execPath,['-e','process.stdout.write("ready");setInterval(()=>{},1000)']);await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);});const closed=new Promise(resolve=>child.once('close',resolve));child.kill();await closed;f.session.pid=child.pid;f.session.generation=1;await writeJSON(f.file,f.session);
 const r=await retireDisposableApp(f.file,terminal,f.options);assert.equal(r.state,'Retired',r.reason);assert.deepEqual(new Set(r.removed),new Set([f.app,f.record.mirror]));assert.deepEqual(f.counts(),{acquired:1,released:1});assert.equal((await inspectDisposableApp(f.file)).paths.every(x=>!x.exists),true);assert.equal(await readFile(path.join(f.root,'retired-app-logs/log.txt'),'utf8'),'diagnostic');assert.equal(await readFile(path.join(f.root,'retired-mirror-logs/mirror.txt'),'utf8'),'mirror diagnostic');assert.equal(await readFile(path.join(f.sourceApp,'keep'),'utf8'),'official');assert.equal(await readFile(neighbor,'utf8'),'keep');assert.equal(await readFile(path.join(f.root,'evidence.txt'),'utf8'),'evidence');assert.equal(await exists(path.join(f.root,'Golden.wiz')),true);assert.equal((await readJSON(path.join(f.root,'disposable-app-retirement.json'))).state,'Retired');
});
for(const [name,edit,outcome] of [
 ['active process',s=>s.pid=process.pid,terminal],['attached session',s=>s.state='Attached',terminal],['uncertain input',s=>s.agentUncertain=true,terminal],['Unknown terminal group',()=>{},{status:'Unknown',known:true}],['unconfirmed cleanup',()=>{},{status:'Fail',known:false}]
])test(name+' preserves the registered disposable copies',async t=>{const f=await fixture(t);edit(f.session);await writeJSON(f.file,f.session);const r=await retireDisposableApp(f.file,outcome,f.options);assert.equal(r.state,'Retained');assert.deepEqual(await readJSON(path.join(f.root,'disposable-app-retirement.json')),r);assert.equal(await exists(f.app),true);assert.equal(await exists(f.record.mirror),true);assert.deepEqual(f.counts(),{acquired:0,released:0});});
for(const lock of ['agent-action.lock','call.lock','native-call.lock'])test('pending '+lock+' protects all evidence and App copies',async t=>{const f=await fixture(t);await writeFile(path.join(f.root,lock),'pending');const r=await retireDisposableApp(f.file,terminal,f.options);assert.equal(r.state,'Retained');assert.equal(await exists(f.app),true);});
test('unregistered, substituted and redirected copies cannot be deleted',async t=>{
 for(const mode of ['unregistered','replacement','session-link','registration-link','mirror-link']){const f=await fixture(t);if(mode==='unregistered')await rm(path.join(f.root,'disposable-app.json'));if(mode==='replacement'){await rename(f.app,f.app+'.original');await mkdir(f.app);}if(mode.endsWith('-link')){const target=mode==='session-link'?f.file:mode==='registration-link'?path.join(f.root,'disposable-app.json'):f.record.mirror;await rename(target,target+'.original');await symlink(target+'.original',target);}const r=await retireDisposableApp(f.file,terminal,f.options);assert.equal(r.state,'Retained',mode);assert.equal(await exists(f.app),true,mode);}
});
test('fresh process inspection, descendant identity and registry changes protect deletion',async t=>{
 for(const mode of ['reference','inspection-denied','child','registration-race','target-race']){const f=await fixture(t);const opts={...f.options};if(mode==='reference')opts.processes=()=>[{pid:123,ppid:1,executable:f.app+'/Contents/MacOS/wizard',kind:'executable',paths:[f.app+'/Contents/MacOS/wizard']}];if(mode==='inspection-denied')opts.processes=()=>{throw Error('inspection denied');};if(mode==='child')await writeFile(path.join(f.root,'owned-children.jsonl'),JSON.stringify({pid:process.pid})+'\n');if(mode.endsWith('-race'))opts.acquire=async()=>{if(mode==='registration-race'){const r=await readJSON(path.join(f.root,'disposable-app.json'));r.packageHash='b'.repeat(64);await writeJSON(path.join(f.root,'disposable-app.json'),r);}else{await rename(f.app,f.app+'.original');await mkdir(f.app);}return {release:async()=>{}};};const r=await retireDisposableApp(f.file,terminal,opts);assert.equal(r.state,'Retained',mode);assert.equal(await exists(f.app),true,mode);assert.equal(await exists(f.record.mirror),true,mode);}
});

test('a denied foreground lease retains the stopped registered App',async t=>{const f=await fixture(t);const r=await retireDisposableApp(f.file,terminal,{acquire:async()=>{throw Error('desktop occupied');}});assert.equal(r.state,'Retained');assert.match(r.reason,/desktop occupied/);assert.equal(await exists(f.app),true);assert.equal(await exists(f.record.mirror),true);});
test('Unknown launch outside a current check remains Unknown for retirement even after confirmed stop',async t=>{
 const f=await fixture(t),desktop=new URL('../desktop/',import.meta.url),stub=path.join(f.data,'fixture.mjs'),module=path.join(f.data,'group-under-test.mjs');
 await writeFile(stub,`export async function prepareDesktop(){return ${JSON.stringify({...f.session,schema:{operations:[]}})};}export async function launchDesktop(){throw Object.assign(Error('lost launch response'),{status:'Unknown'});}export async function captureDesktopFailure(){return {};}export async function stopDesktop(){}export async function terminateOwnedDesktop(){}export function retainChild(){}export async function desktopCall(){}export async function nativeCall(){}`);
 for(const name of await readdir(desktop))await symlink(fileURLToPath(new URL(name,desktop)),path.join(f.data,name));
 const source=await readFile(new URL('run.mjs',desktop),'utf8');await writeFile(module,source.replace(/from '(\.\.?\/[^']+)'/g,(_,relative)=>"from '"+(relative==='./adapter.mjs'?pathToFileURL(stub).href:new URL(relative,desktop).href)+"'"));
 const {executeDesktopGroup}=await import(pathToFileURL(module));const {report}=await executeDesktopGroup({runtime:{app:f.sourceApp},ids:['D-CLI-01']});assert.equal(report.errorStatus,'Unknown');assert.equal(report.storage.state,'Retained');assert.equal(report.storage.terminal.status,'Unknown');assert.equal(await exists(f.app),true);assert.equal(await exists(f.record.mirror),true);
});

async function externalProcess(t,script,...args){
 const child=spawn(process.execPath,['-e',script,...args],{stdio:['ignore','pipe','pipe']});const closed=new Promise(resolve=>child.once('close',resolve));t.after(async()=>{child.kill('SIGTERM');await closed;});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('close',()=>reject(Error('Process fixture exited before readiness')));});return {child,stop:async()=>{child.kill('SIGTERM');await closed;}};
}
test('an App path mentioned only in another process argument does not retain stopped copies',async t=>{
 const f=await fixture(t),p=await externalProcess(t,'process.stdout.write("ready");setInterval(()=>{},1000)',f.app,f.record.mirror);
 const r=await retireDisposableApp(f.file,terminal,f.options);assert.equal(r.state,'Retired',r.reason);assert.equal(p.child.exitCode,null);assert.equal(await exists(f.app),false);assert.equal(await exists(f.record.mirror),false);await p.stop();
});
test('a real executable inside either registered App directory protects copies and retains bounded owner diagnostics',async t=>{
 for(const target of ['primary','mirror']){const f=await fixture(t),executable=path.join(target==='primary'?f.app:f.record.mirror,'Contents/MacOS/wizard'),child=await ownedRuntime(t,executable);
  const r=await retireDisposableApp(f.file,terminal,f.options);assert.equal(r.state,'Retained');assert.equal(await exists(f.app),true);assert.equal(await exists(f.record.mirror),true);assert.ok(r.diagnostics.references.some(p=>p.pid===child.pid&&p.executable===executable));assert.ok(r.diagnostics.references.length<=16);assert.deepEqual(await readJSON(path.join(f.root,'disposable-app-retirement.json')),r);const closed=new Promise(resolve=>child.once('close',resolve));child.kill('SIGTERM');await closed;
 }
});
test('an external process holding an App file open protects it until the real reference closes',async t=>{
 const f=await fixture(t),held=path.join(f.app,'Contents/MacOS/logs/log.txt'),p=await externalProcess(t,'globalThis.fd=require("node:fs").openSync(process.argv[1],"r");process.stdout.write("ready");setInterval(()=>{},1000)',held);
 const retained=await retireDisposableApp(f.file,terminal,f.options);assert.equal(retained.state,'Retained');assert.ok(retained.diagnostics.references.some(x=>x.pid===p.child.pid&&x.paths.includes(held)));assert.equal(await exists(f.app),true);await p.stop();const retired=await retireDisposableApp(f.file,terminal,f.options);assert.equal(retired.state,'Retired',retired.reason);assert.equal(await exists(f.app),false);
});
