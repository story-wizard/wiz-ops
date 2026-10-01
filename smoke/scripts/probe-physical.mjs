import {exportPhysicalReport} from './export-physical-report.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareDesktop,launchDesktop,stopDesktop} from '../desktop/adapter.mjs';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {command,assert} from '../runner/engine.mjs';
const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1],batch=args.includes('--course')?arg('--course'):'spellbook';
assert(['spellbook','editor'].includes(batch),'Choose --course spellbook or editor');
const course=await readJSON(new URL(batch==='editor'?'../desktop/physical-editor-course.json':'../desktop/physical-course.json',import.meta.url));
if(args.includes('--list')){console.log(JSON.stringify(course,null,2));process.exit(0);}
assert(args.includes('--plan'),'Use --plan /absolute/prepared-plan.json [--checks ID,ID]');
const plan=await readJSON(arg('--plan')),ids=args.includes('--checks')?arg('--checks').split(','):course.cases.map(c=>c.id);
assert(ids.length&&new Set(ids).size===ids.length&&ids.every(id=>course.cases.some(c=>c.id===id)),'Choose candidate physical check IDs');
const s=await prepareDesktop(plan.runtime.app,plan.runtime.qtPlugin,plan.runtime.cli,{dataDir:process.env.SMOKE_DATA_DIR,plan});s.selectedChecks=ids;
const file=path.join(s.root,'session.json');await writeJSON(file,s);let live;
try{
 live=await launchDesktop(s);
 const result=await command(process.execPath,[fileURLToPath(new URL(batch==='editor'?'../desktop/check-physical-editor.mjs':'../desktop/check-physical.mjs',import.meta.url)),file],{timeout:240000});
 await writeJSON(path.join(s.root,'physical-execution.json'),result);console.log(JSON.stringify({root:s.root,...await readJSON(path.join(s.root,'desktop-physical-report.json'))},null,2));
 if(result.code!==0)process.exitCode=1;
}finally{if(live&&live.child.exitCode===null&&!live.child.signalCode){await stopDesktop(file);await live.closed;}}

console.log(JSON.stringify({format:'wizard-smoke-physical/v1',report:await exportPhysicalReport(file)},null,2));
