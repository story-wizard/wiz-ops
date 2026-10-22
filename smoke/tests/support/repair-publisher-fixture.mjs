import path from 'node:path';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {recordRepair,exportRepair} from '../../runner/repair-record.mjs';
import {inspectPublication,publicationBody,publishRepair,repairRepository} from '../../runner/repair-publisher.mjs';
import {offlineRepairTransport} from '../../runner/repair-publisher-transport.mjs';

export const hash=b=>createHash('sha256').update(b).digest('hex');
export const git=(repo,...args)=>execFileSync('/usr/bin/git',['-c','core.hooksPath=/dev/null','-C',repo,...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
export const json=(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n');
// All source, reports, proof and credentials here are explicit synthetic controls.
export async function fixture({native=false,history=false,symlink=false}={}){
 const root=await mkdtemp('/private/tmp/athanor-publisher-control-'),repo=path.join(root,'source'),remote=path.join(root,'remote.git'),journal=path.join(root,'publisher-journal'),artifacts=path.join(root,'export'),approvalFile=path.join(root,'approval.json'),bundle=path.join(root,'source.bundle');
 await mkdir(repo);git(repo,'init','-q','-b','athanor/synthetic-repair');git(repo,'remote','add','origin','git@github.com:story-wizard/wiz-ops.git');
 const sourceFile=native?'smoke/desktop/native/synthetic.cpp':'smoke/runner/synthetic-repair.mjs';await mkdir(path.dirname(path.join(repo,sourceFile)),{recursive:true});
 await writeFile(path.join(repo,sourceFile),'// synthetic control before\n');
 const commit=()=>{git(repo,'add','.');git(repo,'-c','user.name=Synthetic qualification','-c','user.email=fixture@localhost','commit','-qm','Synthetic publication control');return git(repo,'rev-parse','HEAD');};
 const base=commit();if(history){await writeFile(path.join(repo,sourceFile),'// hidden intermediate commit\n');commit();}
 if(symlink){const {symlink:link}=await import('node:fs/promises');await rm(path.join(repo,sourceFile));await link('/private/synthetic-secret',path.join(repo,sourceFile));}else await writeFile(path.join(repo,sourceFile),'// synthetic control after\n');
 const head=commit(),tree=git(repo,'rev-parse','HEAD^{tree}'),patch=execFileSync('/usr/bin/git',['-C',repo,'diff','--binary','--no-ext-diff','--no-textconv','--no-renames',base,head,'--']);
 const patchFile=path.join(root,'reviewed.patch');await writeFile(patchFile,patch);
 const reportFile=path.join(root,'original-report.json'),report={jobId:'synthetic-control',checks:[{id:'SYNTHETIC',status:'Blocked',observation:'PRIVATE_REPORT_CANARY; ghp_FAKE_AMBIENT_CANARY'}]};await json(reportFile,report);
 const proofs=['framework','scope',...(native?['native']:[])].map(kind=>({kind,head,patchSha256:hash(patch),status:'Pass',tests:1,failed:0,skipped:0,evidence:'Explicit synthetic proof control, not runtime acceptance'}));
 const input={requestId:'synthetic',revision:0,repository:repairRepository,contract:{id:'synthetic-publisher-control',version:'1'},classification:{kind:'Harness',reason:'Explicit synthetic publisher fixture',evidence:[reportFile]},campaignReport:reportFile,caseId:'SYNTHETIC',reportSha256:hash(await readFile(reportFile)),syntheticControl:true,source:{base,head,canonicalMain:base,branch:'athanor/synthetic-repair',reviewedPaths:[sourceFile],patchSha256:hash(patch),reviewedPatch:patchFile,reviewer:'Synthetic control'},public:{title:'Repair the synthetic control',problem:'The synthetic fixture reports the prior value.',change:'Report the replacement value.',validation:'Synthetic qualification control only.',remaining:'Real packaged and CI qualification are pending.'},proofs};
 const record=await recordRepair(path.join(root,'private'),input);
 // For rejection fixtures, supply the same explicit reviewed bytes without running the export's own symlink guard.
 let manifest;
 if(!symlink)manifest=(await exportRepair(path.join(root,'private'),record.id,{repo,out:artifacts})).manifest;
 else{
  await mkdir(artifacts);const preview='# Repair the synthetic control\n\nExplicit synthetic rejection control.\n';await writeFile(path.join(artifacts,'repair.patch'),patch);await writeFile(path.join(artifacts,'PR-PREVIEW.md'),preview);
  manifest={format:'athanor-repair-preview/v1',mode:'preview',repairId:record.id,repository:repairRepository,contract:input.contract,source:{base,head,tree,canonicalMain:base,branch:input.source.branch,basedOnDependency:false,reviewedPaths:[sourceFile]},dependencies:[],gates:{framework:'Pass',scope:'Pass',native:'Pending',ci:'Pending',packaged:'Pending'},publication:{state:'NotPublished',writeAuthorized:false},files:[{file:'repair.patch',bytes:patch.length,sha256:hash(patch)},{file:'PR-PREVIEW.md',bytes:Buffer.byteLength(preview),sha256:hash(preview)}]};await json(path.join(artifacts,'manifest.json'),manifest);
 }
 const approval={format:'athanor-repair-publication-approval/v1',id:'synthetic-review',repository:repairRepository,repairId:record.id,manifestSHA256:hash(await readFile(path.join(artifacts,'manifest.json'))),base:{branch:'main',sha:base},head:{branch:input.source.branch,sha:head,tree},paths:[sourceFile],title:input.public.title,bodySHA256:hash(publicationBody(await readFile(path.join(artifacts,'PR-PREVIEW.md'),'utf8'),record.id,hash(await readFile(path.join(artifacts,'manifest.json'))))),commitSHA256:hash(execFileSync('/usr/bin/git',['-C',repo,'cat-file','commit',head])),proofs:proofs.map(p=>({kind:p.kind,head,patchSHA256:p.patchSha256,receiptSHA256:hash('Synthetic proof: '+p.kind),tests:1,failed:0,skipped:0})),expiresAt:new Date(Date.now()+3600000).toISOString(),action:'create-draft-pr'};
 await json(approvalFile,approval);git(repo,'bundle','create',bundle,'HEAD');git(repo,'init','--bare','--template=',remote);git(repo,'push',remote,base+':refs/heads/main');
 const grant={kind:'github-app-installation',repositories:[repairRepository],repository:repairRepository,approvalSHA256:hash(await readFile(approvalFile)),permissions:['contents:write','pull_requests:write'],expiresAt:new Date(Date.now()+1800000).toISOString(),journalDirectory:journal,token:'SYNTHETIC_PRIVATE_GRANT_CANARY'};
 const state={posts:0,reads:0,prs:[],dropCreate:false,hidePR:false,incomplete:false,denyReads:false,createStatus:null,atCreate:null,actor:{id:42,login:'FixtureDev',type:'User'},prActor:null,repositoryId:1273595664,pushPermission:true};
 const ref=branch=>{try{return git(remote,'rev-parse','--verify','refs/heads/'+branch);}catch{return null;}};
 const server=createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer '+grant.token){res.writeHead(401);res.end('{}');return;}
  const url=new URL(req.url,'http://127.0.0.1'),prefix='/repos/'+repairRepository;
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(req.method==='GET'){state.reads++;if(state.denyReads){send(503,{});return;}
   if(url.pathname==='/user'){send(200,state.actor);return;}
   if(url.pathname===prefix){send(200,{id:state.repositoryId,full_name:repairRepository,permissions:{push:state.pushPermission}});return;}
   if(url.pathname.startsWith(prefix+'/branches/')){const sha=ref(decodeURIComponent(url.pathname.slice((prefix+'/branches/').length)));send(sha?200:404,sha?{commit:{sha}}:{});return;}
   if(url.pathname===prefix+'/pulls'){send(200,state.incomplete?Array(100).fill({body:'unrelated'}):state.hidePR?[]:state.prs);return;}
  }
  if(req.method==='POST'&&url.pathname===prefix+'/pulls'){
   if(state.createStatus){send(state.createStatus,{message:grant.token});return;}
   let text='';for await(const chunk of req)text+=chunk;const payload=JSON.parse(text);state.posts++;
   const pr={...payload,number:state.posts,html_url:`https://github.com/${repairRepository}/pull/${state.posts}`,state:'open',user:state.prActor||state.actor,head:{ref:payload.head,sha:ref(payload.head),repo:{full_name:repairRepository}},base:{ref:payload.base,sha:ref(payload.base),repo:{full_name:repairRepository}}};state.prs.push(pr);
   if(state.atCreate)await state.atCreate();if(state.dropCreate){req.socket.destroy();return;}send(201,pr);return;
  }send(404,{});
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const apiOrigin=`http://127.0.0.1:${server.address().port}/`,options={artifactDirectory:artifacts,approvalFile,journalDirectory:journal,sourceBundle:bundle};
 async function transport(){const plan=await inspectPublication(options);return offlineRepairTransport({grant,plan,apiOrigin,gitRemote:remote});}
 const publish=async(overrides={})=>publishRepair({...options,grant,transport:await transport(),...overrides});
 const close=async({keep=false}={})=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(!keep)await rm(root,{recursive:true,force:true});};
 return {root,repo,remote,journal,artifacts,approvalFile,bundle,sourceFile,base,head,tree,record,input,approval,grant,options,state,ref,transport,publish,apiOrigin,close};
}
export async function journalBytes(f){const dir=path.join(f.journal,f.record.id);return (await Promise.all((await readdir(dir)).filter(n=>n.endsWith('.json')).sort().map(n=>readFile(path.join(dir,n),'utf8')))).join('');}
