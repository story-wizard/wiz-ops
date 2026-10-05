import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,realpath} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {inside,readJSON,writeJSON,digest} from '../runner/files.mjs';
import {requireProof} from './agent-proof.mjs';

// Diagnostic observations are separate from verification and Pass evidence.
export function observationBinding(session,params){
 return {pid:session.pid,started:session.processStart,generation:session.generation,packageHash:session.guiHash,
  query:{kind:params.kind||'widgets',selector:params.selector||{},...(params.selectors!==undefined?{selectors:params.selectors}:{}),limit:params.limit??20,details:params.details??false,scope:params.scope??null}};
}
export function observationChanges(previous,current){
 requireProof(isDeepStrictEqual(previous.binding,current.binding),'observation_binding_changed','Use a full observation after changing process, generation or query',['observe_without_since']);
 const before=new Map(previous.value.matches.map(w=>[w.id,w])),after=new Map(current.value.matches.map(w=>[w.id,w]));
 requireProof(before.size===previous.value.matches.length&&after.size===current.value.matches.length&&[...before.keys(),...after.keys()].every(id=>typeof id==='string'&&id),'invalid_observation','Observed entries must have unique identities',['observe_without_since']);
 const added=[],changed=[];let unchangedCount=0;
 for(const [id,value] of after){
  if(!before.has(id)){added.push(value);continue;}
  const old=before.get(id),fields=[];
  for(const name of new Set([...Object.keys(old),...Object.keys(value)]))if(!isDeepStrictEqual(old[name],value[name]))fields.push({field:name,before:old[name]??null,after:value[name]??null,beforePresent:Object.hasOwn(old,name),afterPresent:Object.hasOwn(value,name)});
  if(fields.length)changed.push({id,fields,current:value});else unchangedCount++;
 }
 return {added,changed,unchangedCount,noLongerReturned:[...before.keys()].filter(id=>!after.has(id)),
  completeSelection:![previous.value,current.value].some(v=>v.truncated||v.inspectionIncomplete),
  removalMeaning:'No longer returned by this query; this does not establish deletion or absence outside its scope.'};
}
export async function retainObservation(session,params,value){
 const directory=path.join(session.root,'observations'),binding=observationBinding(session,params),current={format:'athanor-observation/v1',binding,value};
 let changes;
 if(params.since!==undefined){
  requireProof(typeof params.since==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(params.since),'invalid_observation_id','Use the observationId from this session',['observe_without_since']);
  const file=path.join(directory,params.since+'.json');let previous;
  try{requireProof(inside(directory,await realpath(file)),'invalid_observation_id','Observation escaped the session',['observe_without_since']);previous=await readJSON(file);}
  catch(e){if(e.code==='ENOENT')throw Object.assign(Error('Observation is unavailable in this session; request a full observation'),{code:'observation_missing',status:'Blocked',origin:'harness',nextActions:['observe_without_since']});throw e;}
  requireProof(previous.format===current.format&&previous.sha256===digest({format:previous.format,binding:previous.binding,value:previous.value}),'observation_changed','Retained observation changed; request a full observation',['observe_without_since']);
  changes=observationChanges(previous,current);
 }
 const observationId=randomUUID();await mkdir(directory,{recursive:true});await writeJSON(path.join(directory,observationId+'.json'),{...current,sha256:digest(current)});
 if(!changes)return {...value,observationId,encoding:'full'};
 const {matches,...metadata}=value;
 const full={...value,observationId,since:params.since,encoding:'full'},delta={...metadata,observationId,since:params.since,encoding:'delta',changes};
 return Buffer.byteLength(JSON.stringify(delta))<Buffer.byteLength(JSON.stringify(full))?delta:full;
}
