const filterNames=new Map();
// Empty selections mean all values; choices within a filter are ORed.
export const filterValues=value=>(Array.isArray(value)?value:[value]).filter(v=>typeof v==='string'&&v);
export const matchesFilter=(value,selection)=>!filterValues(selection).length||filterValues(selection).includes(value);
export const selectedValues=select=>[...select.selectedOptions].map(o=>o.value).filter(Boolean);

export function enhanceFilters(root=document,openKeys=[]){
 for(const select of root.querySelectorAll('select[multiple]')){
  if(select.dataset.enhanced){select.syncFilterUI();continue;}
  select.dataset.enhanced='true';
  const key=select.id||select.dataset.filter,host=select.parentElement;
  const label=select.getAttribute('aria-label')||[...host.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ')||'Filter';
  if(host.tagName==='LABEL'){
   const field=document.createElement('div');field.className='multi-select-field '+host.className;
   const caption=document.createElement('span');caption.textContent=label;field.append(caption);host.replaceWith(field);field.append(select);
  }
  const box=document.createElement('details');box.className='multi-select';box.dataset.filterControl=key;
  const summary=document.createElement('summary');summary.setAttribute('aria-label',label);summary.id='filter-'+key;
  const menu=document.createElement('div');menu.className='multi-select-options';
  const clear=document.createElement('button');clear.type='button';clear.textContent='Clear selection';menu.append(clear);
  select.before(box);box.append(summary,menu,select);select.hidden=true;
  const choices=[];
  for(const option of select.options){
   if(!option.value)continue;
   const row=document.createElement('label'),check=document.createElement('input'),text=document.createElement('span');
   check.type='checkbox';check.value=option.value;check.checked=option.selected;check.id='choice-'+key+'-'+choices.length;text.textContent=option.textContent;
   row.append(check,text);menu.append(row);choices.push([option,check]);
   check.addEventListener('change',()=>{option.selected=check.checked;for(const o of select.options)if(!o.value)o.selected=false;sync();select.dispatchEvent(new Event('change',{bubbles:true}));});
  }
  function sync(){const chosen=selectedValues(select);summary.textContent=chosen.length>1?chosen.length+' selected':chosen.length?choices.find(([o])=>o.value===chosen[0])[0].textContent:[...select.options].find(o=>!o.value)?.textContent||'All values';for(const [o,c]of choices)c.checked=o.selected;}
  clear.addEventListener('click',()=>{for(const o of select.options)o.selected=false;sync();select.dispatchEvent(new Event('change',{bubbles:true}));});
  select.addEventListener('change',sync);box.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();box.open=false;summary.focus();}});
  select.syncFilterUI=sync;sync();box.open=openKeys.includes(key);
 }
}

// UI preferences are browser-local. Sandboxed reports retain views in their URL fragment.
export function readFilterStore(key){
 try{const raw=key==='report'?new URLSearchParams(location.hash.slice(1)).get('filters'):localStorage.getItem('athanor-filters:'+key);const value=JSON.parse(raw||'{}');return {last:value?.last&&typeof value.last==='object'?value.last:{},presets:Array.isArray(value?.presets)?value.presets.filter(p=>typeof p?.name==='string'&&p.view&&typeof p.view==='object').slice(0,30):[]};}catch{return {last:{},presets:[]};}
}
function writeFilterStore(key,value){
 try{if(key==='report'){const hash=new URLSearchParams(location.hash.slice(1));hash.set('filters',JSON.stringify(value));location.replace('#'+hash);}else localStorage.setItem('athanor-filters:'+key,JSON.stringify(value));return true;}catch{return false;}
}
export function rememberFilters(key,view){const store=readFilterStore(key);store.last=view;return writeFilterStore(key,store);}
export function restoreControls(view,ids){
 for(const id of ids){const field=document.getElementById(id),value=view[id];if(value===undefined)continue;if(field.multiple){const choices=filterValues(value);for(const option of field.options)option.selected=choices.includes(option.value);}else if(field.type==='checkbox')field.checked=value===true;else if(field.tagName!=='SELECT'||[...field.options].some(o=>o.value===value))field.value=typeof value==='string'?value:'';}
}
export function controlSnapshot(ids){return Object.fromEntries(ids.map(id=>{const f=document.getElementById(id);return [id,f.multiple?selectedValues(f):f.type==='checkbox'?f.checked:f.value];}));}
export function savedFilters(host,key,getView,applyView){
 if(!host)return;const existing=host.querySelector('.filter-presets');if(existing){existing.syncPresets();return;}
 const bar=document.createElement('div');bar.className='filter-presets';
 const picker=document.createElement('select');picker.setAttribute('aria-label','Saved filters');
 const save=document.createElement('details');save.className='filter-save';const trigger=document.createElement('summary');trigger.textContent='Save filters';
 const form=document.createElement('div'),label=document.createElement('label'),input=document.createElement('input'),submit=document.createElement('button');form.className='filter-save-form';
 label.textContent='Filter name';input.required=true;input.maxLength=80;input.placeholder='e.g. Color checks';input.id='preset-name-'+key;input.value=filterNames.get(key)||'';input.addEventListener('input',()=>filterNames.set(key,input.value));label.append(input);submit.type='button';submit.textContent='Save';form.append(label,submit);save.append(trigger,form);
 const remove=document.createElement('button');remove.type='button';remove.textContent='Delete';remove.setAttribute('aria-label','Delete saved filter');remove.disabled=true;
 const status=document.createElement('span');status.className='filter-save-status';status.setAttribute('role','status');bar.append(picker,save,remove,status);host.append(bar);
 function fill(name=''){const store=readFilterStore(key);picker.replaceChildren(new Option('Saved filters…',''));for(const p of store.presets)picker.append(new Option(p.name,p.name));picker.value=name||store.presets.find(p=>JSON.stringify(p.view)===JSON.stringify(getView()))?.name||'';remove.disabled=!picker.value;}
 picker.addEventListener('change',()=>{const preset=readFilterStore(key).presets.find(p=>p.name===picker.value);remove.disabled=!preset;if(preset)applyView(preset.view);});
 submit.addEventListener('click',e=>{e.preventDefault();const name=input.value.trim();if(!name)return;const store=readFilterStore(key),view=getView();store.presets=store.presets.filter(p=>p.name!==name);store.presets.push({name,view});store.presets=store.presets.slice(-30);store.last=view;if(writeFilterStore(key,store)){fill(name);save.open=false;status.textContent='Saved';}else status.textContent='Browser storage is unavailable';});
 remove.addEventListener('click',()=>{const store=readFilterStore(key);store.presets=store.presets.filter(p=>p.name!==picker.value);if(writeFilterStore(key,store)){fill();status.textContent='Deleted';}else status.textContent='Browser storage is unavailable';});
 input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submit.click();}});save.addEventListener('toggle',()=>{if(save.open)input.focus();});bar.syncPresets=()=>fill();fill();
}

if(typeof document!=='undefined'&&document.addEventListener)document.addEventListener('click',e=>{for(const popup of document.querySelectorAll('.multi-select[open],.filter-save[open]'))if(!popup.contains(e.target))popup.open=false;});
