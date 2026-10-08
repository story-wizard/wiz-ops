import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertMappedPackagedSchema} from '../runner/prepare.mjs';
import {digest} from '../runner/files.mjs';
const captured=JSON.parse(await readFile(new URL('../runner/contracts/installed-schema.json',import.meta.url))),qualified=JSON.parse(await readFile(new URL('../runner/contracts/packaged-schema-qualifications.json',import.meta.url)));
test('mapped builds and the reviewed eighth-resolution extension prepare, while unreviewed command changes stay blocked',()=>{
 assert.doesNotThrow(()=>assertMappedPackagedSchema(captured,captured,qualified));
 const nightly=structuredClone(captured),mode=nightly.operations['render.set_render_mode'].properties.mode;
 mode.description="Timeline preview resolution while playing or scrubbing, the same setting as the viewer's selector: 'full' (no reduction), 'auto', 'half', 'quarter', or 'eighth'";mode.enum.push('eighth');
 assert.doesNotThrow(()=>assertMappedPackagedSchema(nightly,captured,qualified),'The reviewed nightly extension must be usable');
 const reviewedNightly=structuredClone(nightly);
 mode.enum=mode.enum.filter(v=>v!=='full');assert.throws(()=>assertMappedPackagedSchema(nightly,captured,qualified),/different command schema/,'Removing a mapped mode must remain blocked');
 const changed=structuredClone(captured);delete changed.operations['project.create'];assert.throws(()=>assertMappedPackagedSchema(changed,captured,qualified),/different command schema/,'Unknown missing operations must remain blocked');
 const extension=structuredClone(reviewedNightly);extension.operations['render.set_render_mode'].properties.mode.enum.push('sixteenth');assert.equal(assertMappedPackagedSchema(extension,captured,qualified).mode,'compatible-extension','Request enum extension preserves all reviewed values');
 const wrongBaseline={...qualified,baselineHash:'wrong'};assert.throws(()=>assertMappedPackagedSchema(reviewedNightly,captured,wrongBaseline),/different command schema/);
});

test('October 6 packaged contract is qualified exactly, without approving later changes or a different baseline',async()=>{
 // Only the eleven changed/added operation definitions are retained; the baseline stays intact.
 const operations=JSON.parse(await readFile(new URL('../runner/contracts/packaged-schema-2026.10.06-operations.json',import.meta.url)));
 const nightly={...captured,operations:Object.fromEntries(Object.entries({...captured.operations,...operations}).sort(([a],[b])=>a.localeCompare(b)))};
 assert.equal(digest(nightly),'285748db89d4172a33dfd5c5b1f4478681326fd4d2f3d20e70f6e6a249f5b1bb');
 assert.equal(Object.keys(nightly.operations).length,165);
 assert.doesNotThrow(()=>assertMappedPackagedSchema(nightly,captured,qualified));
 const oldQualifications={...qualified,reviewed:qualified.reviewed.filter(r=>r.schemaHash!==digest(nightly))};
 assert.throws(()=>assertMappedPackagedSchema(nightly,captured,oldQualifications),/different command schema/);
 assert.throws(()=>assertMappedPackagedSchema(nightly,captured,{...qualified,baselineHash:'wrong'}),/different command schema/);
 for(const mutate of [
  s=>delete s.operations['project.create'],
  s=>s.operations['media.detect_color'].required.push('category'),
  s=>s.operations['search.query'].properties.scope.oneOf.shift(),
  s=>s.operations['clip_effects.move_keyframe'].properties.time.required.pop(),
  s=>s.operations['render.set_render_mode'].properties.mode.enum.shift(),
 ]){const changed=structuredClone(nightly);mutate(changed);assert.throws(()=>assertMappedPackagedSchema(changed,captured,qualified),/different command schema/);}
});

test('compatible extensions roll forward from the baseline and reviewed October contract with retained reasons',async()=>{
 const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reorder(v)])):value;
 assert.equal(assertMappedPackagedSchema(reorder(captured),captured,qualified).mode,'compatible-extension');
 for(const anchor of [captured,{...captured,operations:Object.fromEntries(Object.entries({...captured.operations,...JSON.parse(await readFile(new URL('../runner/contracts/packaged-schema-2026.10.06-operations.json',import.meta.url)))}).sort(([a],[b])=>a.localeCompare(b)))}]){
  const nightly=structuredClone(anchor);
  nightly.operations['new.read_only']={type:'object',properties:{},additionalProperties:false};
  nightly.results['new.read_only']={type:'object'};
  nightly.errors['new.read_only']={type:'object'};
  nightly.operations['render.set_render_mode'].properties.mode.enum.push('sixteenth');
  const r=assertMappedPackagedSchema(nightly,captured,qualified);
  assert.equal(r.mode,'compatible-extension');assert.equal(r.anchorHash,digest(anchor));assert.equal(r.schemaHash,digest(nightly));
  assert.deepEqual(new Set(r.changes.map(c=>c.kind)),new Set(['operation-added','request-enum-expanded']));
  nightly.operations['project.create'].required.push('new_required');
  assert.throws(()=>assertMappedPackagedSchema(nightly,captured,qualified),e=>e.schemaCompatibility.issues.some(p=>p.includes('project.create.required')));
 }
});

test('structural compatibility never widens response, semantic, composition or open-object contracts',()=>{
 const baseline={operations:{edit:{type:'object',additionalProperties:false,properties:{mode:{type:'string',enum:['old']}},required:['mode']}},results:{edit:{type:'string',enum:['ok']}},errors:{}};
 const optional=structuredClone(baseline);optional.operations.edit.properties.label={type:'string'};
 assert.equal(assertMappedPackagedSchema(optional,baseline,null).changes[0].kind,'optional-closed-object-property');
 const withPattern=structuredClone(baseline);withPattern.operations.edit.patternProperties={'.*':{}};
 const narrowed=structuredClone(withPattern);narrowed.operations.edit.properties.label={type:'string'};
 assert.throws(()=>assertMappedPackagedSchema(narrowed,withPattern,null),/different command schema/);
 const open=structuredClone(baseline);open.operations.edit.additionalProperties=true;
 const constrained=structuredClone(open);constrained.operations.edit.properties.label={type:'string'};
 assert.throws(()=>assertMappedPackagedSchema(constrained,open,null),/different command schema/);
 const referenced=structuredClone(baseline);referenced.operations.edit.not={$ref:'#/operations/edit/properties/mode'};
 const expanded=structuredClone(referenced);expanded.operations.edit.properties.mode.enum.push('new');
 assert.throws(()=>assertMappedPackagedSchema(expanded,referenced,null),/referenced schema requires review/);
 for(const mutate of [
  s=>s.results.edit.enum.push('unexpected'),
  s=>s.operations.edit.properties.mode.enum.splice(0,1,'new'),
  s=>s.operations.edit.properties.mode.description='Now uses a different clock',
  s=>s.operations.edit.properties.mode.default='old',
  s=>s.operations.edit.allOf=[{not:{required:['mode']}}],
  s=>s.operations.edit.properties.mode.type='number',
  s=>s.operations.edit.properties.mode.enum.push('new')&&delete s.operations.edit.properties.mode.type,
  s=>s.$defs={changed:{type:'string'}},
 ]){const changed=structuredClone(baseline);mutate(changed);assert.throws(()=>assertMappedPackagedSchema(changed,baseline,null),/different command schema/);}
 assert.throws(()=>assertMappedPackagedSchema({operations:null},baseline,null),/Invalid packaged/);
 const broken=structuredClone(qualified);broken.reviewed.find(r=>r.operationsFile).schemaHash='bad';
 const future=structuredClone(captured);future.operations.extra={type:'object'};
 assert.throws(()=>assertMappedPackagedSchema(future,captured,broken),/definitions no longer match/);
});

test('October 8 document semantics require exact review and leave old contracts and rejection gates intact',async()=>{
 const operations=JSON.parse(await readFile(new URL('../runner/contracts/packaged-schema-2026.10.08-operations.json',import.meta.url)));
 const nightly={...captured,operations:Object.fromEntries(Object.entries({...captured.operations,...operations}).sort(([a],[b])=>a.localeCompare(b)))};
 const hash='77462be3c4ea7d5efad8894a6b183d0bf26a56b592d90ecff9a0c36fabb82db3';
 assert.equal(digest(nightly),hash);assert.equal(Object.keys(nightly.operations).length,166);
 assert.equal(assertMappedPackagedSchema(nightly,captured,qualified).mode,'reviewed-exact');
 const prior={...qualified,reviewed:qualified.reviewed.filter(r=>r.schemaHash!==hash)};
 assert.throws(()=>assertMappedPackagedSchema(nightly,captured,prior),e=>e.schemaCompatibility.issues.includes('operations.documents.rename.properties.name.description'));
 assert.equal(assertMappedPackagedSchema(captured,captured,qualified).mode,'baseline');
 for(const mutate of [
  s=>s.operations['documents.rename'].properties.name.description='Identity is now something else',
  s=>s.operations['documents.create'].required.push('new_required'),
  s=>s.operations['media.sample_frames'].properties.keyframe_tolerance.maximum=20,
  s=>delete s.operations['documents.delete'],
  s=>s.results.changed={type:'string'},
 ]){const changed=structuredClone(nightly);mutate(changed);assert.throws(()=>assertMappedPackagedSchema(changed,captured,qualified),/different command schema/);}
 const extension=structuredClone(nightly);extension.operations['new.read']={type:'object'};
 assert.equal(assertMappedPackagedSchema(extension,captured,qualified).anchorHash,hash);
});
