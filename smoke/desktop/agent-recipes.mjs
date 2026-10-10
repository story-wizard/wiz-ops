import {fields,proofError} from './agent-proof.mjs';
import {checkAgentPlan,validateAgentPlan,planLimits} from './agent-plan.mjs';
import {digest,readJSON} from '../runner/files.mjs';
import {isAgentMutation} from './agent-tools.mjs';

const invalid=message=>proofError('invalid_recipe',message,['correct_parameters']);
const safeName=name=>typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)&&!['__proto__','prototype','constructor'].includes(name);
export function compileAgentRecipe(recipe,values){
 fields(recipe,['format','id','parameters','plan','continueAfter'],'recipe');
 if(recipe.format!=='athanor-agent-recipe/v1'||!safeName(recipe.id)||Buffer.byteLength(JSON.stringify({recipe,values}))>65536)throw invalid('Use an athanor-agent-recipe/v1 within 64 KiB');
 fields(recipe.parameters,Object.keys(recipe.parameters||{}),'parameters');fields(values,Object.keys(recipe.parameters),'values');
 for(const [name,definition] of Object.entries(recipe.parameters)){
  fields(definition,['type'],'parameter');if(!safeName(name)||!Object.hasOwn(values,name))throw invalid('Supply declared parameter '+name);
  const value=values[name],type=definition.type;
  if(!['string','number','integer','boolean','object','array'].includes(type)||!(type==='array'?Array.isArray(value):type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):type==='integer'?Number.isSafeInteger(value):type==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===type))throw invalid('Parameter '+name+' must be '+type);
 }
 const bind=(value,depth=0)=>{
  if(depth>30)throw invalid('Recipe nesting exceeds 30');
  if(value===null||typeof value!=='object')return value;
  if(Object.hasOwn(value,'$param')){fields(value,['$param'],'reference');if(!Object.hasOwn(recipe.parameters,value.$param))throw invalid('Unknown reference '+value.$param);return structuredClone(values[value.$param]);}
  if(Array.isArray(value))return value.map(v=>bind(v,depth+1));
  return Object.fromEntries(Object.entries(value).map(([key,item])=>{if(['__proto__','prototype','constructor'].includes(key))throw invalid('Unsafe template key');return [key,bind(item,depth+1)];}));
 };
 const plan=bind(recipe.plan),continuations=recipe.continueAfter??[];
 if(!Array.isArray(continuations)||new Set(continuations).size!==continuations.length||continuations.some(id=>!safeName(id)||!plan.phases?.some(p=>p.id===id&&(p.next===null||typeof p.next==='object'&&p.next?.cases?.some(c=>c.phase===null)))))throw invalid('continueAfter must name distinct terminal phases; omitted exits require review');
 for(const id of continuations){const steps=plan.phases.find(p=>p.id===id).steps,gate=steps.findLastIndex(s=>s.operation!=='capture');if(gate<0||steps[gate].expect===undefined||!['observe','find','model','model_value','call','native'].includes(steps[gate].operation)||isAgentMutation(steps[gate].operation,steps[gate].params)||steps[gate].params?.since!==undefined)throw invalid('A continuation must end with a gated full read-only step, followed only by captures');}
 return {format:'athanor-agent-recipe-compilation/v1',recipeId:recipe.id,recipeHash:digest(recipe),valuesHash:digest(values),plan};
}

// ponytail: compose authored recipes only; semantic intent/geometry stays with the agent.
export function compileAgentWorkflow(workflow,schema){
 fields(workflow,['format','parts'],'workflow');
 if(workflow.format!=='athanor-agent-workflow/v1'||!Array.isArray(workflow.parts)||!workflow.parts.length||workflow.parts.length>8||Buffer.byteLength(JSON.stringify(workflow))>planLimits.maxRequestBytes)throw invalid('Use athanor-agent-workflow/v1 with 1–8 parts within 64 KiB');
 const ids=new Set(),parts=workflow.parts.map((part,index)=>{
  fields(part,['id','recipe','values'],'part');if(!safeName(part.id)||ids.has(part.id))throw invalid('Use distinct safe part IDs');ids.add(part.id);
  const compiled=compileAgentRecipe(part.recipe,part.values),plan=compiled.plan;validateAgentPlan(plan,schema);
  const phases=new Map(plan.phases.map((p,i)=>[p.id,'p'+index+'_'+i])),bindings=new Map(Object.keys(plan.bindings||{}).map((name,i)=>[name,'b'+index+'_'+i]));
  const rename=value=>value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(rename):Object.hasOwn(value,'$binding')?{$binding:bindings.get(value.$binding)}:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rename(v)]));
  const terminals=plan.phases.filter(p=>p.next===null||typeof p.next==='object'&&p.next.cases.some(c=>c.phase===null));
  return {id:part.id,recipeId:compiled.recipeId,recipeHash:compiled.recipeHash,valuesHash:compiled.valuesHash,
   reviewExits:terminals.filter(p=>!part.recipe.continueAfter?.includes(p.id)).map(p=>p.id),
   phaseOrigins:plan.phases.map(p=>({id:phases.get(p.id),partId:part.id,phaseId:p.id})),
   plan:{format:plan.format,start:phases.get(plan.start),maxDurationMs:plan.maxDurationMs??planLimits.maxDurationMs,
    bindings:Object.fromEntries(Object.entries(plan.bindings||{}).map(([name,b])=>[bindings.get(name),{...b,phase:phases.get(b.phase)}])),
    phases:plan.phases.map(p=>({...p,id:phases.get(p.id),steps:rename(p.steps),next:p.next===null?null:typeof p.next==='string'?phases.get(p.next):{...p.next,cases:p.next.cases.map(c=>({...c,phase:c.phase===null?null:phases.get(c.phase)}))}}))}};
 });
 const segments=[];
 for(const part of parts){
  const previous=segments.at(-1),last=previous?.parts.at(-1);let candidate;
  if(previous&&!last.reviewExits.length){
   candidate=structuredClone(previous.plan);
   for(const phase of candidate.phases){
    if(phase.next===null||typeof phase.next==='object'&&phase.next.cases.some(c=>c.phase===null))phase.continuationRead=phase.steps.findLastIndex(s=>s.operation!=='capture');
    if(phase.next===null)phase.next=part.plan.start;else if(typeof phase.next==='object')for(const choice of phase.next.cases)if(choice.phase===null)choice.phase=part.plan.start;
   }
   candidate.phases.push(...part.plan.phases);Object.assign(candidate.bindings,part.plan.bindings);
   // Never relax a recipe's dispatch budget when joining it to another recipe.
   candidate.maxDurationMs=Math.min(candidate.maxDurationMs,part.plan.maxDurationMs);
   if(candidate.phases.length>planLimits.maxPhases||candidate.phases.reduce((n,p)=>n+p.steps.length,0)>planLimits.maxDeclaredSteps||Object.keys(candidate.bindings).length>8||Buffer.byteLength(JSON.stringify(candidate))>planLimits.maxRequestBytes){previous.stopReason='plan_limits';candidate=null;}
  }
  if(candidate){validateAgentPlan(candidate,schema);previous.plan=candidate;previous.parts.push(part);}
  else {validateAgentPlan(part.plan,schema);segments.push({plan:part.plan,parts:[part]});}
 }
 return {format:'athanor-agent-workflow-compilation/v1',workflowHash:digest(workflow),status:'Valid',executed:false,recipeRequests:parts.length,planRequests:segments.length,savedRequests:parts.length-segments.length,
  segments:segments.map((s,index)=>({index,plan:s.plan,parts:s.parts.map(({plan,phaseOrigins,reviewExits,...p})=>p),phaseOrigins:s.parts.flatMap(p=>p.phaseOrigins),reviewAfter:{reason:s.stopReason|| (s.parts.at(-1).reviewExits.length?'recipe_review':'workflow_complete'),exits:s.parts.at(-1).reviewExits,automatic:false}}))};
}
export async function checkAgentWorkflow(file,workflow){return compileAgentWorkflow(workflow,(await readJSON(file)).schema);}
export async function checkAgentRecipe(file,recipe,values){
 const compiled=compileAgentRecipe(recipe,values),check=await checkAgentPlan(file,compiled.plan);
 return {...compiled,status:check.status,executed:false,check};
}
