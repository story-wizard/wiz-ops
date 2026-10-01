import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertMappedPackagedSchema} from '../runner/prepare.mjs';
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
