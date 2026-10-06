import {fields,proofError} from './agent-proof.mjs';
import {checkAgentPlan} from './agent-plan.mjs';
import {digest} from '../runner/files.mjs';

const invalid=message=>proofError('invalid_recipe',message,['correct_parameters']);
const safeName=name=>typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)&&!['__proto__','prototype','constructor'].includes(name);
export function compileAgentRecipe(recipe,values){
 fields(recipe,['format','id','parameters','plan'],'recipe');
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
 return {format:'athanor-agent-recipe-compilation/v1',recipeId:recipe.id,recipeHash:digest(recipe),valuesHash:digest(values),plan:bind(recipe.plan)};
}
export async function checkAgentRecipe(file,recipe,values){
 const compiled=compileAgentRecipe(recipe,values),check=await checkAgentPlan(file,compiled.plan);
 return {...compiled,status:check.status,executed:false,check};
}
