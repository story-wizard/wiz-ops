import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,mkdir,readFile,realpath,lstat,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

test('selected-build launch supplies an existing private temp directory instead of the macOS alias',async()=>{
 const source=process.env.ATHANOR_REVIEW_BASELINE?execFileSync('/usr/bin/git',['show',process.env.ATHANOR_REVIEW_BASELINE+':smoke/desktop/attach.mjs'],{encoding:'utf8'}):await readFile(new URL('../desktop/attach.mjs',import.meta.url),'utf8');
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'athanor temp launch ')));
 try{
  const start=source.indexOf(' const generation='),end=source.indexOf(' await cp(tools.directory',start),envStart=source.indexOf(' const env=',end),envEnd=source.indexOf('\n // Use the shipped launcher',envStart);
  assert.ok(start>=0&&end>start&&envStart>end&&envEnd>envStart);
  const create=Function('path','mkdir','root','preparedSession','return (async()=>{'+source.slice(start,end)+';return {native,settings,home,plugins,generation,...(typeof temp==="undefined"?{}:{temp})};})();');
  const dirs=await create(path,mkdir,root,undefined);
  const env=Function('path','root','copy','session',...Object.keys(dirs),source.slice(envStart,envEnd)+';return env;')(path,root,path.join(root,'Wizard Smoke.app'),{harnessId:'test'},...Object.values(dirs));
  assert.equal(env.TMPDIR,path.join(root,'tmp'));const stat=await lstat(env.TMPDIR);
  assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());assert.equal(stat.mode&0o777,0o700);assert.equal(await realpath(env.TMPDIR),env.TMPDIR);
  assert.equal(env.WIZSERVER_SANDBOX_ROOT,root);assert.equal(env.HOME,dirs.home);
 }finally{await rm(root,{recursive:true,force:true});}
});
