import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {sourceProvenance} from './source-provenance.mjs';
import {digest} from './files.mjs';

// ponytail: one verified persistence pair; add mappings only when a real caller boundary needs them.
const mapping=[{role:'core',cmake:'c++/wiz-timeline/CMakeLists.txt',source:'c++/wiz-timeline/tests/test_api_contracts.cpp',target:'wiz_timeline_api_contracts_tests'},
 {role:'app',cmake:'CMakeLists.txt',source:'tests/test_project_manager_reconcile.cpp',target:'wizard_project_manager_reconcile_tests'}];
export async function callerPreflight({app,core,appBuild,coreBuild,reviewedApp,reviewedCore}){
 const roots={app:await realpath(app),core:await realpath(core)},identities={app:await sourceProvenance(roots.app,{reviewedCommit:reviewedApp}),core:await sourceProvenance(roots.core,{reviewedCommit:reviewedCore})},tests=[],gaps=[];
 for(const item of mapping){
  const [cmake,source]=await Promise.all([readFile(path.join(roots[item.role],item.cmake),'utf8'),readFile(path.join(roots[item.role],item.source),'utf8')]);
  if(!new RegExp('^[ \\t]*add_test\\([ \\t]*NAME[ \\t]+'+item.target+'(?:\\s|\\))','m').test(cmake)||!cmake.includes(item.source.split('/').slice(-2).join('/')))gaps.push(item.role+': reviewed test registration changed; inspect the mapping');
  const supplied=item.role==='app'?appBuild:coreBuild,build=supplied?await realpath(supplied):'/absolute/'+item.role+'-build';
  if(supplied){
   const cache=await readFile(path.join(build,'CMakeCache.txt'),'utf8'),home=cache.match(/^CMAKE_HOME_DIRECTORY:[^=]+=(.*)$/m)?.[1],expected=item.role==='core'?path.join(roots.core,'c++'):roots.app;
   if(!home||await realpath(home)!==expected)gaps.push(item.role+': build directory belongs to a different source checkout');
   if(item.role==='app'){const linked=cache.match(/^WIZARD_CORE_CPP_DIR:[^=]+=(.*)$/m)?.[1];if(!linked||await realpath(linked)!==path.join(roots.core,'c++'))gaps.push('app: configured Core checkout does not match the requested Core');}
  }
  tests.push({...item,sourceHash:digest(source),registrationHash:digest(cmake),buildDirectoryVerified:Boolean(supplied),commands:{build:['cmake','--build',build,'--target',item.target],test:['ctest','--test-dir',build,'--output-on-failure','--no-tests=error','--timeout','120','-R','^'+item.target+'$']}});
 }
 return {format:'athanor-caller-preflight/v1',status:gaps.length?'Blocked':'Planned',executed:false,scope:'Core persistence contracts and the App ProjectManager caller',identities,tests,gaps,requiresBuildDirectories:!appBuild||!coreBuild,nextActions:gaps.length?['inspect_pair_and_mapping']:['review_commands','build_selected_targets','run_both_tests','retain_results'],authority:'Local test selection; does not establish current binaries, compatible pins, CI or packaged acceptance'};
}
