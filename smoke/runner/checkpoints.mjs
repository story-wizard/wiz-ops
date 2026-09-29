import path from 'node:path';
import {writeFileSync,renameSync} from 'node:fs';
import {digest} from './files.mjs';

export function initializeCheckpoints(db){db.exec('CREATE TABLE IF NOT EXISTS checkpoints(run_id TEXT PRIMARY KEY REFERENCES runs(id), revision INTEGER NOT NULL, payload TEXT NOT NULL);');}
export function checkpoint(db,id){if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='checkpoints'").get())return null;const row=db.prepare('SELECT * FROM checkpoints WHERE run_id=?').get(id);return row?{...JSON.parse(row.payload),revision:row.revision}:null;}
export function waitingCheckpoints(db){return db.prepare('SELECT run_id FROM checkpoints ORDER BY rowid').all().map(r=>checkpoint(db,r.run_id)).filter(c=>c.state==='Waiting');}
export function saveCheckpoint(db,id,value){
 const root=db.prepare('SELECT artifact_root FROM executions WHERE run_id=?').get(id)?.artifact_root;if(!root)throw Error('Unknown checkpoint run.');
 const revision=(checkpoint(db,id)?.revision||0)+1,payload={...value,runId:id,revision,updatedAt:new Date().toISOString()};
 db.prepare('INSERT INTO checkpoints VALUES (?,?,?) ON CONFLICT(run_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(id,revision,JSON.stringify(payload));
 const file=path.join(root,'checkpoint.json');writeFileSync(file+'.tmp',JSON.stringify(payload,null,2)+'\n');renameSync(file+'.tmp',file);return payload;
}
export function checkpointRequest(db,id,action,input){
 if(!['observe','open','capture','resume','cancel'].includes(action))throw Error('Unknown checkpoint action.');
 if(!input||!Number.isInteger(input.revision)||!(/^[A-Za-z0-9-]{1,100}$/).test(input.requestId||''))throw Error('Supply checkpoint revision and a stable requestId.');
 const allowed=action==='observe'?['revision','requestId','operator','outcome','note','handsOnSeconds','recordedVia']:['revision','requestId'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))throw Error('Unknown checkpoint request field.');
 const {revision,...body}=input,requestHash=digest({action,...body});
 db.exec('BEGIN IMMEDIATE');try{
  const c=checkpoint(db,id);if(!c)throw Error('Checkpoint not found.');
  const prior=c.requests.find(r=>r.id===input.requestId);if(prior){if(prior.hash!==requestHash)throw Error('Request ID already used with different inputs.');db.exec('COMMIT');return {checkpoint:c,reused:true};}
  if((c.state!=='Waiting'&&!(action==='cancel'&&c.state==='Interrupted'))||c.revision!==revision)throw Error('Checkpoint changed or is not waiting. Reload before continuing.');
  if(action==='observe'){
   if(!['Pass','Fail','Blocked'].includes(input.outcome)||typeof input.operator!=='string'||!input.operator.trim()||input.operator.length>120||typeof input.note!=='string'||!input.note.trim()||input.note.length>6000||!Number.isFinite(input.handsOnSeconds)||input.handsOnSeconds<0||input.handsOnSeconds>86400||!['human','agent-transcription'].includes(input.recordedVia))throw Error('A human attribution, outcome, observation, hands-on seconds and recording method are required.');
   c.observations.push({...body,operator:input.operator.trim(),note:input.note.trim(),at:new Date().toISOString()});
  }else{
   if(action==='resume'&&!['Pass','Fail'].includes(c.observations.at(-1)?.outcome))throw Error('Record a human Pass or Fail before continuation; a blocked setup cannot continue.');
   c.state='Working';c.inFlight={action,requestId:input.requestId,startedAt:new Date().toISOString()};
   db.prepare("UPDATE executions SET state='Continuing',message=?,pid=NULL,updated_at=? WHERE run_id=?").run('Checkpoint '+action+' requested.',new Date().toISOString(),id);
  }
  c.requests.push({id:input.requestId,hash:requestHash,action});const saved=saveCheckpoint(db,id,c);db.exec('COMMIT');return {checkpoint:saved,reused:false};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function checkpointOutcome(automated,c){
 if(c.verification?.status==='Unknown'||automated.some(r=>r.status==='Unknown'))return 'Unknown';
 if(c.observations.some(o=>o.outcome==='Fail')||c.verification?.status==='Fail'||automated.some(r=>r.status==='Fail'))return 'Failed';
 if(c.state!=='Completed'||c.verification?.status!=='Pass'||c.observations.at(-1)?.outcome!=='Pass'||automated.some(r=>r.status!=='Pass'))return 'Blocked';
 return 'Passed';
}
