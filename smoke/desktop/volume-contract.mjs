// Expand the frozen repetition count into explicit action/checkpoint identities.
export function volumeContract(definition){
 const p=definition?.proof;
 if(p?.oracle!=='volume-v1')return p;
 const checkpoints=[],actions=[];
 const point=(id,keys,target,extra={})=>{
  const ids=keys.map((key,i)=>id+'-'+(i+1));
  checkpoints.push({id,actions:ids,capture:'widget',...extra});
  keys.forEach((key,i)=>actions.push({id:ids[i],checkpoint:id,stepId:id.split('-')[0],command:'key',key,target,...extra}));
 };
 if(definition.id==='D-HISTORY-50'){
  if(p.repetitions!==50)throw Error('History contract requires fifty steps per phase');
  for(const [phase,key,frames] of [['edit','period',Array.from({length:50},(_,i)=>i+1)],['undo','cmd+z',Array.from({length:50},(_,i)=>49-i)],['redo','cmd+shift+z',Array.from({length:50},(_,i)=>i+1)]])
   frames.forEach((frame,i)=>point(phase+'-'+(i+1),[key],{class:'TimelineWidget'},{frame}));
 }else if(definition.id==='D-SEARCH-EMPTY'){
  for(const id of ['positive','missing','restore']){
   const ids=['click','select','type','submit'].map(k=>id+'-'+k);
   checkpoints.push({id,actions:ids,capture:'widget'});
   for(const [i,command,key] of [[0,'click'],[1,'key','cmd+a'],[2,'type'],[3,'key','Return']])
    actions.push({id:ids[i],checkpoint:id,stepId:id,command,key,target:{class:'MediaSearchField'},surface:'search',text:i===2?(id==='missing'?'@missing':'pattern_24'):undefined});
  }
 }else if(definition.id==='D-CLIPBOARD-LARGE'){
  point('copied',['cmd+a','cmd+c'],{class:'TimelineWidget'},{stepId:'copy'});
  checkpoints.push({id:'destination',actions:['destination-click','destination-open'],capture:'widget'});
  actions.push({id:'destination-click',checkpoint:'destination',stepId:'paste',command:'click',target:{class:'QWidget'},surface:'bin'},
   {id:'destination-open',checkpoint:'destination',stepId:'paste',command:'click',clickCount:2,target:{class:'QWidget'},surface:'bin'});
  checkpoints.push({id:'pasted',actions:['destination-focus','paste'],capture:'widget'});
  actions.push({id:'destination-focus',checkpoint:'pasted',stepId:'paste',command:'click',target:{class:'TimelineWidget'},timeline:'destination'},
   {id:'paste',checkpoint:'pasted',stepId:'paste',command:'key',key:'cmd+v',target:{class:'TimelineWidget'},timeline:'destination'});
  point('undone',['cmd+z'],{class:'TimelineWidget'},{stepId:'history',timeline:'destination'});point('redone',['cmd+shift+z'],{class:'TimelineWidget'},{stepId:'history',timeline:'destination'});
 }else throw Error('Unknown volume contract');
 return {...p,version:1,readOperation:'timeline.inspect',checkpoints,actions};
}
