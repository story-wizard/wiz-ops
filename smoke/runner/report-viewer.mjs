import path from 'node:path';
import http from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile,readdir,realpath,lstat,rename,rm,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {externalPath,inside,digest,sha,readJSON,fingerprint} from './files.mjs';

const packageName=/^(athanor-job-[A-Za-z0-9-]{1,120}|smoke-report-[a-f0-9-]{36}-[a-f0-9]{12}|investigation-[a-f0-9-]{36}-[a-f0-9]{12})$/;
const safeFile=/\.(html|json|jsonl|txt|md|png|jpg|jpeg|gif|mp4|mov|webm|wav|mp3|m4a)$/;
export function publicationConfig(config){
 if(!config||Object.keys(config).some(k=>!['directory','baseUrl'].includes(k)))throw Error('Use a reviewed report directory and exact viewer base URL.');
 const directory=externalPath(config.directory),url=new URL(config.baseUrl);
 if(url.username||url.password||url.pathname!=='/'||url.hash||url.search||url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('Report base URL must use HTTPS, or HTTP on loopback for local acceptance.');
 return {directory,baseUrl:url.href};
}
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function verifyPublishedURL(publication){
 const response=await fetch(publication.url,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok||response.headers.get('x-athanor-publication')!==publication.id)throw Error('Configured viewer cannot serve the exact retained publication. Local evidence remains available.');
}
export async function publishJob(dataDir,job,config,{probe=verifyPublishedURL}={}){
 const {directory,baseUrl}=publicationConfig(config),exportsRoot=await realpath(path.join(externalPath(dataDir),'exports'));
 if(directory===exportsRoot||inside(exportsRoot,directory)||inside(directory,exportsRoot))throw Error('Publish to a separate report directory, outside the private worker workspace.');
 const report=await readJSON(path.join(job.report.path,'report.json'));if(digest(report)!==job.report.reportHash)throw Error('Job report changed before publication.');
 if(await realpath(job.report.path)!==await realpath(path.join(exportsRoot,job.report.url.split('/')[2])))throw Error('Job report path does not match its export identity.');
 const selected=new Map(),htmlProofs=new Map();
 async function add(url,htmlHash){
  const parts=(url||'').split('/');if(parts.length!==4||parts[1]!=='exports'||!packageName.test(parts[2])||parts[3]!=='index.html')throw Error('Publication needs a retained export URL.');
  const name=parts[2];if(selected.has(name))return;
  const root=await realpath(path.join(exportsRoot,name));if(path.dirname(root)!==exportsRoot)throw Error('Export directory escaped its workspace.');
  selected.set(name,root);if(name.startsWith('athanor-job-')){if(!/^[a-f0-9]{64}$/.test(htmlHash||''))throw Error('Job HTML needs its retained byte hash before shared publication.');htmlProofs.set(name,htmlHash);}const record=await readJSON(path.join(root,'report.json')).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
  if(record?.catalogReport)await add(record.catalogReport.url);
  for(const stage of record?.courseStages||[])if(stage.report)await add(stage.report.url,stage.report.htmlHash);
  // Only exported investigations are shared. Live dashboards and APIs stay private.
  const brief=await readJSON(path.join(root,'agent-brief.json')).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
  if(brief?.reports?.investigation?.package)await add(brief.reports.investigation.package.url);
 }
 await add(job.report.url,job.report.htmlHash);await mkdir(directory,{recursive:true,mode:0o700});
 const staging=await mkdtemp(path.join(directory,'.publish-'));
 try{
  for(const [name,root] of selected){
   const inventory=await fingerprint(root);
   const record=await readJSON(path.join(root,'report.json')).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
   const html=await readFile(path.join(root,'index.html'),'utf8');if(name.startsWith('smoke-report-')&&!name.endsWith(digest({report:record,html}).slice(0,12))||htmlProofs.has(name)&&htmlProofs.get(name)!==digest(html))throw Error('Report HTML changed before publication.');
   for(const proof of record?.artifacts||[]){const file=path.join(root,'evidence',proof.file);if(path.basename(proof.file)!==proof.file||!inside(root,await realpath(file))||(await lstat(file)).size!==proof.bytes||await sha(file)!==proof.sha256)throw Error('Evidence changed before publication.');}
   const manifest=await readJSON(path.join(root,'manifest.json')).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
   if(manifest&&(digest(manifest.inventory)!==manifest.inventoryHash||!name.endsWith(digest(manifest).slice(0,12))))throw Error('Investigation export manifest changed.');
   for(const [relative,size,hash] of inventory.entries){
    if(relative.split(path.sep).includes('delivery'))continue;
    if(size==='symlink'||!safeFile.test(relative)||relative.split(path.sep).some(p=>p.startsWith('.')))throw Error('Unexpected or linked file in shared export: '+relative);
    if(manifest&&relative!=='manifest.json'&&!manifest.inventory.some(([f,s,h])=>f===relative&&s===size&&h===hash))throw Error('Investigation inventory does not declare this file.');
    // Agent commands contain private service paths and draft execution context.
    if(/^(AGENT-PROMPT\.txt|agent-brief\.json|investigation-task\.json|first-read\.json|triage-proposal\.json)$/.test(relative))continue;
    if(!manifest){const allowed=record?.artifacts?['index.html','report.json',...record.artifacts.map(a=>'evidence/'+a.file)]:['index.html','report.json','handoff.html'];if(!allowed.includes(relative))throw Error('Undeclared file in shared report: '+relative);}
    const source=await realpath(path.join(root,relative));if(!inside(root,source))throw Error('Publication source escaped its export.');
    const dest=path.join(staging,'exports',name,relative);await mkdir(path.dirname(dest),{recursive:true});await copyFile(source,dest);if(await sha(dest)!==hash||(await lstat(dest)).size!==size)throw Error('Source bytes changed during publication.');
    if(/\.(html|json|jsonl|txt|md)$/.test(relative)&&/(?<![A-Za-z0-9_-])(?:xox[baprs]-[A-Za-z0-9-]{10,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9_.-]{20,})/.test(await readFile(dest,'utf8')))throw Error('Potential credential in retained text; redact at collection and make a new reviewed export.');
    if(relative.endsWith('.html')){
     let html=await readFile(dest,'utf8');const packageURL=(await readJSON(path.join(root,'agent-brief.json')).catch(()=>null))?.reports?.investigation?.package?.url;
     if(relative==='handoff.html')html='<!doctype html><meta charset="utf-8"><title>Athanor investigation</title><style>body{background:#14191f;color:#d6e1eb;font:16px system-ui;margin:40px}a{color:#9bc6e5}</style><h1>Athanor investigation</h1><p><a href="index.html">Course report</a></p>'+(packageURL?'<p><a href="'+escape(packageURL)+'">Evidence and bug drafts</a></p>':'<p>Investigation package needs review on the worker.</p>');
     html=html.replace(/href="\/investigation\?[^\"]*"/g,packageURL?'href="'+escape(packageURL)+'"':'href="index.html"');
     await writeFile(dest,html);
    }
   }
  }
  const entries=(await fingerprint(staging)).entries,content={format:'athanor-publication/v1',jobId:job.id,build:report.identity.build,reportHash:job.report.reportHash,index:job.report.url,entries};
  const manifest={...content,id:digest(content)},name=job.id+'-'+manifest.id.slice(0,12);await writeFile(path.join(staging,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const target=path.join(directory,name);try{await rename(staging,target);}catch(e){if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;const old=await readJSON(path.join(target,'manifest.json'));if(digest(old)!==digest(manifest))throw Error('Existing publication differs; preserve it for review.');await rm(staging,{recursive:true});}
  const publication={state:'Published',id:manifest.id,path:target,url:new URL(name+job.report.url,baseUrl).href,jobId:job.id,reportHash:job.report.reportHash};await probe(publication);return publication;
 }catch(e){await rm(staging,{recursive:true,force:true});throw e;}
}
export async function readPublishedFile(directory,relative){
 const parts=relative.split('/');if(parts.length<2||parts.some(p=>!p||p==='.'||p==='..')||!/^[A-Za-z0-9-]{1,100}-[a-f0-9]{12}$/.test(parts[0]))throw Error('Invalid published path.');
 const parent=await realpath(externalPath(directory)),root=await realpath(path.join(parent,parts[0]));if(path.dirname(root)!==parent)throw Error('Publication escaped viewer root.');
 const manifest=await readJSON(path.join(root,'manifest.json')),{id,...content}=manifest;if(id!==digest(content)||parts[0]!==manifest.jobId+'-'+id.slice(0,12))throw Error('Publication manifest changed.');
 const member=manifest.entries.find(([f])=>f===parts.slice(1).join('/'));if(!member)throw Error('File is not declared by publication.');
 const file=await realpath(path.join(root,member[0]));if(!inside(root,file))throw Error('Published file escaped inventory.');
 const bytes=await readFile(file);if(bytes.length!==member[1]||await sha(file)!==member[2])throw Error('Published proof bytes changed.');return bytes;
}
export function createReportViewer(directory,{host='127.0.0.1'}={}){
 directory=externalPath(directory);
 return http.createServer(async(req,res)=>{
  const fail=code=>{res.writeHead(code,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end(code===405?'Read-only report viewer':'Report not available');};
  if(req.headers.host!==host+':'+res.socket.localPort)return fail(403);
  if(!['GET','HEAD'].includes(req.method))return fail(405);
  try{
   const raw=req.url.split('?')[0],relative=decodeURIComponent(raw.slice(1));
   // Export pages keep root-relative links. Resolve them only inside their referring publication.
   let file=relative;
   if(relative.startsWith('exports/')){const ref=new URL(req.headers.referer||'');if(ref.host!==req.headers.host)throw Error('Foreign publication');file=ref.pathname.split('/')[1]+'/'+relative;}
   let bytes;
   if(!relative){
    const rows=[];for(const name of (await readdir(directory)).filter(n=>/^[A-Za-z0-9-]+-[a-f0-9]{12}$/.test(n))){const manifest=await readJSON(path.join(directory,name,'manifest.json'));await readPublishedFile(directory,name+manifest.index);rows.push('<li><a href="/'+escape(name+manifest.index)+'">'+escape(manifest.build)+' · '+escape(manifest.jobId)+'</a></li>');}
    bytes=Buffer.from('<!doctype html><meta charset="utf-8"><title>Athanor reports</title><style>body{background:#14191f;color:#d6e1eb;font:16px system-ui;margin:40px}a{color:#9bc6e5}</style><h1>Athanor reports</h1><ul>'+rows.join('')+'</ul>');
   }else bytes=await readPublishedFile(directory,file);
   const ext=path.extname(file),html=!relative||ext==='.html',scripts=html?[...bytes.toString().matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>"'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'").join(' '):'';
   const type=html?'text/html; charset=utf-8':({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.wav':'audio/wav','.mp3':'audio/mpeg','.m4a':'audio/mp4','.json':'application/json'})[ext]||'text/plain; charset=utf-8';
   const publication=relative?(await readJSON(path.join(directory,file.split('/')[0],'manifest.json'))).id:null;
   let status=200,rangeHeaders={};if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match||!match[1]&&!match[2])return fail(416);let start=match[1]?Number(match[1]):Math.max(0,bytes.length-Number(match[2])),end=match[2]&&match[1]?Number(match[2]):bytes.length-1;end=Math.min(end,bytes.length-1);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=bytes.length)return fail(416);rangeHeaders={'Content-Range':`bytes ${start}-${end}/${bytes.length}`};bytes=bytes.subarray(start,end+1);status=206;}
   res.writeHead(status,{...rangeHeaders,'Accept-Ranges':'bytes','Content-Length':bytes.length,...(publication?{'X-Athanor-Publication':publication}:{}),'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; img-src 'self' data:; media-src 'self'; script-src "+(scripts||"'none'")+"; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-popups"});res.end(req.method==='HEAD'?undefined:bytes);
  }catch{fail(404);}
 });
}

// Tailscale encrypts transport; bind only its exact IPv4, never the LAN or all interfaces.
export function createReportProxy({host,viewerPort}){
 const parts=String(host).split('.');
 if(parts.length!==4||parts.some(p=>!/^\d{1,3}$/.test(p)||Number(p)>255||String(Number(p))!==p)||parts[0]!=='100'||Number(parts[1])<64||Number(parts[1])>127||!Number.isInteger(viewerPort)||viewerPort<1||viewerPort>65535)throw Error('Use an exact Tailscale IPv4 and loopback viewer port.');
 return http.createServer((req,res)=>{
  const authority=host+':'+res.socket.localPort,fail=code=>{res.writeHead(code,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('Report not available');};
  if(req.headers.host!==authority)return fail(403);
  if(!['GET','HEAD'].includes(req.method))return fail(405);
  if(!req.url.startsWith('/')||req.url.startsWith('//'))return fail(400);
  const headers={Host:'127.0.0.1:'+viewerPort};
  if(req.headers.range)headers.Range=req.headers.range;
  if(req.headers.referer){
   try{const ref=new URL(req.headers.referer);if(ref.origin!=='http://'+authority||ref.username||ref.password)return fail(403);headers.Referer='http://127.0.0.1:'+viewerPort+ref.pathname+ref.search;}catch{return fail(403);}
  }
  const upstream=http.request({host:'127.0.0.1',port:viewerPort,path:req.url,method:req.method,headers},response=>{res.writeHead(response.statusCode,response.headers);response.on('error',()=>res.destroy());response.pipe(res);});
  upstream.setTimeout(15000,()=>upstream.destroy(Error('Viewer timed out')));
  upstream.on('error',()=>{if(!res.headersSent)fail(502);else res.destroy();});
  res.on('close',()=>upstream.destroy());upstream.end();
 });
}
