import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {ROOT} from '../runner/files.mjs';

// Checks the reviewed inventory, never runs Wizard or promotes evidence to acceptance.
export function checkScope(root=ROOT){
 const read=file=>readFileSync(path.join(root,file));
 const scope=JSON.parse(read('scope/v1-candidate.json'));
 assert.equal(scope.format,'wizard-smoke-scope/v1');
 const checkHash=item=>assert.equal(createHash('sha256').update(read(item.file)).digest('hex'),item.sha256,`${item.file} changed; review and revise the scope explicitly`);
 const ids=[];
 for(const item of scope.courses){
  checkHash(item);const course=JSON.parse(read(item.file));
  assert.equal(course.id,item.id);assert.equal(course.revision,item.revision);
  assert.deepEqual(course.cases.map(c=>c.id),item.requiredCheckIds,`${item.file}: required checks changed`);
  ids.push(...item.requiredCheckIds);
 }
 assert.equal(new Set(ids).size,ids.length,'Duplicate check IDs');
 checkHash(scope.checkpoint);for(const item of scope.fixtureSources)checkHash(item);
 const rows=JSON.parse(read(scope.checkpoint.file)).rows;
 assert.equal(rows.length,scope.checkpoint.rowCount);
 assert.deepEqual(scope.sourceRows.map(r=>r.id),rows.map(r=>r.id),'Original rows were lost or reordered');
 for(const row of scope.sourceRows){assert.ok(['Partial','Not automated','Deferred','Undefined','Full'].includes(row.disposition),`${row.id}: unknown disposition`);assert.ok(row.remaining,`${row.id}: missing coverage boundary`);assert.equal(new Set(row.checkIds).size,row.checkIds.length,`${row.id}: duplicate check mapping`);for(const id of row.checkIds)assert.ok(ids.includes(id),`${row.id}: unknown check ${id}`);}
 return {scope:scope.id,status:scope.status,checks:ids.length,sourceRows:rows.length,dispositions:scope.sourceRows.reduce((n,r)=>(n[r.disposition]=(n[r.disposition]||0)+1,n),{}),fixtureRecipes:scope.fixtureSources.map(f=>f.file),projectVariants:'Fresh: empty starting project available. Story-user / Large: future inputs, currently unavailable.',acceptance:'Not assessed; inventory integrity only'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(checkScope(),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
