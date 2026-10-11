import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {ROOT,readJSON,externalPath,digest} from '../runner/files.mjs';
import {checkWorkerProfile,workerClient} from '../runner/worker.mjs';
import {resolveSelection} from '../runner/catalog.mjs';
import {connect} from '../runner/store.mjs';
import {JobStore} from '../runner/jobs.mjs';
import {JobController} from '../runner/controller.mjs';
import {verifyOwnerRoute} from '../runner/delivery.mjs';
import {slackSender} from '../runner/slack-delivery.mjs';
import {readJobBrief,readJobReport,retainInvestigationHandoff} from '../runner/job-handoff.mjs';

export async function main(args){
 const command=args.shift(),flags={};for(let i=0;i<args.length;i++){const key=args[i],value=args[++i];if(!key?.startsWith('--')||Object.hasOwn(flags,key)||!value||value.startsWith('--'))throw Error('Invalid controller option.');flags[key]=value;}
 const allowed={init:['--config','--profile','--route'],submit:['--config','--file'],status:['--config','--id'],brief:['--config','--id'],handoff:['--config','--id'],list:['--config'],schedule:['--config','--file'],enable:['--config'],pause:['--config'],cancel:['--config','--id'],tick:['--config'],serve:['--config'],service:['--config','--out','--label']};
 if(!allowed[command]||Object.keys(flags).some(k=>!allowed[command].includes(k)))throw Error('Usage: controller init | submit | status | brief | handoff | list | schedule | enable | pause | cancel | tick | serve | service. See docs/job-controller.md.');
 const required=k=>{if(!flags[k])throw Error('Required option: '+k);return flags[k];},file=externalPath(path.resolve(required('--config')));
 if(command==='init'){
  const profileFile=externalPath(path.resolve(required('--profile'))),profile=await checkWorkerProfile(await readJSON(profileFile));
  const route=flags['--route']?verifyOwnerRoute(await readJSON(flags['--route'])):null,config={format:'athanor-controller/v1',profileFile,profileHash:digest(profile),delivery:route?'slack':'local',route};
  await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});return {path:file,config,scheduleEnabled:false,wizardLaunched:false};
 }
 const config=await readJSON(file);
 if(config?.format!=='athanor-controller/v1'||Object.keys(config).some(k=>!['format','profileFile','profileHash','delivery','route'].includes(k))||!['local','slack'].includes(config.delivery)||!path.isAbsolute(config.profileFile||'')||!/^[a-f0-9]{64}$/.test(config.profileHash||''))throw Error('Invalid controller configuration.');
 const profile=await checkWorkerProfile(await readJSON(config.profileFile));if(digest(profile)!==config.profileHash)throw Error('Pinned worker profile changed; preserve queued jobs before migrating.');
 if(config.delivery==='slack')verifyOwnerRoute(config.route);else if(config.route!==null)throw Error('Local-only controller must have no Slack route.');
 if(command==='service'){
  const label=flags['--label']||'com.storywizard.athanor.controller';if(!/^com\.storywizard\.athanor\.[A-Za-z0-9.-]+$/.test(label))throw Error('Use a task-owned Athanor service label.');
  const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${escape(label)}</string><key>ProgramArguments</key><array>${[process.execPath,path.join(ROOT,'scripts/controller.mjs'),'serve','--config',file].map(v=>'<string>'+escape(v)+'</string>').join('')}</array><key>WorkingDirectory</key><string>${escape(ROOT)}</string><key>LimitLoadToSessionType</key><string>Aqua</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(path.dirname(process.execPath))}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict><key>StandardOutPath</key><string>${escape(path.join(profile.dataDir,'controller.stdout.log'))}</string><key>StandardErrorPath</key><string>${escape(path.join(profile.dataDir,'controller.stderr.log'))}</string></dict></plist>`;
  const out=externalPath(path.resolve(required('--out')));await writeFile(out,plist,{flag:'wx',mode:0o600});return {path:out,label,started:false,domain:'gui/'+process.getuid()};
 }
 const store=new JobStore(profile.dataDir),resolve=input=>{const db=connect(profile.dataDir);try{return resolveSelection(db,input);}finally{db.close();}};
 try{
  if(command==='status'){if(flags['--id']){const job=store.get(flags['--id']);if(!job)throw Error('Job not found.');return {brief:await readJobBrief(store,job),job,events:store.events(job.id)};}return {schedule:store.schedule(),jobs:store.list().map(j=>({id:j.id,state:j.state,outcome:j.outcome||null,runId:j.runId||null,delivery:j.delivery||null,deadline:j.deadline,lastError:j.lastError||null,error:j.error||null,report:j.report||null,handoff:j.handoff?{state:j.handoff.state,id:j.handoff.id||null,error:j.handoff.error||null}:null}))};}
  if(command==='brief'){const job=store.get(required('--id'));if(!job)throw Error('Job not found.');return readJobBrief(store,job);}
  if(command==='handoff'){
   const lease=store.claim();if(!lease)throw Error('Controller owns progression; wait before reconciling a handoff.');
   try{const job=store.get(required('--id'));if(!job?.report)throw Error('Retain the completed local report before reconciling its handoff.');
    if(job.profileHash!==config.profileHash)throw Error('Job belongs to another pinned worker profile. Preserve its source before reconciling.');
    const report=await readJobReport(store,job),{call}=await workerClient(config.profileFile);
    return await retainInvestigationHandoff(store,job,report,call,{reconcile:true});
   }finally{store.release(lease);}
  }
  if(command==='list')return store.list();
  if(command==='submit'){const request=await readJSON(required('--file'));return store.submit(request,resolve(request.selection),digest(profile));}
  if(command==='schedule'){const input=await readJSON(required('--file'));if(Object.keys(input).some(k=>!['timeZone','hour','minute','request'].includes(k)))throw Error('Unknown schedule field.');return store.saveSchedule({...input,selection:resolve(input.request.selection),profileHash:digest(profile)});}
  if(command==='pause')return store.enable(false);
  if(command==='cancel')return store.cancel(required('--id'));
  let send=null;
  if(config.delivery==='slack'){const sender=slackSender(config.route);await sender.verify();send=sender.send;}
  if(command==='enable'){if(store.schedule()?.profileHash!==digest(profile))throw Error('Save and review a schedule for this pinned worker before enabling.');return store.enable(true);}
  const {call}=await workerClient(config.profileFile),controller=new JobController(store,{profile,call,route:config.route,send});
  if(command==='tick')return controller.tick();
  let stopping=false;const stop=()=>{stopping=true;};process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try{while(!stopping){try{const value=await controller.tick();if(value.state!=='Idle')console.log(JSON.stringify({format:'athanor-controller-event/v1',at:new Date().toISOString(),result:{id:value.id||null,state:value.state,outcome:value.outcome||null,runId:value.runId||null,reason:value.reason||null,error:value.error||null,delivery:value.delivery||null}}));}catch(e){console.error(JSON.stringify({format:'athanor-controller-event/v1',at:new Date().toISOString(),error:e.message}));}
   if(!stopping)await new Promise(resolve=>{const finish=()=>{clearTimeout(timer);process.removeListener('SIGTERM',finish);process.removeListener('SIGINT',finish);resolve();},timer=setTimeout(finish,10000);process.once('SIGTERM',finish);process.once('SIGINT',finish);});
  }}finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}return {state:'Stopped',activeRunsRetained:true};
 }finally{store.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify({format:'athanor-controller-cli/v1',result:await main(process.argv.slice(2))},null,2));}catch(e){console.error(JSON.stringify({format:'athanor-controller-cli/v1',error:e.message}));process.exitCode=3;}
}
