import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rename,unlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {extendedCases} from '../runner/extended-checks.mjs';
import {ProjectSession} from '../runner/interactions.mjs';

// Filesystem-backed boundary double; this qualifies the harness oracle, not Wizard.
async function exercise(pathIdentity,fault,{existing=false}={}){
 const root=await mkdtemp(path.join(tmpdir(),'athanor-documents-'));
 try{
  let documents=[],saved=[],next=0;
  const engine={root,schema:{operations:{'documents.rename':{properties:{name:{description:fault==='unknown-contract'?'Unreviewed rename meaning':pathIdentity?'New document filename stem (moves the file and changes its path and identity)':'New document name (user-facing only; the file path is stable)'}}}}},async call(bundle,op,p={}){
   assert.notEqual(fault,'unknown-contract','Unknown semantics must reject before any mutation');
   if(op==='project.create'){await mkdir(path.join(bundle,'documents'),{recursive:true});if(existing){const relative_path='documents/story.md';documents.push({document_id:pathIdentity?relative_path:'story',relative_path,name:'story'});await writeFile(path.join(bundle,relative_path),'Existing story');}return {};}
   if(op==='project.checkpoint'){saved=structuredClone(documents);return {};}
   if(op==='project.close'){documents=[];return {};}
   if(op==='project.open'){documents=structuredClone(saved);return {};}
   if(op==='documents.create'||op==='documents.import'){
    const relative_path=`documents/${pathIdentity?p.name:++next}.md`,doc={document_id:pathIdentity?relative_path:`doc-${next}`,relative_path,name:p.name};
    await writeFile(path.join(bundle,relative_path),op==='documents.create'?p.markdown:await readFile(p.path));
    documents.push(doc);return structuredClone(doc);
   }
   if(op==='documents.rename'){
    const doc=documents.find(d=>d.document_id===p.document_id),old=doc.relative_path;doc.name=p.name;
    if(pathIdentity&&fault!=='stable-identity'){
     doc.relative_path=`documents/${p.name}.md`;
     if(fault!=='stale-id')doc.document_id=doc.relative_path;
     if(fault==='copied-not-moved')await writeFile(path.join(bundle,doc.relative_path),await readFile(path.join(bundle,old)));
     else await rename(path.join(bundle,old),path.join(bundle,doc.relative_path));
     if(fault==='changed-content')await writeFile(path.join(bundle,doc.relative_path),'wrong text');
    }
    return {};
   }
   if(op==='documents.delete'){
    const selected=documents.find(d=>d.document_id===p.document_id);
    if(fault!=='retained-deleted-file')await unlink(path.join(bundle,selected.relative_path));
    documents=documents.filter(d=>d!==selected);
    if(fault==='wrong-delete')documents=[];
    if(fault==='changed-existing')await writeFile(path.join(bundle,'documents/story.md'),'Wrong story');
    return {};
   }
   if(op==='documents.list')return {documents:structuredClone(documents)};
   throw Error('Unexpected operation '+op);
  }};
  const c=new ProjectSession(engine,'A-UI-04',{files:[]});
  await extendedCases['A-UI-04'](c);
  return JSON.parse(await readFile(path.join(path.dirname(c.bundle),'document-lifecycle.json')));
 }finally{await rm(root,{recursive:true,force:true});}
}

test('document lifecycle follows the selected stable-ID or path-ID contract and retains filesystem evidence',async()=>{
 for(const pathIdentity of [true,false]){
  const receipt=await exercise(pathIdentity);
  assert.equal(receipt.pathIdentity,pathIdentity);
  const renamed=receipt.afterReopen.documents.find(d=>d.name==='renamed-notes');
  assert.equal(renamed.document_id===receipt.created.document_id,!pathIdentity);
  assert.equal(renamed.relative_path===receipt.created.relative_path,!pathIdentity);
  assert.deepEqual(receipt.afterDelete.documents,[renamed]);
 }
});

test('document lifecycle preserves existing project documents and their bytes',async()=>{
 for(const pathIdentity of [true,false]){
  const receipt=await exercise(pathIdentity,undefined,{existing:true});
  assert.equal(receipt.afterReopen.documents.length,3);
  assert.equal(receipt.afterDelete.documents.length,2);
 }
 await assert.rejects(()=>exercise(true,'wrong-delete',{existing:true}),/wrong document/);
 await assert.rejects(()=>exercise(true,'changed-existing',{existing:true}),/Saved document contents/);
});

test('document lifecycle rejects stale identity, retained old files, content loss and incorrect deletion',async()=>{
 for(const [fault,message] of [
  ['stable-identity',/Renamed file path/],['stale-id',/old document identity/],
  ['copied-not-moved',/old document file/],['changed-content',/Saved document contents/],
  ['wrong-delete',/wrong document/],['retained-deleted-file',/Deleted document file/],
 ])await assert.rejects(()=>exercise(true,fault),message,fault);
 await assert.rejects(()=>exercise(true,'unknown-contract'),/Unreviewed document rename semantics/);
});
