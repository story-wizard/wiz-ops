import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {ROOT} from '../runner/files.mjs';
import {checkScope} from '../scripts/check-scope.mjs';
test('scope rejects silently removed checks and changed fixtures',()=>{
 const dir=fs.mkdtempSync(path.join(tmpdir(),'smoke-scope-'));
 try{
  const scope=JSON.parse(fs.readFileSync(path.join(ROOT,'scope/v1-candidate.json')));
  for(const file of ['scope/v1-candidate.json',...scope.courses.map(c=>c.file),scope.checkpoint.file,...scope.fixtureSources.map(f=>f.file)]){fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.copyFileSync(path.join(ROOT,file),path.join(dir,file));}
  assert.equal(checkScope(dir).checks,189);
  const file=scope.courses[0].file,c=JSON.parse(fs.readFileSync(path.join(dir,file)));c.cases.pop();fs.writeFileSync(path.join(dir,file),JSON.stringify(c));
  assert.throws(()=>checkScope(dir),/changed; review/);
  fs.copyFileSync(path.join(ROOT,file),path.join(dir,file));
  fs.appendFileSync(path.join(dir,scope.fixtureSources[0].file),'\n// altered fixture recipe\n');
  assert.throws(()=>checkScope(dir),/changed; review/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
