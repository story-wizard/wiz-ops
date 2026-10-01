import path from 'node:path';
import {prepareDesktop,launchDesktop,stopDesktop} from '../desktop/adapter.mjs';
import {saveDiscard} from '../desktop/check-lifecycle.mjs';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {command} from '../runner/engine.mjs';
const s=await prepareDesktop(process.env.SMOKE_APP,process.env.SMOKE_QT_PLUGIN,process.env.SMOKE_CLI),file=path.join(s.root,'session.json');let live;
try{live=await launchDesktop(s);const r=await command(process.execPath,['desktop/check-surface.mjs',file],{timeout:120000});await writeJSON(path.join(s.root,'next-execution.json'),r);console.log(JSON.stringify({root:s.root,...await readJSON(path.join(s.root,'desktop-surface-report.json'))}));const holder={live};console.log(await saveDiscard(file,holder));live=holder.live;const verify=await command(process.execPath,['desktop/check-surface.mjs',file,'verify'],{timeout:30000});await writeJSON(path.join(s.root,'document-verify-execution.json'),verify);console.log(await readJSON(path.join(s.root,'desktop-document-reopen-report.json')));}finally{if(live&&live.child.exitCode===null&&!live.child.signalCode){await stopDesktop(file);await live.closed;}}
