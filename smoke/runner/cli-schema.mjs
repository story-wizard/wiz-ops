import {execFileSync} from 'node:child_process';

// Operation-scoped schemas are not registries. Discovery never starts Wizard.
export function readCliSchema(cli,{env=process.env}={}){
 const options={encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024,env,stdio:['ignore','pipe','pipe']};
 let schema,legacy=false;
 try{schema=JSON.parse(execFileSync(cli,['project','--schema','--no-spawn'],options));}
 catch(error){
  const unsupported=Number.isInteger(error.status)&&error.status!==0&&/((missing|required|expected).*(subcommand|operation)|(unknown|unrecognized|invalid).*(command|option))/i.test(String(error.stderr||''));
  if(!unsupported)throw error;
  legacy=true;
 }
 if(!legacy&&(!schema||!schema.operations||typeof schema.operations!=='object'||Array.isArray(schema.operations)))throw Error('Invalid CLI registry schema.');
 if(legacy||Object.keys(schema.operations).length===1&&schema.operations['project.create'])schema=JSON.parse(execFileSync(cli,['project','create','--schema','--no-spawn'],options));
 for(const op of ['project.create','project.get_name','timeline.inspect'])if(!schema?.operations?.[op]||typeof schema.operations[op]!=='object')throw Error('CLI did not return a full operation registry: missing '+op);
 return schema;
}
