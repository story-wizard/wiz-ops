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
 const extension=structuredClone(reviewedNightly);extension.operations['render.set_render_mode'].properties.mode.enum.push('sixteenth');assert.throws(()=>assertMappedPackagedSchema(extension,captured,qualified),/different command schema/,'An unreviewed additive change must remain blocked');
 const wrongBaseline={...qualified,baselineHash:'wrong'};assert.throws(()=>assertMappedPackagedSchema(reviewedNightly,captured,wrongBaseline),/different command schema/);
});

test('October 6 packaged contract is qualified exactly, without approving later changes or a different baseline',async()=>{
 // Only the eleven changed/added operation definitions are retained; the baseline stays intact.
 const operations=JSON.parse(await readFile(new URL('./fixtures/packaged-schema-2026.10.06-operations.json',import.meta.url)));
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
  s=>s.operations['render.set_render_mode'].properties.mode.enum.push('sixteenth'),
 ]){const changed=structuredClone(nightly);mutate(changed);assert.throws(()=>assertMappedPackagedSchema(changed,captured,qualified),/different command schema/);}
});
