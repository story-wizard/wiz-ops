import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {validateToolParams,validateNativeParams} from '../desktop/agent-proof.mjs';
import {selectUI} from '../desktop/agent-tools.mjs';
import {agentReadNative} from '../desktop/adapter.mjs';

test('model pages admit bounded read requests and reject malformed bounds before dispatch',()=>{
 const cursor={modelIdentity:'model',revision:3,root:[0]};
 validateToolParams('model',{cursor});validateNativeParams('model-page',{cursor});validateToolParams('reveal',{offset:100,cursor});
 for(const bad of [{...cursor,revision:-1},{...cursor,revision:1.5},{...cursor,root:['row']},{...cursor,modelIdentity:''},{...cursor,extra:1}])assert.throws(()=>validateToolParams('model',{cursor:bad}));
 validateToolParams('observe',{scope:'panel'});assert.throws(()=>validateToolParams('observe',{scope:{id:'panel'}}));
 for(const params of [{},{offset:0,limit:64},{offset:2147483647,limit:1}]){
  validateToolParams('model',params);validateNativeParams('model-page',params);
 }
 for(const params of [{offset:null},{limit:null},{offset:-1},{offset:1.5},{offset:'1'},{offset:2147483648},{limit:0},{limit:65},{limit:1.5},{limit:'32'}]){
  assert.throws(()=>validateToolParams('model',params),e=>e.code==='invalid_model_page');
  assert.throws(()=>validateNativeParams('model-page',params),e=>e.code==='invalid_model_page');
 }
 assert.ok(agentReadNative.includes('model-page'));
 assert.ok(agentReadNative.includes('model-value'));
 validateNativeParams('resize-window',{target:'window',width:800,height:600});
 for(const size of [{width:199,height:600},{width:800,height:4097},{width:800.5,height:600},{width:800,height:600,other:true}])assert.throws(()=>validateNativeParams('resize-window',{target:'window',...size}));
 validateToolParams('model_value',{offset:1,column:9,role:0,cursor});validateNativeParams('model-value',{offset:1,column:9,role:0,cursor});
 for(const bad of [{column:64,role:0},{column:0,role:1281},{column:-1,role:0},{column:0,role:1.2}])assert.throws(()=>validateToolParams('model_value',bad));
 const complete=selectUI({widgets:[{id:'timeline',clipIds:['clip-a'],clipIdsTruncated:false}]});
 assert.deepEqual(complete.matches[0].clipIds,['clip-a']);assert.equal(complete.inspectionIncomplete,false);
 assert.equal(selectUI({widgets:[{id:'timeline',clipIds:[],clipIdsTruncated:true}]},{selector:{id:'absent'}}).inspectionIncomplete,true);
});

test('the native pager reads all rows in the current view root and refuses invalid targets',{skip:process.platform!=='darwin'||spawnSync('pkg-config',['--exists','Qt6Widgets']).status!==0},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-model-page-'));
 try{
  const source=await readFile(new URL('../desktop/native/bridge.cpp',import.meta.url),'utf8');
  const start=source.indexOf('    QJsonObject modelPage('),end=source.indexOf('    QJsonObject inspect(',start);
  assert.ok(start>=0&&end>start);
  const probe=path.join(root,'probe.cpp'),binary=path.join(root,'probe');
  await writeFile(probe,`#include <QtWidgets>
#include <iostream>
#include <stdexcept>
QString id(QObject* o){return o->objectName();}
${source.slice(start,end)}
void require(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
int main(int argc,char** argv){
 QApplication app(argc,argv);QStandardItemModel model;model.setObjectName("model");
 auto* parent=new QStandardItem("parent");model.appendRow(parent);
 for(int r=0;r<201;r++)parent->appendRow(new QStandardItem(QString("asset-%1").arg(r)));
 QTreeView view;view.setObjectName("media");view.setModel(&model);view.setRootIndex(parent->index());view.resize(300,180);view.show();app.processEvents();
 QJsonArray all;int offset=0;
 do{auto page=modelPage(&view,{{"offset",offset},{"limit",64}});
  require(page["rows"].toInt()==201,"Pager ignored the view root");
  auto rows=page["model"].toArray(),rects=page["itemRects"].toArray();
  require(rows.size()<=64&&rows.size()==rects.size(),"Unbounded or inconsistent page");
  for(int i=0;i<rows.size();i++){
   require(rows[i].toArray()[0].toString()==QString("asset-%1").arg(offset+i),"Missing, repeated or reordered row");
   require(rects[i].toObject()["row"].toInt()==offset+i,"Rect lost absolute row identity");all.append(rows[i]);
  }
  if(!page["hasMore"].toBool()){require(page["nextOffset"].isNull(),"Terminal cursor is not null");break;}
  require(page["nextOffset"].toInt()==offset+rows.size(),"Wrong next offset");offset=page["nextOffset"].toInt();
 }while(true);
 require(all.size()==201,"Incomplete model traversal");
 auto frozen=modelPage(&view,{});auto cursor=frozen["cursor"].toObject();
 parent->child(0)->setText("renamed-with-same-row-count");
 bool staleRejected=false;try{modelPage(&view,{{"offset",64},{"cursor",cursor}});}catch(const QString&){staleRejected=true;}
 require(staleRejected,"Same-count model change did not invalidate the cursor");
 auto current=modelPage(&view,{});require(current["cursor"].toObject()["revision"].toDouble()>cursor["revision"].toDouble(),"Model revision did not advance");
 require(modelPage(&view,{{"offset",64},{"cursor",current["cursor"]}})["model"].toArray().size()==32,"Valid cursor did not continue");
 require(modelPage(&view,{{"offset",201}})["model"].toArray().isEmpty(),"End page must be empty");
 require(modelPage(&view,{{"offset",100}})["itemRects"].toArray()[0].toObject()["visible"].toBool()==false,"Offscreen row marked visible");
 auto rejected=[&](QWidget* w,QJsonObject p){try{modelPage(w,p);return false;}catch(const QString&){return true;}};
 for(auto p:QList<QJsonObject>{{{"offset",-1}},{{"offset",1.5}},{{"offset","1"}},{{"offset",QJsonValue::Null}},{{"offset",202}},{{"limit",0}},{{"limit",65}},{{"limit",2.5}},{{"limit",QJsonValue::Null}}})require(rejected(&view,p),"Invalid page accepted");
 QWidget plain;require(rejected(&plain,{}),"Non-model target accepted");view.hide();require(rejected(&view,{}),"Hidden target accepted");
 std::cout<<"201 rows, nested root, offscreen geometry and malformed requests verified\\n";
}
`);
  const flags=execFileSync('pkg-config',['--cflags','--libs','Qt6Widgets'],{encoding:'utf8'}).trim().split(/\s+/);
  execFileSync('/usr/bin/clang++',['-std=c++17',probe,'-o',binary,...flags],{encoding:'utf8',timeout:60000});
  assert.match(execFileSync(binary,[],{env:{...process.env,QT_QPA_PLATFORM:'offscreen'},encoding:'utf8',timeout:10000}),/201 rows/);
 }finally{await rm(root,{recursive:true,force:true});}
});
