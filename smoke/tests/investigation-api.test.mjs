import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {initializeInvestigations} from '../investigations.mjs';
import {main} from '../scripts/smoke.mjs';
import {ROOT,digest,sha,writeJSON} from '../runner/files.mjs';

test('live investigation API and CLI share preview, edits, case-bound evidence and admission errors without Wizard execution',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'athanor-investigation-api-')),id=randomUUID(),runId=randomUUID(),name='smoke-report-'+runId+'-aaaaaaaaaaaa',directory=path.join(data,'exports',name),file='computer-use-aaaaaaaaaaaa-example.json';
 await mkdir(path.join(directory,'evidence'),{recursive:true});await writeFile(path.join(directory,'evidence',file),'{}');
 const cases=['A-CO-01','A-CO-02'].map(id=>({id,title:id,status:'Fail',observation:'Synthetic API fixture',expected:'Expected state',procedure:['Change a value','Inspect it'],actions:[],evidence:id==='A-CO-01'?[{file,caption:'Example state'}]:[]})),report={cases,artifacts:[{file,bytes:2,sha256:await sha(path.join(directory,'evidence',file))}]};await writeJSON(path.join(directory,'report.json'),report);
 const badRecipe={selection:{diagnostics:'standard'},cases:[]},content={packageHash:'a'.repeat(64),recipe:badRecipe,courseHash:digest(badRecipe)},badPlan={...content,planHash:digest(content)},badRepro=randomUUID();await mkdir(path.join(data,'plans'));await writeJSON(path.join(data,'plans',badPlan.planHash+'.json'),badPlan);
 const value={format:'athanor-investigation/v1',id,revision:1,createdAt:new Date().toISOString(),title:'Synthetic API fixture',baseline:{runId,identities:{app:'/Synthetic/Wizard.app',packageHash:'a'.repeat(64),version:'Synthetic fixture'},selection:{qualificationIds:[]},reportPath:path.join(directory,'index.html'),reportUrl:'/exports/'+name+'/index.html',reportHash:digest(report)},cases:cases.map(c=>({id:c.id,title:c.title,classification:'Unresolved',disposition:'Investigate',reason:'',duplicateOf:null,original:{...c,definitionHash:'test-definition'},attempts:[],review:null})),history:[],repros:[{id:badRepro,requestId:randomUUID(),actor:'Operator',state:'Ready',planHash:badPlan.planHash,selection:{project:'fresh',title:'Synthetic API fixture — diagnostic repro',diagnostics:'investigation',checkIds:['A-CO-01']}}]};
 const db=new DatabaseSync(path.join(data,'smoke.sqlite'));initializeInvestigations(db);db.prepare('INSERT INTO investigations VALUES (?,?,?)').run(id,1,JSON.stringify(value));db.close();
 const child=spawn(process.execPath,[path.join(ROOT,'server.mjs')],{cwd:ROOT,env:{...process.env,PORT:'0',SMOKE_DATA_DIR:data},stdio:['ignore','pipe','pipe']});const exited=new Promise(resolve=>child.once('exit',resolve));let output='';child.stderr.on('data',b=>output+=b);
 try{
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(output||'Server did not start')),15000);child.stdout.on('data',b=>{output+=b;const match=output.match(/http:\/\/127\.0\.0\.1:\d+\//);if(match){clearTimeout(timer);resolve(match[0]);}});child.once('exit',()=>{clearTimeout(timer);reject(Error(output));});});
  const route='api/investigations/'+id,call=async(suffix='',body)=>{const response=await fetch(base+route+suffix,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:response.status,value:await response.json()};};
  const cli=(sub,...flags)=>main(['investigation',sub,'--id',id,'--server',base,...flags]);
  assert.equal((await cli('show')).result.revision,1);const packet=(await cli('task','--task','triage','--case','A-CO-01')).result;assert.deepEqual(packet.caseIds,['A-CO-01']);assert.equal((await call('/task?task=submit')).status,409);
  const proposal={revision:1,actor:'Agent',updates:[{id:'A-CO-01',classification:'App',disposition:'Reproduce',reason:'Retained example state does not match expected state'}],log:'Compared state'};
  const proposalFile=path.join(data,'proposal.json');await writeJSON(proposalFile,proposal);assert.equal((await cli('proposal','--file',proposalFile)).result.changes[0].after.classification,'App');assert.equal((await cli('show')).result.revision,1);
  const cross=await fetch(base+route+'/triage',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://elsewhere.example'},body:JSON.stringify(proposal)});assert.equal(cross.status,403);
  assert.equal((await cli('triage','--file',proposalFile)).result.revision,2);assert.equal((await call('/proposal',proposal)).status,409);
  const selection=(await cli('selection')).result;assert.ok(selection.effectiveIds.includes('A-CO-01'));assert.ok(selection.addedPrerequisites.some(c=>c.id==='A-CLI-01'));
  const draftFile=path.join(data,'draft.json');await writeJSON(draftFile,{revision:2,actor:'Editor',caseId:'A-CO-01',fields:{summary:'Edited example',reproduction_steps:'1. Inspect the example',expected_result:'Expected state'}});assert.equal((await cli('draft','--file',draftFile)).result.cases[0].draftEdits.fields.summary,'Edited example');assert.equal((await cli('show')).result.drafts[0].ready,false);
  const evidence=(await cli('evidence','--case','A-CO-01')).result,artifact=evidence.attempts[0].evidence[0];assert.deepEqual(await (await fetch(base.slice(0,-1)+artifact.url)).json(),{});
  assert.equal((await call('/artifact?'+new URLSearchParams({case:'A-CO-02',run:runId,file}))).status,409);
  await writeFile(path.join(directory,'evidence',file),'changed');assert.equal((await fetch(base.slice(0,-1)+artifact.url)).status,409);
  assert.equal((await call('/prepare',{revision:3,actor:'Operator',requestId:randomUUID(),app:'relative.app'})).status,409);assert.equal((await cli('show')).result.repros.length,1);
  assert.equal((await call('/start',{reproId:randomUUID(),actor:'Operator'})).status,409);const wrongPlan=await call('/start',{reproId:badRepro,actor:'Operator'});assert.equal(wrongPlan.status,409);assert.match(wrongPlan.value.error,/diagnostic repro intent/);
  const runs=await (await fetch(base+'api/runs')).json();assert.deepEqual(runs,[],'No Wizard test was admitted');
 }finally{child.kill('SIGTERM');await exited;await rm(data,{recursive:true,force:true});}
});
