import {callerPreflight} from '../runner/caller-preflight.mjs';
const flags={};
try{
 const args=process.argv.slice(2),allowed=['app','core','app-build','core-build','reviewed-app','reviewed-core'];
 for(let i=0;i<args.length;i++){const key=args[i].slice(2);if(!args[i].startsWith('--')||!allowed.includes(key)||Object.hasOwn(flags,key)||!args[i+1]||args[i+1].startsWith('--'))throw Error('Use --app DIR --core DIR with optional --app-build, --core-build and exact --reviewed-app/--reviewed-core hashes');flags[key]=args[++i];}
 if(!flags.app||!flags.core)throw Error('Supply the paired --app and --core source checkouts');
 const result=await callerPreflight({app:flags.app,core:flags.core,appBuild:flags['app-build'],coreBuild:flags['core-build'],reviewedApp:flags['reviewed-app'],reviewedCore:flags['reviewed-core']});console.log(JSON.stringify(result,null,2));if(result.status==='Blocked')process.exitCode=3;
}catch(error){console.error(JSON.stringify({format:'athanor-caller-preflight/v1',status:'Blocked',executed:false,error:error.message}));process.exitCode=3;}
