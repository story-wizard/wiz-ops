import {isDeepStrictEqual as equal} from 'node:util';
import {readFileSync} from 'node:fs';
import {digest} from './files.mjs';

// Deliberately not a general JSON Schema subtype checker. Unrecognized changes
// need review; composition, references, defaults and descriptions stay exact.
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

function compare(before,after){
 const changes=[],issues=[];
 for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
  if(key==='operations')continue;
  if(['results','errors'].includes(key)&&before[key]&&after[key]){
   for(const op of new Set([...Object.keys(before[key]),...Object.keys(after[key])])){
    if(!Object.hasOwn(before[key],op)&&!Object.hasOwn(before.operations,op)&&Object.hasOwn(after.operations,op))continue;
    if(!equal(before[key][op],after[key][op]))issues.push(key+'.'+op);
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

export function assertMappedPackagedSchema(schema,captured,qualifications){
 if(!schema?.operations||typeof schema.operations!=='object'||Array.isArray(schema.operations))throw Error('Invalid packaged operation schema.');
 const hash=digest(schema),baseline=digest(captured),receipt={policy:'wizard-smoke-schema-compatibility/v1',schemaHash:hash,baselineHash:baseline};
 if(hash===baseline)return {...receipt,mode:'baseline',anchorHash:baseline,changes:[]};
 if(qualifications&&qualifications.baselineHash!==baseline)throw Error('This package has a different command schema from the mapped contract. Qualification baseline does not match.');
 const reviewed=qualifications?.format==='wizard-smoke-schema-qualifications/v1'&&qualifications.baselineHash===baseline&&Array.isArray(qualifications.reviewed)?qualifications.reviewed:[];
 if(reviewed.some(r=>r.schemaHash===hash))return {...receipt,mode:'reviewed-exact',anchorHash:hash,changes:[]};
 const anchors=[captured];
 for(const entry of reviewed.filter(r=>r.operationsFile)){
  if(!/^[a-z0-9.-]+\.json$/.test(entry.operationsFile))throw Error('Invalid reviewed schema filename.');
  const operations=JSON.parse(readFileSync(new URL('./contracts/'+entry.operationsFile,import.meta.url)));
  const anchor={...captured,operations:Object.fromEntries(Object.entries({...captured.operations,...operations}).sort(([a],[b])=>a.localeCompare(b)))};
  if(digest(anchor)!==entry.schemaHash)throw Error('Reviewed schema definitions no longer match their qualification.');
  anchors.push(anchor);
 }
 let nearest;
 for(const anchor of anchors){
  const result=compare(anchor,schema),report={...receipt,anchorHash:digest(anchor),...result};
  if(!result.issues.length)return {...report,mode:'compatible-extension'};
  if(!nearest||result.issues.length<nearest.issues.length)nearest=report;
 }
 const error=new Error('This package has a different command schema from the mapped contract. Review required: '+nearest.issues.slice(0,6).join(', ')+(nearest.issues.length>6?` (${nearest.issues.length} differences total)`:'')+'.');
 error.schemaCompatibility={...nearest,mode:'review-required'};throw error;
}
