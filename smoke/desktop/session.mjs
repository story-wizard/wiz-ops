import {prepareDesktop,launchDesktop,desktopCall,stopDesktop,nativeCall} from './adapter.mjs';
import {checkPrepared} from '../runner/prepare.mjs';
import path from 'node:path';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {agentTool,sessionContext,agentSessionTimeoutMs} from './agent-tools.mjs';
import {normalizeToolError} from './agent-proof.mjs';
import {agentSequence,checkSequence,serveAgentTools,toolError} from './agent-connection.mjs';
const [action,target,operation,params]=process.argv.slice(2);
if(action==='start'||action==='resume'){
  let session;
  if(action==='resume')session=await readJSON(target);
  else if(target==='--plan'){const prepared=await checkPrepared(undefined,await readJSON(operation)),runtime=prepared.plan.runtime;if(!runtime)throw Error('Prepare a desktop selection before opening an atomic-tool session.');session=await prepareDesktop(runtime.app,runtime.qtPlugin,runtime.cli,{plan:prepared.plan});}
  else session=await prepareDesktop(target,operation);
  const {child,closed}=await launchDesktop(session);
  const stop=()=>child.kill('SIGTERM');process.on('SIGTERM',stop);process.on('SIGINT',stop);
  // An unattended agent session must not leave a GUI process running indefinitely.
  const deadlineAt=new Date(Date.now()+agentSessionTimeoutMs).toISOString(),limit=setTimeout(stop,agentSessionTimeoutMs);
  try{const file=path.join(session.root,'session.json');await writeJSON(file,{...await readJSON(file),agentDeadlineAt:deadlineAt});await sessionContext(file);console.log(JSON.stringify({format:'athanor-agent-session/v1',state:'Ready',session:file,context:path.join(session.root,'agent-context.json'),pid:session.pid,bundle:session.bundle,packageHash:session.guiHash,deadlineAt}));await closed;}
  finally{clearTimeout(limit);if(child.exitCode===null&&!child.signalCode){stop();await closed;}}
}else if(action==='tools')await serveAgentTools(target);
else if(action==='batch'||action==='batch-check'){
 const checking=action==='batch-check';
 try{const result=await (checking?checkSequence:agentSequence)(target,await readJSON(operation));console.log(JSON.stringify(result,null,2));if(result.status!==(checking?'Valid':'Completed'))process.exitCode=result.status==='Unknown'?5:3;}
 catch(e){const result=toolError(e);console.log(JSON.stringify({format:checking?'athanor-agent-sequence-check/v1':'athanor-agent-sequence/v1',...result}));process.exitCode=result.status==='Unknown'?5:3;}
}else if(action==='tool'){
 try{console.log(JSON.stringify({format:'athanor-agent-tool/v1',operation,result:await agentTool(target,operation,JSON.parse(params||'{}'))},null,2));}
 catch(e){e=normalizeToolError(e);console.log(JSON.stringify({format:'athanor-agent-tool/v1',operation,status:e.status||'Blocked',code:e.code||'tool_failed',origin:e.origin||'harness',error:e.message,nextActions:e.nextActions||['correct_parameters','context'],diagnostics:e.diagnostics||null,evidence:e.evidence||null}));process.exitCode=e.status==='Unknown'?5:3;}
}else if(action==='call'||action==='native'){
 try{const session=await readJSON(target),p=JSON.parse(params||'{}');console.log(JSON.stringify(session.agentTracking?await agentTool(target,action,{operation,params:p}):await (action==='call'?desktopCall:nativeCall)(target,operation,p),null,2));}
 catch(e){e=normalizeToolError(e);console.log(JSON.stringify({format:'athanor-agent-tool/v1',operation,status:e.status||'Blocked',code:e.code||'tool_failed',error:e.message,nextActions:e.nextActions||['correct_parameters','context']}));process.exitCode=e.status==='Unknown'?5:3;}
}
else if(action==='stop')await stopDesktop(target);
else if(action==='schema')console.log(JSON.stringify(await readJSON(new URL('../runner/contracts/desktop-schema.json',import.meta.url)),null,2));
else throw new Error('Usage: schema | start --plan PLAN.json | start SOURCE.app [COCOA_PLUGIN] | resume SESSION.json | tool SESSION.json operation JSON | batch-check SESSION.json STEPS.json | batch SESSION.json STEPS.json | tools SESSION.json (JSON lines on stdin) | call SESSION.json operation JSON | native SESSION.json operation JSON | stop SESSION.json');
