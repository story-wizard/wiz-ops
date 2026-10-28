import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {readJSON,dataDirectory} from '../runner/files.mjs';
import {configureStorage,storageStatus,storageDefaults} from '../runner/worker-storage.mjs';
import {backupStorage,verifyStorageBackup,restoreStorageBackup} from '../runner/storage-backup.mjs';
import {ownedDesktopSessions,desktopState} from '../desktop/hub.mjs';
import {client} from './smoke.mjs';

export async function main(args){
 const action=args.shift(),flags={};for(let i=0;i<args.length;i++){const key=args[i],value=args[++i];if(!key?.startsWith('--')||Object.hasOwn(flags,key)||!value||value.startsWith('--'))throw Error('Invalid storage option.');flags[key]=value;}
 const allowed={configure:['--data-dir','--policy'],status:['--data-dir'],maintain:['--server'],backup:['--data-dir','--out','--files'],verify:['--backup'],restore:['--backup','--out']};
 if(!allowed[action]||Object.keys(flags).some(k=>!allowed[action].includes(k)))throw Error('Usage: storage configure|status|maintain|backup|verify|restore. See docs/worker-storage.md.');
 const required=k=>{if(!flags[k])throw Error('Required option: '+k);return flags[k];};
 if(action==='configure')return configureStorage(dataDirectory(required('--data-dir')),flags['--policy']?await readJSON(flags['--policy']):storageDefaults);
 if(action==='status')return storageStatus(dataDirectory(required('--data-dir')));
 if(action==='maintain')return client(required('--server'))('/api/storage/maintain',{});
 if(action==='verify')return verifyStorageBackup(required('--backup'));
 if(action==='restore')return restoreStorageBackup(required('--backup'),required('--out'));
 const dataDir=dataDirectory(required('--data-dir'));
 const idle=async()=>{
  if(ownedDesktopSessions(dataDir).length||desktopState(dataDir).jobs.some(j=>['Preparing','Ready','Running'].includes(j.state)))return false;
  let db;try{db=new DatabaseSync(path.join(dataDir,'smoke.sqlite'),{readOnly:true});return !db.prepare("SELECT 1 FROM executions WHERE state IN ('Queued','Preflight','Running','Waiting for human','Continuing') LIMIT 1").get();}finally{db?.close();}
 };
 return backupStorage(dataDir,required('--out'),{files:flags['--files']?await readJSON(flags['--files']):[],idle});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{console.log(JSON.stringify({format:'athanor-storage-cli/v1',result:await main(process.argv.slice(2))},null,2));}catch(e){console.error(JSON.stringify({format:'athanor-storage-cli/v1',error:e.message}));process.exitCode=3;}
