import path from 'node:path';
import {realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {readJSON,writeJSON,sha} from '../runner/files.mjs';
import {OutcomeError} from '../runner/engine.mjs';

// The shipped headless creator omits the GUI's writer stamp. Record the actual creator only on our new, closed fixture.
export async function recordFixtureVersion({root,bundle,app,packageHash}){
 const blocked=message=>{throw new OutcomeError(message,'Blocked');};
 const expected=path.join(root,'projects',path.basename(root),'Golden.wiz'),file=path.join(bundle,'project.json');
 if(bundle!==expected||realpathSync(root)!==root||realpathSync(file)!==file)blocked('Fixture version recording requires the newly generated owned project.');
 const project=await readJSON(file),before=await sha(file);
 if(project.name!==`Golden ${path.basename(root)}`)blocked('Generated fixture name does not match its creator.');
 const version=execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion',path.join(app,'Contents/Info.plist')],{encoding:'utf8',timeout:5000}).trim();
 if(!version||version.toLowerCase()==='dev')blocked('The selected package has no stampable creator version.');
 const present=Object.hasOwn(project,'wizard_version');
 if(present&&project.wizard_version!==version)blocked('Preserve the existing project writer version; review the mismatch.');
 if(!present)await writeJSON(file,{...project,wizard_version:version});
 const receipt={format:'athanor-generated-fixture-version/v1',packageHash,app,bundle,version,before,after:await sha(file),added:!present,reason:'Fresh fixture created by this selected packaged headless engine; no migration accepted.'};
 await writeJSON(path.join(root,'fixture-version.json'),receipt);return receipt;
}
