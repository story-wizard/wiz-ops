import {assert,same,snapshotState} from '../runner/engine.mjs';

export function verifyNewProject(name,expected,snapshot,oldIds){
 assert(name.name===expected,'New Project has the wrong name');
 assert(!oldIds.includes(snapshot.timeline.timeline_id),'New Project reused an old timeline');
 assert(snapshot.timeline.duration_seconds===0&&snapshot.tracks.every(t=>t.items.length===0),'New Project inherited existing clips');
 snapshotState(snapshot);return {name:name.name,timelineId:snapshot.timeline.timeline_id,empty:true};
}
export function verifyProjectCopy(before,after){
 same(Object.keys(after).sort(),Object.keys(before).sort(),'Save As preserves timeline identities');
 for(const id of Object.keys(before))same(snapshotState(after[id]),snapshotState(before[id]),'Save As preserves '+id);
}
export function verifyProjectlessPreferences(ui,dialogId){
 const controls=ui.widgets.filter(w=>w.window===dialogId),nav=controls.filter(w=>w.name==='settingsNavigation');
 assert(nav.length===1&&Array.isArray(nav[0].model)&&nav[0].rows<=nav[0].model.length,'Preferences navigation is incomplete or ambiguous');
 const pages=nav[0].model.map(row=>row[0]);
 assert(controls.some(w=>w.text==='Application'),'Projectless Preferences lacks Application settings');
 assert(!controls.some(w=>w.text==='Current Project'||w.name==='projectNameEdit'||w.name==='projectPathEdit'),'Project settings are exposed without a project');
 for(const title of ['System','Interface','Audio'])assert(pages.includes(title),'Application page missing: '+title);
 for(const title of ['General','Color Management','Default Timeline Settings'])assert(!pages.includes(title),'Project page present without a project: '+title);
 return {pages,nav:nav[0]};
}
export function verifyProjectHub(ui){
 const main=ui.widgets.filter(w=>w.class==='MainWindow'),open=ui.widgets.filter(w=>w.name==='startupOpenButton');
 assert(main.length===1&&main[0].title==='Wizard'&&open.length===1&&open[0].enabled,'Projectless hub was not established');
 // Layout restoration can construct TimelineWidgets under the hub. Their
 // existence is not an open project; a project title and populated clips are.
 assert(!ui.widgets.some(w=>w.class==='TimelineWidget'&&(w.clipIds?.length||w.clipIdsTruncated)),'Projectless hub retained timeline content');
 return {window:main[0].id,openButton:open[0].id};
}
