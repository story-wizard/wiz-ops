import {createHash} from 'node:crypto';
import {createReadStream,existsSync,lstatSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {readFile,writeFile,rename,readdir,lstat,readlink,stat as fileStat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Resolve existing ancestors first so a symlink cannot route output back into source.
export function externalPath(value){
  if(typeof value!=='string'||!path.isAbsolute(value))throw Error('Runtime output requires an absolute path outside the source checkout.');
  let existing=path.resolve(value);const missing=[];
  while(true){try{lstatSync(existing);break;}catch(e){if(e.code!=='ENOENT')throw e;missing.unshift(path.basename(existing));existing=path.dirname(existing);}}
  const resolved=path.join(realpathSync(existing),...missing),source=realpathSync(ROOT);
  if(resolved===source||inside(source,resolved))throw Error('Runtime output must be outside the source checkout.');
  for(let dir=resolved;;dir=path.dirname(dir)){
    if(existsSync(path.join(dir,'.git')))throw Error('Runtime output must be outside Git repositories.');
    if(path.dirname(dir)===dir)break;
  }
  return resolved;
}
export function dataDirectory(value=process.env.SMOKE_DATA_DIR){
  return externalPath(value||path.join(homedir(),...(process.platform==='darwin'?['Library','Application Support']:['.local','state']),'WizardSmoke'));
}

export const readJSON=async file=>JSON.parse(await readFile(file,'utf8'));
export async function writeJSON(file,value){const temporary=`${file}.${process.pid}.tmp`;await writeFile(temporary,JSON.stringify(value,null,2)+'\n');await rename(temporary,file);}
export const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export async function sha(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
export async function fingerprint(directory,{packageTree=false,followFileLinks=false}={}){
  const entries=[];
  async function walk(relative=''){
    const names=(await readdir(path.join(directory,relative))).sort();
    for(const name of names){const rel=path.join(relative,name),file=path.join(directory,rel);
      if(packageTree&&(name==='__pycache__'||name==='.DS_Store'||name.endsWith('.pyc')||rel==='Contents/MacOS/logs'))continue;
      const stat=await lstat(file);
      if(stat.isSymbolicLink()){
        if(followFileLinks){const target=await fileStat(file);if(!target.isFile())throw new Error('Model links must target files: '+file);entries.push([rel,target.size,await sha(file)]);}
        else entries.push([rel,'symlink',await readlink(file)]);
      }
      else if(stat.isDirectory())await walk(rel);
      else if(stat.isFile())entries.push([rel,stat.size,await sha(file)]);
    }
  }
  await walk();return {sha256:digest(entries),files:entries.length,entries};
}
export function inside(parent,file){const rel=path.relative(parent,file);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);}
