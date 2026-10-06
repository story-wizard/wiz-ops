import {isDeepStrictEqual} from 'node:util';
import {fields,proofError} from './agent-proof.mjs';
import {compareObservation,isAgentMutation} from './agent-tools.mjs';

const invalid=message=>proofError('invalid_plan_binding',message,['inspect','correct_parameters']);
const safe=name=>typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)&&!['constructor','prototype','__proto__'].includes(name);
const typed=(value,type)=>type==='string'?typeof value==='string'&&value.length>0&&value.length<=4096:Number.isSafeInteger(value)&&value>=0;
export function bindingReferences(step,definitions,values){
 const used=new Set();
 const walk=(value,keys=[])=>{
  if(keys.length>30)throw invalid('Binding nesting exceeds 30');
  if(value===null||typeof value!=='object')return value;
  if(Object.hasOwn(value,'$binding')){
   fields(value,['$binding'],'binding reference');const name=value.$binding,definition=definitions[name];
   // IDs are stable entities. Geometry, input text, commands and new-dialog choices stay agent-owned.
   const key=keys.at(-1);
   if(!safe(name)||!definition||keys[0]!=='params'||typeof key!=='string'||['actionId','stepId'].includes(key)||!(key==='id'||key.endsWith('Id')||key.endsWith('_id')||key==='offset'))throw invalid('Bind only declared entity IDs or model offsets in parameters');
   if((keys.at(-1)==='offset')!==(definition.type==='integer'))throw invalid('Model offsets need integer bindings; IDs need strings');
   used.add(name);return values?values[name]:definition.type==='string'?'binding-validation-id':0;
  }
  if(Array.isArray(value))return value.map((item,index)=>walk(item,[...keys,index]));
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,walk(item,[...keys,key])]));
 };
 return {step:walk(step),used:[...used]};
}
export function validatePlanBindings(plan,phases){
 const definitions=plan.bindings||{};fields(definitions,Object.keys(definitions),'bindings');
 if(Object.keys(definitions).length>8)throw invalid('Use at most eight bindings');
 for(const [name,b] of Object.entries(definitions)){
  fields(b,['phase','step','path','uniquePath','type'],'binding');const source=phases.get(b.phase)?.steps[b.step];
  if(!safe(name)||!['string','integer'].includes(b.type)||!Number.isInteger(b.step)||!source||!['observe','find','model','model_value','call'].includes(source.operation)||isAgentMutation(source.operation,source.params)||source.params?.since!==undefined||source.expect===undefined)throw invalid('Export only gated full read-only results with string or integer types');
  compareObservation({}, {path:b.path,equals:null});compareObservation({}, {path:b.uniquePath,length:1});
  if(!Array.isArray(b.path)||!Array.isArray(b.uniquePath)||!b.uniquePath.length||!isDeepStrictEqual(b.path.slice(0,b.uniquePath.length),b.uniquePath)||b.path[b.uniquePath.length]!==0)throw invalid('Export a property of the sole element in uniquePath');
  if(bindingReferences(source,definitions).used.length)throw invalid('Binding source reads must have literal parameters');
 }
 const destinations=p=>p.next===null?[]:typeof p.next==='string'?[p.next]:p.next.cases.map(c=>c.phase).filter(id=>id!==null);
 const visit=(id,available)=>{
  const phase=phases.get(id);
  for(const step of phase.steps)for(const name of bindingReferences(step,definitions).used)if(!available.has(name))throw invalid('Binding '+name+' is unavailable on a path to '+id);
  const next=new Set(available);for(const [name,b] of Object.entries(definitions))if(b.phase===id)next.add(name);
  for(const destination of destinations(phase))visit(destination,next);
 };
 visit(plan.start,new Set());return definitions;
}
export function readPlanBinding(definition,result){
 if(['modalWindow','popupWindow','mouseGrabber'].some(key=>result?.[key]))throw proofError('unexpected_binding_overlay','Inspect the modal, popup or active grabber before binding an entity',['observe']);
 const unique=compareObservation(result,{path:definition.uniquePath,length:1});
 if(!unique.matched||!Array.isArray(unique.actual))throw proofError('ambiguous_plan_binding','A binding needs exactly one observed entity',['observe']);
 const read=compareObservation(result,{path:definition.path,equals:null});
 if(read.missing||!typed(read.actual,definition.type))throw proofError('missing_plan_binding','The declared entity value is missing or has a different type',['observe']);
 return read.actual;
}
