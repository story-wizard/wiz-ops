import {isDeepStrictEqual as equal} from 'node:util';
import {readFileSync} from 'node:fs';
import {digest} from './files.mjs';

// Deliberately not a general JSON Schema subtype checker. Unrecognized changes
// need review; references, defaults and descriptions stay exact.
function requestChanges(before,after,at,changes,issues){
 if(equal(before,after))return;
 if(!before||!after||typeof before!=='object'||typeof after!=='object'||Array.isArray(before)||Array.isArray(after)){issues.push(at);return;}
 for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
  const a=before[key],b=after[key],location=at+'.'+key;
  if(equal(a,b))continue;
  if(key==='enum'&&Array.isArray(a)&&Array.isArray(b)&&a.every(v=>b.some(w=>equal(v,w)))){
   changes.push({path:location,kind:'request-enum-expanded'});continue;
  }
  if(key==='required'&&Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every(v=>b.includes(v)))continue;
  if(key==='properties'&&a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){
   for(const name of new Set([...Object.keys(a),...Object.keys(b)])){
    if(!Object.hasOwn(a,name)){
     if(before.additionalProperties===false&&after.additionalProperties===false&&!before.patternProperties&&!(after.required||[]).includes(name))changes.push({path:location+'.'+name,kind:'optional-closed-object-property'});
     else issues.push(location+'.'+name);
    }else if(!Object.hasOwn(b,name))issues.push(location+'.'+name);
    else requestChanges(a[name],b[name],location+'.'+name,changes,issues);
   }
   continue;
  }
  issues.push(location);
 }
}

// Consumers can ignore new optional metadata. Existing fields and constraints
// remain exact, including units in descriptions. Only disjoint tagged unions
// can be traversed: an added property must not change branch selection.
function responseChanges(before,after,at,changes,issues){
 if(equal(before,after))return;
 if(!before||!after||typeof before!=='object'||typeof after!=='object'||Array.isArray(before)||Array.isArray(after)){issues.push(at);return;}
 const tagged=branches=>Array.isArray(branches)&&branches.length>0&&Object.keys(branches[0]?.properties||{}).some(key=>{
  const tags=branches.map(branch=>branch?.required?.includes(key)&&Object.hasOwn(branch.properties?.[key]||{},'const')?branch.properties[key].const:undefined);
  return tags.every(tag=>tag!==undefined)&&tags.every((tag,i)=>tags.findIndex(other=>equal(tag,other))===i);
 });
 for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
  const a=before[key],b=after[key],location=at+'.'+key;
  if(equal(a,b))continue;
  if(key==='required'&&Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every(v=>b.includes(v)))continue;
  if(key==='properties'&&a&&b&&!Array.isArray(a)&&!Array.isArray(b)){
   for(const name of new Set([...Object.keys(a),...Object.keys(b)])){
    if(!Object.hasOwn(a,name)){
     if(before.type==='object'&&after.type==='object'&&before.additionalProperties===false&&after.additionalProperties===false&&!before.patternProperties&&!after.patternProperties&&!(after.required||[]).includes(name))changes.push({path:location+'.'+name,kind:'optional-response-property'});
     else issues.push(location+'.'+name);
    }else if(!Object.hasOwn(b,name))issues.push(location+'.'+name);
    else responseChanges(a[name],b[name],location+'.'+name,changes,issues);
   }
  }else if(key==='items'&&!Array.isArray(a)&&!Array.isArray(b))responseChanges(a,b,location,changes,issues);
  else if(key==='oneOf'&&tagged(a)&&tagged(b)&&a.length===b.length){
   // Branch order and discriminator values are preserved by recursive comparison.
   a.forEach((branch,i)=>responseChanges(branch,b[i],location+'['+i+']',changes,issues));
  }else issues.push(location);
 }
}

function compare(before,after){
 const changes=[],issues=[];
 for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
  if(key==='operations')continue;
  if(['results','errors'].includes(key)&&before[key]&&after[key]){
   for(const op of new Set([...Object.keys(before[key]),...Object.keys(after[key])])){
    if(!Object.hasOwn(before[key],op)&&!Object.hasOwn(before.operations,op)&&Object.hasOwn(after.operations,op))continue;
    if(key==='results')responseChanges(before[key][op],after[key][op],key+'.'+op,changes,issues);
    else if(!equal(before[key][op],after[key][op]))issues.push(key+'.'+op);
   }
  }else if(!equal(before[key],after[key]))issues.push(key);
 }
 for(const op of new Set([...Object.keys(before.operations),...Object.keys(after.operations)])){
  if(!Object.hasOwn(before.operations,op))changes.push({path:'operations.'+op,kind:'operation-added'});
  else if(!Object.hasOwn(after.operations,op))issues.push('operations.'+op);
  else requestChanges(before.operations[op],after.operations[op],'operations.'+op,changes,issues);
 }
 // A changed target can affect a negative/conditional reference elsewhere.
 // Current packaged contracts are inline; referenced schemas require review.
 const references=value=>value&&typeof value==='object'&&Object.entries(value).some(([k,v])=>['$ref','$dynamicRef','$recursiveRef'].includes(k)||references(v));
 if(changes.length&&references(before))issues.push('referenced schema requires review');
 return {changes,issues};
}

function reviewedAnchors(captured,reviewed){
 const anchors=[captured];
 for(const entry of reviewed.filter(r=>r.operationsFile)){
  if(!/^[a-z0-9.-]+\.json$/.test(entry.operationsFile))throw Error('Invalid reviewed schema filename.');
  const operations=JSON.parse(readFileSync(new URL('./contracts/'+entry.operationsFile,import.meta.url)));
  const removed=entry.removedOperations||[];
  if(!Array.isArray(removed)||new Set(removed).size!==removed.length||removed.some(op=>!Object.hasOwn(captured.operations,op)||Object.hasOwn(operations,op)))throw Error('Invalid reviewed operation removals.');
  const anchor={...captured,operations:Object.fromEntries(Object.entries({...captured.operations,...operations}).filter(([op])=>!removed.includes(op)).sort(([a],[b])=>a.localeCompare(b)))};
  if(entry.resultsFile){
   if(!/^[a-z0-9.-]+\.json$/.test(entry.resultsFile))throw Error('Invalid reviewed result filename.');
   anchor.results=Object.fromEntries(Object.entries({...captured.results,...JSON.parse(readFileSync(new URL('./contracts/'+entry.resultsFile,import.meta.url)))}).sort(([a],[b])=>a.localeCompare(b)));
  }
  if(digest(anchor)!==entry.schemaHash)throw Error('Reviewed schema definitions no longer match their qualification.');
  anchors.push(anchor);
 }
 return anchors;
}

export function assertMappedPackagedSchema(schema,captured,qualifications){
 if(!schema?.operations||typeof schema.operations!=='object'||Array.isArray(schema.operations))throw Error('Invalid packaged operation schema.');
 const hash=digest(schema),baseline=digest(captured),receipt={policy:'wizard-smoke-schema-compatibility/v1',schemaHash:hash,baselineHash:baseline};
 if(hash===baseline)return {...receipt,mode:'baseline',anchorHash:baseline,changes:[]};
 if(qualifications&&qualifications.baselineHash!==baseline)throw Error('This package has a different command schema from the mapped contract. Qualification baseline does not match.');
 const reviewed=qualifications?.format==='wizard-smoke-schema-qualifications/v1'&&qualifications.baselineHash===baseline&&Array.isArray(qualifications.reviewed)?qualifications.reviewed:[];
 if(reviewed.some(r=>r.schemaHash===hash))return {...receipt,mode:'reviewed-exact',anchorHash:hash,changes:[]};
 const anchors=reviewedAnchors(captured,reviewed);
 let nearest;
 for(const anchor of anchors){
  const result=compare(anchor,schema),report={...receipt,anchorHash:digest(anchor),...result};
  if(!result.issues.length)return {...report,mode:'compatible-extension'};
  if(!nearest||result.issues.length<nearest.issues.length)nearest=report;
 }
 const error=new Error('This package has a different command schema from the mapped contract. Review required: '+nearest.issues.slice(0,6).join(', ')+(nearest.issues.length>6?` (${nearest.issues.length} differences total)`:'')+'.');
 error.schemaCompatibility={...nearest,mode:'review-required'};throw error;
}

// The full-registry approval stays exact. This fallback admits only independently
// qualified request/response/error contracts; every dispatch checks the allowlist.
export function operationSupport(schema,captured,qualifications){
 try{return {compatibility:assertMappedPackagedSchema(schema,captured,qualifications),qualifiedOperations:Object.keys(schema.operations),unqualifiedOperations:[]};}
 catch(error){
  if(!error.schemaCompatibility)throw error;
  const reviewed=qualifications?.reviewed||[],anchors=reviewedAnchors(captured,reviewed),qualifiedOperations=[],unqualifiedOperations=[];
  const project=(value,op)=>({...value,operations:Object.fromEntries(Object.entries(value.operations).filter(([key])=>key===op)),...Object.fromEntries(['results','errors'].filter(key=>value[key]).map(key=>[key,Object.fromEntries(Object.entries(value[key]).filter(([name])=>name===op))]))});
  for(const op of Object.keys(schema.operations)){
   const after=project(schema,op);let accepted=false;
   for(const anchor of anchors){
    if(!anchor.operations[op])continue;
    const before=project(anchor,op);
    // Cross-operation references cannot be qualified from a partial registry.
    if(/"\$(?:ref|dynamicRef|recursiveRef)"/.test(JSON.stringify([before,after])))continue;
    if(!compare(before,after).issues.length){accepted=true;break;}
   }
   if(accepted)qualifiedOperations.push(op);else unqualifiedOperations.push(op);
  }
  return {compatibility:error.schemaCompatibility,qualifiedOperations,unqualifiedOperations};
 }
}
