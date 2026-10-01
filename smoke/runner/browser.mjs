import path from 'node:path';
import {stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readJSON,writeJSON} from './files.mjs';

const execute=promisify(execFile);
async function chooseBrowser(){
 if(process.platform!=='darwin')throw Error('Use --browser default to open your system browser, or --no-open to print the dashboard address.');
 const {stdout}=await execute('/usr/bin/osascript',['-e',`set choice to choose from list {"System default", "Safari", "Choose another browser…"} with title "Open Athanor" with prompt "Which browser should Smoke use? Your choice will be remembered for this workspace." default items {"System default"}
if choice is false then return ""
set selected to item 1 of choice
if selected is "System default" then return "default"
if selected is "Safari" then return "/Applications/Safari.app"
try
 return POSIX path of (choose file with prompt "Choose your browser application" of type {"com.apple.application-bundle"} default location (POSIX file "/Applications"))
on error number -128
 return ""
end try`]);
 return stdout.trim().replace(/\/$/,'');
}

export async function openDashboard(url,data,{browser,prompt=chooseBrowser,launch=execute}={}){
 const address=new URL(url);
 if(address.protocol!=='http:'||address.hostname!=='127.0.0.1'||!address.port||address.username||address.password||address.pathname!=='/'||address.search||address.hash)throw Error('Expected a local dashboard address.');
 const file=path.join(data,'browser.json');
 if(browser===undefined){try{browser=(await readJSON(file)).browser;}catch(e){if(e.code!=='ENOENT')throw Error('Browser preference could not be read. Use --browser choose to replace it.');}}
 if(browser===undefined||browser==='choose')browser=await prompt();
 if(!browser)return {opened:false,cancelled:true};
 if(browser!=='default'&&(!path.isAbsolute(browser)||path.extname(browser)!=='.app'||!(await stat(browser)).isDirectory()))throw Error('Choose an installed browser .app or use --browser default.');
 await launch('/usr/bin/open',browser==='default'?[url]:['-a',browser,url]);
 await writeJSON(file,{browser});
 return {opened:true,browser};
}
