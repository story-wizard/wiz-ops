import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {sourceProvenance} from '../runner/source-provenance.mjs';
import {callerPreflight} from '../runner/caller-preflight.mjs';

test('source provenance separates rewritten commit identity, unchanged trees and dirty work',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-provenance-'),git=args=>execFileSync('/usr/bin/git',['-C',root,...args],{encoding:'utf8'}).trim();
 try{
  git(['init','--quiet']);await mkdir(root+'/smoke');await writeFile(root+'/smoke/source','first');git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','first']);const first=await sourceProvenance(root+'/smoke');
  git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','rewritten identity']);const same=await sourceProvenance(root+'/smoke',{reviewedCommit:first.commit});assert.equal(same.comparison.sameCommit,false);assert.equal(same.comparison.sameTree,true);assert.equal(same.comparison.sameScopeTree,true);assert.equal(same.comparison.clean,true);
  await writeFile(root+'/smoke/source','changed');const dirty=await sourceProvenance(root+'/smoke',{reviewedCommit:first.commit});assert.equal(dirty.dirty,true);assert.equal(dirty.comparison.clean,false);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','changed tree']);const changed=await sourceProvenance(root+'/smoke',{reviewedCommit:first.commit});assert.equal(changed.comparison.sameTree,false);assert.equal(changed.comparison.sameScopeTree,false);
  await assert.rejects(()=>sourceProvenance(root,{reviewedCommit:'HEAD; echo bad'}),/exact Git commit hash/);const unrelated=root+'-ungit';await mkdir(unrelated);assert.equal((await sourceProvenance(unrelated)).available,false);await rm(unrelated,{recursive:true});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('caller preflight selects both sides without execution and rejects wrong builds or changed registrations',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-caller-preflight-'),app=root+'/app',core=root+'/core',appBuild=root+'/app-build',coreBuild=root+'/core-build';
 try{
  await mkdir(app+'/tests',{recursive:true});await mkdir(core+'/c++/wiz-timeline/tests',{recursive:true});await mkdir(appBuild);await mkdir(coreBuild);
  await writeFile(app+'/CMakeLists.txt','add_test(NAME wizard_project_manager_reconcile_tests COMMAND wizard_project_manager_reconcile_tests)\n# tests/test_project_manager_reconcile.cpp');await writeFile(app+'/tests/test_project_manager_reconcile.cpp','caller contract');
  await writeFile(core+'/c++/wiz-timeline/CMakeLists.txt','add_test(NAME wiz_timeline_api_contracts_tests COMMAND wiz_timeline_api_contracts_tests)\n# tests/test_api_contracts.cpp');await writeFile(core+'/c++/wiz-timeline/tests/test_api_contracts.cpp','provider contract');
  const planned=await callerPreflight({app,core});assert.equal(planned.status,'Planned');assert.equal(planned.executed,false);assert.equal(planned.tests.length,2);assert.equal(planned.requiresBuildDirectories,true);assert(planned.tests.every(t=>t.commands.test.includes('--no-tests=error')));
  await writeFile(appBuild+'/CMakeCache.txt','CMAKE_HOME_DIRECTORY:INTERNAL='+app+'\nWIZARD_CORE_CPP_DIR:PATH='+core+'/c++\n');await writeFile(coreBuild+'/CMakeCache.txt','CMAKE_HOME_DIRECTORY:INTERNAL='+core+'/c++\n');assert.equal((await callerPreflight({app,core,appBuild,coreBuild})).status,'Planned');
  await writeFile(appBuild+'/CMakeCache.txt','CMAKE_HOME_DIRECTORY:INTERNAL='+core+'\nWIZARD_CORE_CPP_DIR:PATH='+app+'\n');const blocked=await callerPreflight({app,core,appBuild,coreBuild});assert.equal(blocked.status,'Blocked');assert.equal(blocked.gaps.length,2);assert.equal(blocked.executed,false);
  await writeFile(app+'/CMakeLists.txt','# deleted target');assert.equal((await callerPreflight({app,core})).status,'Blocked');assert.equal(await readFile(core+'/c++/wiz-timeline/tests/test_api_contracts.cpp','utf8'),'provider contract');
 }finally{await rm(root,{recursive:true,force:true});}
});
