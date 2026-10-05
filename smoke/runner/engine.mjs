import {spawn,execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {mkdir,readFile,appendFile,open} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {inside,writeJSON} from './files.mjs';

export class OutcomeError extends Error{constructor(message,status='Fail'){super(message);this.status=status;}}
export function failureStatus(error){return ['Fail','Blocked','Unknown'].includes(error?.status)?error.status:'Fail';}
export function assert(condition,message){if(!condition)throw new OutcomeError(message);}
export function near(actual,expected,label){assert(Number.isFinite(actual)&&Math.abs(actual-expected)<1e-6,`${label}: expected ${expected}, observed ${actual}`);}
export const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function retainProcess(root,pid,group=false){
  const inspect=field=>execFileSync('/bin/ps',['-p',String(pid),'-o',field+'='],{encoding:'utf8',timeout:2000}).trim();
  const command=inspect('command'),started=inspect('lstart');
  assert(command.includes(root),'Owned process command must name its isolated workspace.');
  appendFileSync(path.join(root,'owned-processes.jsonl'),JSON.stringify({pid,command,started,group})+'\n');
}
export function command(file,args,{env,cwd,timeout=20000,signal,processGroup=false,onSpawn}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return resolve({code:null,stdout:'',stderr:'',aborted:true});
    const child=spawn(file,args,{env,cwd,detached:processGroup,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',timedOut=false,overflow=false,aborted=false,force;
    const kill=sig=>{if(child.pid)try{process.kill(processGroup?-child.pid:child.pid,sig);}catch(error){if(error.code!=='ESRCH')throw error;}};
    const stop=()=>{kill('SIGTERM');if(!force)force=setTimeout(()=>kill('SIGKILL'),1000);};
    const abort=()=>{aborted=true;stop();};signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{timedOut=true;stop();},timeout);
    if(child.pid&&onSpawn)try{onSpawn(child.pid);}catch(e){stop();clearTimeout(timer);reject(e);}
    child.stdout.on('data',d=>{stdout+=d;if(stdout.length>8*1024*1024&&!overflow){overflow=true;stop();}});
    child.stderr.on('data',d=>{if(stderr.length<256*1024)stderr+=d;});
    child.on('error',e=>{clearTimeout(timer);clearTimeout(force);signal?.removeEventListener('abort',abort);reject(e);});
    child.on('close',(code,exitSignal)=>{clearTimeout(timer);clearTimeout(force);signal?.removeEventListener('abort',abort);resolve({code,signal:exitSignal,stdout,stderr,timedOut,overflow,aborted});});
  });
}
export function parseEnvelope(receipt,operation,expectedError){
  if(receipt.timedOut||receipt.overflow||receipt.aborted)throw new OutcomeError(`${operation}: command outcome is unknown; no retry was made.`,'Unknown');
  let envelope;try{envelope=JSON.parse(receipt.stdout);}catch{const detail=(receipt.stderr||'').trim().slice(0,500);throw new OutcomeError(`${operation}: invalid JSON response (exit ${receipt.code}); outcome unknown.${detail?' CLI: '+detail:''}`,'Unknown');}
  if(expectedError){assert(envelope.ok===false&&receipt.code!==0,`${operation} unexpectedly succeeded`);assert(expectedError.includes(envelope.error?.code),`${operation}: expected ${expectedError.join('/')}, observed ${envelope.error?.code}`);return envelope;}
  assert(receipt.code===0&&envelope.ok===true,`${operation}: ${envelope.error?.code||'exit '+receipt.code}: ${envelope.error?.message||(receipt.stderr||'').slice(0,500)}`);
  assert(Object.hasOwn(envelope,'result'),`${operation}: result is absent`);return envelope;
}
export class PackagedEngine{
  constructor(plan,root,runId,schema){this.plan=plan;this.root=root;this.runId=runId;this.schema=schema;this.macos=path.join(plan.app,'Contents/MacOS');this.counter=0;this.generation=0;this.revisions=new Map();}
  async start(){
    this.stopping=null;
    this.generation++;const runtime=path.join(this.root,`runtime-${this.generation}`),settings=path.join(this.root,'settings'),temp=path.join(this.root,'tmp');
    for(const dir of [runtime,settings,temp])await mkdir(dir,{recursive:true,mode:0o700});
    this.env={PATH:`${this.macos}:/usr/bin:/bin`,HOME:process.env.HOME||'',LANG:'en_US.UTF-8',TMPDIR:temp,WIZSERVER_RUNTIME_DIR:runtime,WIZSERVER_SANDBOX_ROOT:this.root,WIZARD_SETTINGS:settings,WIZARD_MACOS_DIR:this.macos,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'};
    const out=await open(path.join(this.root,`engine-${this.generation}.stdout.log`),'a'),err=await open(path.join(this.root,`engine-${this.generation}.stderr.log`),'a');
    this.child=spawn(path.join(this.macos,'wizard-headless'),['--port','0','--sandbox-root',this.root],{env:this.env,stdio:['ignore',out.fd,err.fd]});
    if(this.child.pid)try{retainProcess(this.root,this.child.pid);}catch(error){this.child.kill('SIGTERM');await out.close();await err.close();throw error;}
    this.spawnError=null;this.child.on('error',e=>{this.spawnError=e;});await out.close();await err.close();
    const deadline=Date.now()+15000;
    while(Date.now()<deadline){
      if(this.spawnError)throw this.spawnError;
      assert(this.child.exitCode===null&&!this.child.signalCode,'Owned engine exited during startup.');
      let endpoint;try{endpoint=JSON.parse(await readFile(path.join(runtime,'headless.json'),'utf8'));}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
      if(endpoint){assert(endpoint.pid===this.child.pid&&endpoint.kind==='headless'&&endpoint.protocol===1&&Number.isInteger(endpoint.port)&&endpoint.port>0&&endpoint.port<65536,'Endpoint identity does not match the process we started.');this.url=`http://127.0.0.1:${endpoint.port}`;this.endpoint=endpoint;await writeJSON(path.join(runtime,'owned-endpoint.json'),endpoint);return;}
      await pause(50);
    }
    throw new OutcomeError('Owned engine did not publish its endpoint within 15 seconds.','Blocked');
  }
  async stop(){
    this.ingestController?.abort();
    if(this.stopping)return this.stopping;
    const child=this.child;if(!child?.pid||child.exitCode!==null||child.signalCode)return;
    this.stopping=(async()=>{const closed=new Promise(resolve=>child.once('close',resolve));child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await closed;clearTimeout(timer);})();
    return this.stopping;
  }
  async call(bundle,operation,params={},expectedError){
    assert(this.child&&this.child.exitCode===null&&!this.child.signalCode,'The owned engine is not alive.');
    assert(inside(this.root,bundle)&&bundle.endsWith('.wiz'),'Refusing a bundle outside the run directory.');
    const definition=this.schema.operations[operation];assert(definition,`Unknown packaged operation ${operation}`);
    const body={...params};if(definition.properties?.expect_revision&&!body.expect_revision){assert(this.revisions.get(bundle),'No observed revision is available for mutation.');body.expect_revision=this.revisions.get(bundle);}
    const full={...body,bundle};for(const key of definition.required||[])assert(Object.hasOwn(full,key),`${operation}: missing required parameter ${key}`);
    if(definition.additionalProperties===false)for(const key of Object.keys(full))assert(Object.hasOwn(definition.properties,key),`${operation}: unexpected parameter ${key}`);
    const [group,op]=operation.split('.');const started=Date.now();
    const receipt=await command(path.join(this.macos,'wiz-cli'),[group,op.replaceAll('_','-'),'--url',this.url,'--no-spawn','--bundle',bundle,'--actor',`system:smoke:${this.runId}`,'--params',JSON.stringify(body),'--json'],{env:this.env,timeout:Math.max(1,Math.min(20000,(this.deadline||Infinity)-Date.now()))});
    await appendFile(path.join(this.root,'operations.jsonl'),JSON.stringify({sequence:++this.counter,caseId:this.caseId,stepId:this.stepId||null,expectedError:expectedError||null,startedAt:new Date(started).toISOString(),durationMs:Date.now()-started,operation,params:full,...receipt})+'\n');
    const envelope=parseEnvelope(receipt,operation,expectedError);
    if(envelope.ok&&typeof envelope.bundle_version==='string'&&envelope.bundle_version)this.revisions.set(bundle,envelope.bundle_version);
    return envelope.result;
  }
}
export function snapshotState(snapshot){
  assert(snapshot.next_cursor===null||snapshot.next_cursor===undefined,'Snapshot is paginated; incomplete evidence is not accepted.');
  assert(snapshot.timeline&&Array.isArray(snapshot.tracks),'Malformed timeline snapshot.');
  return {timeline:snapshot.timeline,tracks:snapshot.tracks,links:snapshot.links};
}
export const clips=snapshot=>snapshot.tracks.flatMap(t=>t.items.filter(i=>i.kind==='clip'));
export function clip(snapshot,id){const found=clips(snapshot).find(c=>c.clip_id===id);assert(found,`Missing clip ${id}`);return found;}
export function bounds(c,start,end,sourceStart,sourceEnd){near(c.timeline_range.start_seconds,start,'Timeline start');near(c.timeline_range.end_seconds,end,'Timeline end');if(sourceStart!==undefined){near(c.source.source_range?.start_seconds,sourceStart,'Source start');near(c.source.source_range?.end_seconds,sourceEnd,'Source end');}}
export function same(actual,expected,label){assert(isDeepStrictEqual(actual,expected),`${label}: observed state differs from expected state.`);}
