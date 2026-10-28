import path from 'node:path';
import {repairRepository,publisherGit} from './repair-publisher.mjs';
import {repairPath,repairBytesHash as hash} from './repair-record.mjs';

const ok=(v,message)=>{if(!v)throw Error(message);};
function failure(stage,code,details={}){const error=Error('Publisher transport stopped; reconcile retained intent.');error.diagnostic={stage,code,...details};return error;}
function transport({grant,plan,apiOrigin,gitRemote,offline=false}){
 const a=structuredClone(plan.approval),expectedBody=plan.body,token=grant.token;
 ok(grant.approvalSHA256===plan.approvalSHA256&&grant.repository===repairRepository&&typeof token==='string'&&token.length>0&&token.length<=4096,'Transport requires a matching private broker grant.');
 const origin=new URL(apiOrigin);ok(!origin.username&&!origin.password&&origin.pathname==='/'&&!origin.search&&!origin.hash,'Invalid transport origin.');
 if(offline)ok(origin.protocol==='http:'&&origin.hostname==='127.0.0.1'&&path.isAbsolute(gitRemote),'Offline transport is limited to local Git and loopback HTTP.');
 else ok(origin.href==='https://api.github.com/'&&gitRemote==='https://github.com/story-wizard/wiz-ops.git','Live transport is restricted to the approved GitHub repository.');
 const request=async(method,route,body)=>{
  const stage=method==='POST'?'create_pr':route.startsWith('/branches/')?'read_ref':'list_prs';
  try{
   const response=await fetch(new URL('/repos/'+repairRepository+route,origin),{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   if(method==='GET'&&response.status===404&&route.startsWith('/branches/'))return null;
   if(!response.ok)throw failure(stage,'http_status',{httpStatus:response.status});const chunks=[];let size=0;
   for await(const chunk of response.body){size+=chunk.length;if(size>4*1024*1024)throw failure(stage,'response_invalid');chunks.push(chunk);}
   try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw failure(stage,'response_invalid');}
  }catch(error){throw error.diagnostic?error:failure(stage,'unavailable');}
 };
 return {
  async readRef(branch){ok([a.base.branch,a.head.branch].includes(branch),'Unapproved ref read.');const value=await request('GET','/branches/'+encodeURIComponent(branch));if(value===null)return null;if(!/^[a-f0-9]{40}$/.test(value.commit?.sha||''))throw failure('read_ref','response_invalid');return value.commit.sha;},
  async listPRs(){const all=[];for(let page=1;page<=10;page++){const values=await request('GET','/pulls?state=all&per_page=100&page='+page);if(!Array.isArray(values)||!values.every(v=>v&&typeof v==='object'))throw failure('list_prs','response_invalid');all.push(...values);if(values.length<100)return all;}throw failure('list_prs','response_invalid');},
  async push({source,head,branch}){
   ok(head===a.head.sha&&branch===a.head.branch,'Unapproved branch push.');
   const auth=Buffer.from('x-access-token:'+token).toString('base64');
   try{
    publisherGit(source,['-c','protocol.https.allow=always','push','--porcelain','--no-verify',`--force-with-lease=refs/heads/${branch}:`,'--',gitRemote,`${head}:refs/heads/${branch}`],{env:offline?{}:{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.https://github.com/story-wizard/wiz-ops.git/.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Basic '+auth}});
   }catch(error){throw failure('push','git_exit',{exitCode:error.status});}
  },
  async createDraft(payload){
   ok(payload.title===a.title&&payload.body===expectedBody&&hash(payload.body)===a.bodySHA256&&payload.head===a.head.branch&&payload.base===a.base.branch&&payload.draft===true&&payload.maintainer_can_modify===false&&Object.keys(payload).length===6,'Unapproved PR payload.');
   return request('POST','/pulls',payload);
  }
 };
}
// Only the pinned broker entry point uses live credentials. No ambient auth is read.
export function githubRepairTransport({grant,plan}){return transport({grant,plan,apiOrigin:'https://api.github.com/',gitRemote:'https://github.com/story-wizard/wiz-ops.git'});}
// Qualification exercises the same Git/HTTP implementation without GitHub writes.
export async function offlineRepairTransport({grant,plan,apiOrigin,gitRemote}){return transport({grant,plan,apiOrigin,gitRemote:await repairPath(gitRemote),offline:true});}
