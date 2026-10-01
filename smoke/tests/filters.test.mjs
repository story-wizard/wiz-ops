import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFile} from 'node:fs/promises';
import {matchesFilter,filterValues} from '../public/filters.js';
test('multi filters use OR within a field, AND across fields, and retain report choices in its link',async()=>{
 const rows=[{area:'Color',status:'Pass'},{area:'Audio',status:'Fail'},{area:'Timeline',status:'Pass'}];
 assert.deepEqual(rows.filter(r=>matchesFilter(r.area,['Color','Audio'])&&matchesFilter(r.status,['Pass'])),[rows[0]]);
 assert.ok(rows.every(r=>matchesFilter(r.area,[])));assert.deepEqual(filterValues(['Color',null,'']),['Color']);
 const source=(await readFile(new URL('../public/filters.js',import.meta.url),'utf8')).replace(/^export /gm,''),storage=new Map(),location={hash:'#check=P-COLOR',replace(v){this.hash=v;}};
 const context={URLSearchParams,location,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}};runInNewContext(source,context);
 const view={area:['Color','Audio'],search:'gain'};assert.ok(context.rememberFilters('guide',view));assert.equal(JSON.stringify(context.readFilterStore('guide').last),JSON.stringify(view));
 assert.ok(context.rememberFilters('report',view));assert.equal(new URLSearchParams(location.hash.slice(1)).get('check'),'P-COLOR');assert.equal(JSON.stringify(context.readFilterStore('report').last),JSON.stringify(view));
 storage.set('athanor-filters:guide','broken');assert.equal(Object.keys(context.readFilterStore('guide').last).length,0);
});

test('saved report presets work in a sandbox without form submission or localStorage',async()=>{
 const source=(await readFile(new URL('../public/filters.js',import.meta.url),'utf8')).replace(/^export /gm,'');
 const elements=[];
 function element(tag){const e={tagName:tag.toUpperCase(),children:[],events:{},value:'',append(...c){this.children.push(...c);},replaceChildren(...c){this.children=c;},setAttribute(){},addEventListener(k,fn){this.events[k]=fn;},focus(){},querySelector(){return null;},contains(){return false;}};elements.push(e);return e;}
 const host=element('div'),location={hash:'#check=COLOR',replace(v){this.hash=v;}},context={URLSearchParams,location,Option:function(label,value){return {label,value};},document:{createElement(tag){assert.notEqual(tag,'form','Report sandbox must not require form submission');return element(tag);},addEventListener(){},querySelectorAll(){return [];}}};
 runInNewContext(source,context);let restored;
 context.savedFilters(host,'report',()=>({area:['Colour','Audio']}),v=>restored=v);
 const input=elements.find(e=>e.tagName==='INPUT'),save=elements.find(e=>e.tagName==='BUTTON'&&e.textContent==='Save'),picker=elements.find(e=>e.tagName==='SELECT'),remove=elements.find(e=>e.textContent==='Delete');
 input.value='Color review';save.events.click({preventDefault(){}});
 assert.equal(context.readFilterStore('report').presets[0].name,'Color review');assert.equal(picker.value,'Color review');assert.equal(new URLSearchParams(location.hash.slice(1)).get('check'),'COLOR');
 picker.events.change();assert.equal(JSON.stringify(restored),JSON.stringify({area:['Colour','Audio']}));
 remove.events.click();assert.equal(context.readFilterStore('report').presets.length,0);assert.equal(remove.disabled,true);
});
