import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {importBuild,findBuilds} from '../builds.mjs';

const validator=fileURLToPath(new URL('../scripts/validate-build-zip.py',import.meta.url));
test('ZIP validation rejects actual deflate payload lengths that differ from the declared expansion size',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'smoke-zip-expansion-'));
 try{
  const archive=path.join(root,'payload.zip');
  execFileSync('python3',['-c',`import sys,zipfile
with zipfile.ZipFile(sys.argv[1],'w',compression=zipfile.ZIP_DEFLATED) as z:z.writestr('payload',b'x'*1048576)
`,archive]);
  assert.equal(spawnSync('python3',[validator,archive]).status,0,'A consistent, bounded compressed archive is accepted');
  // Preserve its compressed stream, but lie about expansion in both ZIP headers.
  execFileSync('python3',['-c',`import sys,struct
p=sys.argv[1];data=bytearray(open(p,'rb').read())
struct.pack_into('<I',data,data.index(b'PK\\x03\\x04')+22,1)
struct.pack_into('<I',data,data.index(b'PK\\x01\\x02')+24,1)
open(p,'wb').write(data)
`,archive]);
  const result=spawnSync('python3',[validator,archive]);
  // Also forge a self-consistent empty-file CRC: metadata-only CRC readers accept it.
  execFileSync('python3',['-c',`import sys,struct
p=sys.argv[1];data=bytearray(open(p,'rb').read());local=data.index(b'PK\\x03\\x04');central=data.index(b'PK\\x01\\x02')
for offset in [local+22,central+24,local+14,central+16]:struct.pack_into('<I',data,offset,0)
open(p,'wb').write(data)
`,archive]);
  const empty=spawnSync('python3',[validator,archive]);
  assert.notEqual(result.status,0,'A 1 MiB stream advertised as one byte must be rejected before native extraction');
  assert.notEqual(empty.status,0,'A nonempty stream disguised as an empty file with CRC zero must also be rejected');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('re-importing an original archive refuses a changed cached app without erasing that app', {skip:process.platform!=='darwin'},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'smoke-build-integrity-'));
 try{
  const source=path.join(root,'input/Wizard.app');await mkdir(path.join(source,'Contents/MacOS'),{recursive:true});
  await writeFile(path.join(source,'Contents/Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>wizard</string></dict></plist>');
  await writeFile(path.join(source,'Contents/MacOS/wizard'),'original fixture bytes',{mode:0o755});
  const archive=path.join(root,'original.zip');execFileSync('/usr/bin/ditto',['-c','-k','--keepParent',source,archive]);
  const data=path.join(root,'station'),original=await importBuild(data,{path:archive});
  assert.equal((await importBuild(data,{path:archive})).app,original.app,'Unchanged imports reuse the existing package');
  const executable=path.join(original.app,'Contents/MacOS/wizard');await writeFile(executable,'modified fixture bytes',{mode:0o755});
  await assert.rejects(()=>importBuild(data,{path:archive}),/cache|package|identity|changed|inspection/i,'Changed extracted bytes cannot retain the archive association');
  assert.equal(await readFile(executable,'utf8'),'modified fixture bytes','Inspection must preserve changed-cache evidence');
  assert.equal((await importBuild(data,{path:original.app})).app,await realpath(original.app),'An explicit local app remains a valid distinct selection');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a refreshed first page reopens older-build discovery when release history grows',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'smoke-build-history-growth-'));
 let count=1;
 const release=i=>({tag_name:'tag-'+i,name:'Build '+i,published_at:'2026-10-01',assets:[{id:i,name:'Wizard-macOS.zip',size:123}]});
 const get=async endpoint=>{
  if(endpoint==='user')return {login:'Tester'};
  if(endpoint.includes('/runs?'))return {workflow_runs:[]};
  if(endpoint.includes('/releases?')){const params=new URL('https://example.com/'+endpoint).searchParams,page=Number(params.get('page')),size=Number(params.get('per_page'));return Array.from({length:count},(_,i)=>release(i+1)).slice((page-1)*size,page*size);}
  throw Error('Unexpected provider request: '+endpoint);
 };
 try{
  const first=await findBuilds(root,{get});assert.equal(first.hasMoreGitHub,false);
  count=51;const refreshed=await findBuilds(root,{get,refresh:true});
  assert.equal(refreshed.hasMoreGitHub,true,'Reaching the old end of history must not hide new provider pages');
  const older=await findBuilds(root,{get,githubPage:refreshed.nextGitHubPage});
  assert.equal(older.builds.length,51);assert.ok(older.builds.some(b=>b.assetId===51));assert.equal(older.hasMoreGitHub,false);
 }finally{await rm(root,{recursive:true,force:true});}
});
