import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {digest} from '../runner/files.mjs';
import {requireProof} from './agent-proof.mjs';

// Export facts for recipe review. Never export a replayable plan or old target values.
export function procedureLearning(receipt,receiptHash){
 const valid=value=>requireProof(value,'invalid_learning_receipt','Use a terminal full plan receipt with retained step results',['inspect_receipt']);
 valid(receipt?.format==='athanor-agent-plan/v1'&&['Completed','Fail','Blocked','Unknown'].includes(receipt.status)&&receipt.plan?.format==='athanor-agent-plan/v1');
 valid(Array.isArray(receipt.plan.phases)&&receipt.plan.phases.length>0&&receipt.plan.phases.length<=8&&Array.isArray(receipt.phases)&&receipt.phases.length<=8);
 valid(Number.isFinite(receipt.durationMs)&&receipt.durationMs>=0&&/^[a-f0-9]{64}$/.test(receiptHash));
 const declared=new Map(receipt.plan.phases.map(p=>[p.id,p]));valid(declared.size===receipt.plan.phases.length);
 valid(receipt.plan.phases.every(p=>Array.isArray(p.steps)&&p.steps.length>0&&p.steps.length<=8)&&receipt.plan.phases.reduce((n,p)=>n+p.steps.length,0)<=32);
 const learned=receipt.phases.map((phase,phaseIndex)=>{
  const source=declared.get(phase.id),result=phase.result;valid(source&&result&&Array.isArray(result.results)&&result.results.length<=source.steps.length);
  valid(['Completed','Fail','Blocked','Unknown'].includes(result.status));
  const steps=result.results.map((step,index)=>{
   const authored=source.steps[index];valid(step.index===index&&step.operation===authored.operation&&Number.isFinite(step.durationMs)&&step.durationMs>=0);
   valid(step.expectation===undefined||typeof step.expectation.matched==='boolean');
   return {index,operation:step.operation,...['click','drag','key','type','scroll','screenshot'].includes(authored.params?.command)?{command:authored.params.command}:{},
    status:step.expectation?.matched===false?'Fail':step.status||'Returned',durationMs:step.durationMs,
    ...step.expectation?{gateMatched:step.expectation.matched}:{},captureRetained:step.operation==='capture'&&!!step.result?.sha256};
  });
  let branch;
  if(phase.branch){const choices=source.next?.cases;valid(Array.isArray(choices)&&Number.isInteger(phase.branch.caseIndex)&&phase.branch.caseIndex>=0&&phase.branch.caseIndex<choices.length);branch={selectedCaseIndex:phase.branch.caseIndex,declaredCases:choices.length,otherPathsObserved:false};}
  return {index:phaseIndex,status:result.status,steps,...branch?{branch}:{}};
 });
 return {format:'athanor-procedure-learning/v1',status:'Needs review',executable:false,accepted:false,
  source:{receiptSha256:receiptHash,planHash:digest(receipt.plan),schemaHash:receipt.schemaHash??null,packageHash:receipt.build?.packageHash??null},
  observed:{outcome:receipt.status,elapsedMs:receipt.durationMs,phases:learned,activeReturnedSteps:receipt.activeResults?.length||0},
  nextActions:receipt.status==='Unknown'?['Reconcile the uncertain action from the original receipt before another edit.','Review reusable observations only; do not retry this plan.']:
   ['Review the original assertions and images; Completed is an execution status, not a canonical test Pass.',
    'Edit a parameterized recipe with fresh baseline/target inputs. Preserve script order, assertions, captures and review exits.',
    'Validate every branch against the selected schema using recipe-check or workflow-check; qualify changed behavior before lead acceptance.'],
  refresh:['selected-build contract','fixture baseline','entity/widget IDs','process/generation','focus','geometry'],
  timing:'One attempt. Elapsed includes guards and retention; do not sum nested timings or infer a reliable speedup from one run.'};
}

export async function learnProcedure(file,expectedHash){
 requireProof(typeof expectedHash==='string'&&/^[a-f0-9]{64}$/.test(expectedHash),'invalid_learning_checksum','Supply the retained receipt SHA-256',['inspect_receipt']);
 const handle=await open(file,'r');let bytes;
 try{const stat=await handle.stat();requireProof(stat.isFile()&&stat.size<=32*1024*1024,'invalid_learning_receipt','Use a regular plan receipt within 32 MiB',['inspect_receipt']);bytes=await handle.readFile();}
 finally{await handle.close();}
 const actual=createHash('sha256').update(bytes).digest('hex');
 requireProof(actual===expectedHash,'learning_receipt_mismatch','Receipt checksum differs; inspect retained evidence',['inspect_receipt']);
 return procedureLearning(JSON.parse(bytes),actual);
}
