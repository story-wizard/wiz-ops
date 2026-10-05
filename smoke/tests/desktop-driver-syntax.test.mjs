import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
test('desktop drivers and shared helpers parse before any application is launched',()=>{
 const directory=new URL('../desktop/',import.meta.url);
 for(const name of readdirSync(directory).filter(n=>n.endsWith('.mjs')))execFileSync(process.execPath,['--check',fileURLToPath(new URL(name,directory))],{encoding:'utf8',timeout:5000});
});
