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
 const prior={...qualified,reviewed:qualified.reviewed.filter(r=>r.reviewedAt<'2026-10-08')};
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


test('October 9 reviewed removals permit unaffected checks but never dispatch retired generation operations',async()=>{
 const entry=qualified.reviewed.find(r=>r.reviewedAt==='2026-10-09'),operations=JSON.parse(await readFile(new URL('../runner/contracts/'+entry.operationsFile,import.meta.url)));
 const nightly={...captured,operations:Object.fromEntries(Object.entries({...captured.operations,...operations}).filter(([op])=>!entry.removedOperations.includes(op)).sort(([a],[b])=>a.localeCompare(b)))};
 assert.equal(Object.keys(nightly.operations).length,162);assert.equal(digest(nightly),entry.schemaHash);
 assert.equal(assertMappedPackagedSchema(nightly,captured,qualified).mode,'reviewed-exact');
 const prior={...qualified,reviewed:qualified.reviewed.filter(r=>r!==entry)};
 assert.throws(()=>assertMappedPackagedSchema(nightly,captured,prior),/different command schema/);
 const {validateApplicationParams}=await import('../desktop/agent-proof.mjs');
 for(const op of entry.removedOperations)assert.throws(()=>validateApplicationParams(nightly,op,{}),e=>e.status==='Blocked'&&e.code==='unsupported_operation');
 const extension=structuredClone(nightly);extension.operations['new.read']={type:'object'};
 assert.equal(assertMappedPackagedSchema(extension,captured,qualified).anchorHash,entry.schemaHash);
 for(const mutate of [s=>delete s.operations['project.create'],s=>s.operations['generate.graphics'].properties.content.required.push('resources_path'),s=>s.operations['generate.graphics'].properties.content.properties.source_path.description='Only remote sources']){
  const changed=structuredClone(nightly);mutate(changed);assert.throws(()=>assertMappedPackagedSchema(changed,captured,qualified),/different command schema/);
 }
 const malformed=structuredClone(qualified);malformed.reviewed.at(-1).removedOperations=['project.create','project.create'];assert.throws(()=>assertMappedPackagedSchema(extension,captured,malformed),/Invalid reviewed/);
});

test('reviewed request and result definitions form a reusable anchor without approving new semantic changes',async()=>{
 const {operationSupport}=await import('../runner/schema-compatibility.mjs');
 const {admitChecks}=await import('../runner/capabilities.mjs');
 const {resolveSelection,selectedRecipe}=await import('../runner/catalog.mjs');
 const entry=qualified.reviewed.find(r=>r.reviewedAt==='2026-10-23');
 const operations=JSON.parse(await readFile(new URL('../runner/contracts/'+entry.operationsFile,import.meta.url))),results=JSON.parse(await readFile(new URL('../runner/contracts/'+entry.resultsFile,import.meta.url)));
 const ordered=o=>Object.fromEntries(Object.entries(o).sort(([a],[b])=>a.localeCompare(b)));
 const schema={...captured,operations:ordered(Object.fromEntries(Object.entries({...captured.operations,...operations}).filter(([op])=>!entry.removedOperations.includes(op)))),results:ordered({...captured.results,...results})};
 assert.equal(digest(schema),entry.schemaHash);
 const course=selectedRecipe(resolveSelection({}, {courseIds:['smoke-full'],subsetIds:['IN-01','A-TL-01','A-RG-01'],desktopMode:'grouped'}));
 const old={...qualified,reviewed:qualified.reviewed.filter(e=>e!==entry)};
 assert(operationSupport(schema,captured,old).unqualifiedOperations.includes('timeline.inspect'));
 assert(operationSupport(schema,captured,old).unqualifiedOperations.includes('media.import_asset'));
 assert.equal(admitChecks(course,schema,captured,qualified).checks.filter(c=>c.state==='Blocked').length,0);
 const future=structuredClone(schema);future.operations['future.read']={type:'object'};future.results['future.read']={type:'string'};
 assert.equal(assertMappedPackagedSchema(future,captured,qualified).anchorHash,entry.schemaHash);
 for(const mutate of [s=>s.results['timeline.inspect'].properties.schema_version.const='99',s=>s.operations['media.import_asset'].required.push('require_exact_revision'),s=>s.operations['graph.set_param'].properties.producer_slot.description='Different targeting semantics']){
  const changed=structuredClone(future);mutate(changed);assert.throws(()=>assertMappedPackagedSchema(changed,captured,qualified),/different command schema/);
 }
 const broken=structuredClone(qualified);broken.reviewed.at(-1).resultsFile='../escape.json';assert.throws(()=>operationSupport(future,captured,broken),/Invalid reviewed result/);
});


test('optional response metadata preserves consumers, including nested tagged clips, without loosening their assertions',()=>{
 const clip={type:'object',additionalProperties:false,properties:{kind:{const:'clip'},id:{type:'string'},position:{type:'number',description:'Timeline position in seconds'}},required:['kind','id','position']};
 const gap={type:'object',additionalProperties:false,properties:{kind:{const:'gap'},duration:{type:'number'}},required:['kind','duration']};
 const baseline={operations:{inspect:{type:'object'}},results:{inspect:{type:'object',additionalProperties:false,properties:{items:{type:'array',items:{oneOf:[gap,clip]}}},required:['items']}},errors:{}};
 const extended=structuredClone(baseline),branches=extended.results.inspect.properties.items.items.oneOf;
 branches[1].properties.status={type:'array',items:{type:'string'}};
 const receipt=assertMappedPackagedSchema(extended,baseline,null);
 assert.equal(receipt.mode,'compatible-extension');assert.deepEqual(receipt.changes,[{path:'results.inspect.properties.items.items.oneOf[1].properties.status',kind:'optional-response-property'}]);
 for(const mutate of [
  b=>b[1].required.push('status'),b=>b[1].required.splice(1,1),
  b=>delete b[1].properties.id,b=>b[1].properties.position.type='string',
  b=>b[1].properties.position.description='Timeline position in frames',
  b=>b[1].properties.kind.const='other',b=>b.reverse(),
  b=>b[1].additionalProperties=true,
 ]){const broken=structuredClone(extended);mutate(broken.results.inspect.properties.items.items.oneOf);assert.throws(()=>assertMappedPackagedSchema(broken,baseline,null),/different command schema/);}
 const ambiguous=structuredClone(baseline);delete ambiguous.results.inspect.properties.items.items.oneOf[1].properties.kind;
 const ambiguousExtension=structuredClone(ambiguous);ambiguousExtension.results.inspect.properties.items.items.oneOf[1].properties.status={type:'string'};
 assert.throws(()=>assertMappedPackagedSchema(ambiguousExtension,ambiguous,null),/different command schema/);
 const errorExtension=structuredClone(extended);errorExtension.errors.inspect={type:'object'};
 assert.throws(()=>assertMappedPackagedSchema(errorExtension,baseline,null),/different command schema/);
});

test('reviewed import and clip graph extensions admit existing callers without approving unrelated contracts',async()=>{
 const {operationSupport}=await import('../runner/schema-compatibility.mjs');
 const {admitChecks}=await import('../runner/capabilities.mjs');
 const {resolveSelection,selectedRecipe}=await import('../runner/catalog.mjs');
 const entry=qualified.reviewed.find(r=>r.operationsFile==='packaged-schema-2026.10.31-local-operations.json');
 const operations=JSON.parse(await readFile(new URL('../runner/contracts/'+entry.operationsFile,import.meta.url)));
 const schema={...captured,operations:Object.fromEntries(Object.entries({...captured.operations,...operations}).sort(([a],[b])=>a.localeCompare(b)))};
 assert.equal(digest(schema),entry.schemaHash);
 const old={...qualified,reviewed:qualified.reviewed.filter(e=>e!==entry)};
 const recipe=selectedRecipe(resolveSelection({}, {courseIds:['smoke-full'],subsetIds:['IN-01','A-RG-01'],desktopMode:'grouped'}));
 assert(admitChecks(recipe,schema,captured,old).checks.some(c=>c.state==='Blocked'));
 assert(admitChecks(recipe,schema,captured,qualified).checks.every(c=>c.state==='Ready'));
 for(const mutate of [s=>s.operations['media.import_asset'].required.push('media_root'),s=>s.operations['graph.set_param'].properties.clip_id.description='Selects a different graph',s=>s.results['graph.get_clip_graph']={type:'string'}]){
  const changed=structuredClone(schema);mutate(changed);assert(operationSupport(changed,captured,qualified).unqualifiedOperations.length>0);
 }
 const unrelated=structuredClone(schema);unrelated.operations['project.create'].required.push('unreviewed');
 assert(operationSupport(unrelated,captured,qualified).unqualifiedOperations.includes('project.create'));
});
