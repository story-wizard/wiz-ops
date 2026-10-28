import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,lstat,realpath,readdir,copyFile,chmod,writeFile,rename,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {externalPath,inside,readJSON,sha,digest} from './files.mjs';

const databases=['controller.sqlite','smoke.sqlite'];
const validId=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export async function storageWorkerId(source){
 const file=path.join(source,'storage-worker-id.json');try{await writeFile(file,JSON.stringify({id:randomUUID()})+'\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}await regular(file);const {id}=await readJSON(file);if(!validId(id))throw Error('Invalid storage worker identity.');return id;
}
const safe=name=>typeof name==='string'&&!path.isAbsolute(name)&&!name.split('/').some(p=>!p||p==='.'||p==='..')&&!name.includes('\\');
async function regular(file){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||await realpath(file)!==file)throw Error('Backup input was redirected.');return s;}
function integrity(file){const db=new DatabaseSync(file,{readOnly:true});try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup database integrity check failed.');}finally{db.close();}}
export async function backupStorage(source,destination,{files=[],idle=async()=>false,maxBytes=2*1024**3}={}){
 source=externalPath(source);destination=externalPath(destination);
 if(source===destination||inside(source,destination)||inside(destination,source))throw Error('Backup must be outside the worker directory.');
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('Invalid backup byte budget.');
 if(!await idle())throw Error('Backup requires an idle worker.');
 if(!Array.isArray(files)||new Set(files).size!==files.length||files.some(f=>!safe(f)||databases.includes(f)||f.endsWith('-wal')||f.endsWith('-shm')))throw Error('Choose unique relative configuration files, not SQLite journals.');
 await mkdir(path.dirname(destination),{recursive:true,mode:0o700});await mkdir(destination,{mode:0o700});
 const held=[],readers=[],inventory=[];let complete=false;
 try{
  for(const name of databases){const file=path.join(source,name);try{await regular(file);}catch(e){if(e.code==='ENOENT')continue;throw e;}
   const original=await regular(file),writer=new DatabaseSync(file);held.push({writer,name,dev:original.dev,ino:original.ino});writer.exec('PRAGMA busy_timeout=1000; BEGIN IMMEDIATE;');
  }
  if(!held.length)throw Error('No operational databases found.');
  if(!await idle())throw Error('Worker became busy before backup.');
  for(const {name,dev,ino} of held){const file=path.join(source,name),st=await regular(file);if(st.dev!==dev||st.ino!==ino)throw Error('Source database changed during backup.');
   const db=new DatabaseSync(file,{readOnly:true});readers.push(db);const out=path.join(destination,name);db.prepare('VACUUM INTO ?').run(out);await chmod(out,0o600);integrity(out);inventory.push([name,(await lstat(out)).size,await sha(out)]);
  }
  for(const name of files){const file=path.join(source,name);await regular(file);const hash=await sha(file),out=path.join(destination,name);await mkdir(path.dirname(out),{recursive:true,mode:0o700});await copyFile(file,out);await chmod(out,0o600);if(await sha(file)!==hash||await sha(out)!==hash)throw Error('Configuration changed during backup.');inventory.push([name,(await lstat(out)).size,hash]);}
  for(const {name,dev,ino} of held){const st=await regular(path.join(source,name));if(st.dev!==dev||st.ino!==ino)throw Error('Source database changed during backup.');}
  if(inventory.reduce((n,f)=>n+f[1],0)>maxBytes)throw Error('Backup exceeds its configured byte budget; previous backups retained.');
  const content={format:'athanor-storage-backup/v1',workerId:await storageWorkerId(source),createdAt:new Date().toISOString(),inventory,consistency:'Both existing SQLite databases held against writes while snapshotted through SQLite VACUUM INTO; configuration hashes matched before and after copying.'};
  await writeFile(path.join(destination,'manifest.json'),JSON.stringify({...content,sha256:digest(content)},null,2)+'\n',{mode:0o600,flag:'wx'});complete=true;
  return {path:destination,files:inventory.length,bytes:inventory.reduce((n,f)=>n+f[1],0),manifestHash:digest(content)};
 }finally{for(const db of readers)db.close();for(const {writer} of held.reverse()){try{if(writer.isTransaction)writer.exec('ROLLBACK');}finally{writer.close();}}if(!complete)await rm(destination,{recursive:true,force:true});}
}
export async function verifyStorageBackup(source){
 source=externalPath(source);await regular(path.join(source,'manifest.json'));const {sha256,...content}=await readJSON(path.join(source,'manifest.json'));
 if(content.format!=='athanor-storage-backup/v1'||!validId(content.workerId)||digest(content)!==sha256||!Array.isArray(content.inventory)||new Set(content.inventory.map(f=>f[0])).size!==content.inventory.length||!content.inventory.some(f=>databases.includes(f[0])))throw Error('Invalid backup manifest.');
 for(const row of content.inventory){if(!Array.isArray(row)||row.length!==3)throw Error('Invalid backup inventory.');const [name,size,hash]=row;if(!safe(name)||!Number.isSafeInteger(size)||size<0||!/^[a-f0-9]{64}$/.test(hash||''))throw Error('Invalid backup file.');const file=path.join(source,name),st=await regular(file);if(st.size!==size||await sha(file)!==hash)throw Error('Backup file changed: '+name);if(databases.includes(name))integrity(file);}
 return {...content,sha256};
}
export async function restoreStorageBackup(source,destination){
 const record=await verifyStorageBackup(source);destination=externalPath(destination);source=externalPath(source);
 if(destination===source||inside(source,destination)||inside(destination,source))throw Error('Restore needs a separate new directory.');
 await mkdir(path.dirname(destination),{recursive:true,mode:0o700});const staging=destination+'.restore-'+randomUUID();await mkdir(staging,{mode:0o700});
 try{
  for(const [name,size,hash] of record.inventory){const out=path.join(staging,name);await mkdir(path.dirname(out),{recursive:true,mode:0o700});await copyFile(path.join(source,name),out);await chmod(out,0o600);if((await lstat(out)).size!==size||await sha(out)!==hash)throw Error('Backup changed while restoring.');}
  const file=path.join(staging,'controller.sqlite');let scheduleDisabled=false;
  if(record.inventory.some(f=>f[0]==='controller.sqlite')){const db=new DatabaseSync(file);try{if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='controller_schedule'").get()){db.exec('BEGIN IMMEDIATE');try{const rows=db.prepare('SELECT id,record FROM controller_schedule').all();for(const row of rows){const schedule=JSON.parse(row.record);schedule.enabled=false;db.prepare('UPDATE controller_schedule SET record=? WHERE id=?').run(JSON.stringify(schedule),row.id);}db.exec('COMMIT');scheduleDisabled=true;}catch(e){db.exec('ROLLBACK');throw e;}}}finally{db.close();}integrity(file);}
  await writeFile(path.join(staging,'restore-receipt.json'),JSON.stringify({format:'athanor-storage-restore/v1',backupHash:record.sha256,scheduleDisabled,servicesStarted:false,requires:'Rebase worker paths, create a fresh source profile and explicitly review the next due slot before enabling.'},null,2)+'\n',{mode:0o600,flag:'wx'});
  // mkdir is the no-overwrite reservation; rename cannot clobber an existing worker.
  await mkdir(destination,{mode:0o700});try{for(const name of await readdir(staging))await rename(path.join(staging,name),path.join(destination,name));}catch(e){throw Object.assign(e,{partialRestore:destination});}
  return {path:destination,scheduleDisabled,servicesStarted:false,backupHash:record.sha256};
 }finally{await rm(staging,{recursive:true,force:true});}
}
