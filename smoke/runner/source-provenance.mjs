import {execFileSync} from 'node:child_process';
import {realpath} from 'node:fs/promises';

// Git identities describe committed source; the existing byte fingerprint describes the built snapshot.
export async function sourceProvenance(directory,{reviewedCommit}={}){
 const root=await realpath(directory),git=args=>execFileSync('/usr/bin/git',['-C',root,...args],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},stdio:['ignore','pipe','ignore']}).trim();
 if(reviewedCommit!==undefined&&!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(reviewedCommit))throw Error('Reviewed source must be an exact Git commit hash');
 let prefix,commit,tree,scopeTree,dirty;
 try{prefix=git(['rev-parse','--show-prefix']).replace(/\/$/,'');commit=git(['rev-parse','--verify','HEAD^{commit}']);tree=git(['rev-parse','--verify','HEAD^{tree}']);scopeTree=prefix?git(['rev-parse','--verify','HEAD:'+prefix]):tree;dirty=Boolean(git(['status','--porcelain','--untracked-files=all','--','.']));}
 catch(error){if(reviewedCommit!==undefined)throw Error('Cannot inspect the requested Git identity');return {format:'athanor-source-provenance/v1',available:false,reason:'Git identities unavailable; use the retained byte fingerprint'};}
 const result={format:'athanor-source-provenance/v1',available:true,commit,tree,scope:prefix||'.',scopeTree,dirty};
 if(reviewedCommit!==undefined){const reviewed={commit:git(['rev-parse','--verify',reviewedCommit+'^{commit}']),tree:git(['rev-parse','--verify',reviewedCommit+'^{tree}'])};reviewed.scopeTree=prefix?git(['rev-parse','--verify',reviewedCommit+':'+prefix]):reviewed.tree;result.reviewed=reviewed;result.comparison={sameCommit:commit===reviewed.commit,sameTree:tree===reviewed.tree,sameScopeTree:scopeTree===reviewed.scopeTree,clean:!dirty};}
 return result;
}
