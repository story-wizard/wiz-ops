import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {physicalChecks} from '../runner/catalog.mjs';
import {createExplainer} from '../explainer/model.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('explainer preserves evidence scope and only resolves registered artifacts',()=>{
 const data=fs.mkdtempSync(path.join(tmpdir(),'smoke-explainer-'));
 try{
 const save=(file,value)=>{const p=path.join(data,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(value));};
 // Synthetic report fixtures test presentation semantics, never application acceptance.
 const report=results=>({finishedAt:'2026-09-26T16:00:00Z',results});
 save('runs/a3f3360d-baf6-4c37-8e74-1f7912791c46/report.json',report([{id:'A-CLI-01',status:'Pass'}]));
 save('desktop-runs/desktop-rmkVfg/desktop-course-report.json',report([{id:'S-EXPORT-AV1',status:'Pass'}]));
 save('desktop-runs/desktop-m19ncl/desktop-playback-report.json',report([{id:'D-PREVIEW-SCRUB',status:'Pass'},{id:'D-PLAYBACK-LOOP',status:'Blocked'}]));
 save('desktop-runs/desktop-m19ncl/preview-scrub-observations.json',[{image:{path:path.join(data,'desktop-runs/desktop-m19ncl/capture.png'),sampleRgb:'omitted'}}]);
 fs.writeFileSync(path.join(data,'desktop-runs/desktop-m19ncl/capture.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
 save('desktop-runs/desktop-kp2OdB/desktop-course-report.json',{...report([{id:'D-PREVIEW-SCRUB',status:'Blocked'}]),error:'Fixture interruption'});
 const model=createExplainer(root,data),catalog=model.build();
 const definitions=['runner/course.json','desktop/course.json','desktop/service-course.json'].flatMap(f=>JSON.parse(fs.readFileSync(path.join(root,f))).cases).concat(physicalChecks);
 assert.deepEqual(catalog.rows.map(r=>r.id),definitions.map(r=>r.id));
 assert.equal(new Set(catalog.rows.map(r=>r.id)).size,definitions.length);
 for(const row of catalog.rows){assert.ok(row.method&&row.expected,row.id);assert.ok(row.locations.length,row.id);for(const loc of row.locations){assert.ok(loc.excerpt.includes(row.id),row.id);assert.equal(model.file(loc.link.id),path.join(root,loc.file));}}
 const scrub=catalog.rows.find(r=>r.id==='D-PREVIEW-SCRUB');
 assert.equal(scrub.reference.kind,'Focused probe');assert.equal(scrub.reference.status,'Pass');
 assert.ok(scrub.reference.artifacts.some(f=>f.path.endsWith('.png')));
 assert.equal(catalog.rows.find(r=>r.id==='D-PLAYBACK-LOOP').reference.status,'Blocked');
 assert.equal(catalog.rows.find(r=>r.id==='A-CLI-01').reference.kind,'Packaged course');
 assert.equal(catalog.rows.find(r=>r.id==='S-EXPORT-AV1').reference.kind,'Course record');
 assert.ok(scrub.history.some(r=>r.runId==='desktop-kp2OdB'&&r.courseError&&r.context));
 assert.equal(model.file('../../server.mjs'),null);assert.equal(model.file('0'.repeat(32)),null);
 assert.ok(!JSON.stringify(catalog.rows.flatMap(r=>[r.reference,...r.history])).includes('sampleRgb'));
 }finally{fs.rmSync(data,{recursive:true,force:true});}
 const empty=fs.mkdtempSync(path.join(tmpdir(),'smoke-explainer-empty-'));
 try{const rows=createExplainer(root,empty).build().rows;assert.ok(rows.length>0);assert.ok(rows.every(r=>r.reference===null&&r.history.length===0),'Missing local evidence must not become a pass');}finally{fs.rmSync(empty,{recursive:true,force:true});}
});
