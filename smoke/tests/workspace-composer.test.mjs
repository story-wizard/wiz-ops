import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {validateNativeParams,withAdapterAction} from '../desktop/agent-proof.mjs';
import {requireNativeSuccess,agentReadNative} from '../desktop/adapter.mjs';
import {readJSON,writeJSON} from '../runner/files.mjs';

const binding={target:'panel',surfaceId:'view',editorId:'editor',sendId:'send',expectedText:'Existing draft'};
test('composer requests require exact observed identities and bounded insertions before a session is read',()=>{
 assert(agentReadNative.includes('workspace-composer-inspect'));
 validateNativeParams('workspace-composer-inspect',{target:'panel'});
 validateNativeParams('workspace-composer-type',{...binding,cursorPosition:14,text:' plus Ω'});
 validateNativeParams('workspace-composer-send',binding);
 for(const change of [{editorId:''},{surfaceId:null},{expectedText:undefined},{text:''},{text:'\u0000'},{text:'x'.repeat(4097)},{cursorPosition:-1},{cursorPosition:undefined},{script:'eval()'}])assert.throws(()=>validateNativeParams('workspace-composer-type',{...binding,cursorPosition:14,text:'local',...change}));
 assert.throws(()=>validateNativeParams('workspace-composer-send',{...binding,cursorPosition:14,text:'extra'}));
});

test('post-dispatch native readback failure stays Unknown and prevents another edit',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-composer-unknown-'),file=root+'/session.json';
 try{
  await writeJSON(file,{root,currentCheck:'composer',generation:1});let calls=0;
  await assert.rejects(()=>withAdapterAction(file,true,'workspace-composer-type',binding,async()=>{calls++;requireNativeSuccess({ok:false,status:'Unknown',error:'Readback differs'});}),e=>e.status==='Unknown');
  assert.equal((await readJSON(file)).agentUncertain,true);
  await assert.rejects(()=>withAdapterAction(file,true,'workspace-composer-send',binding,async()=>{calls++;}),e=>e.status==='Blocked');assert.equal(calls,1);
  assert.throws(()=>requireNativeSuccess({ok:false,status:'Blocked',error:'Target replaced'}),e=>e.status==='Blocked');
  assert.throws(()=>requireNativeSuccess({ok:false,error:'Existing rejection'}),e=>e.status==='Fail');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('owned QtQuick composer inserts Unicode, sends once and rejects changed targets without using the desktop',{skip:process.platform!=='darwin'||spawnSync('pkg-config',['--exists','Qt6Widgets','Qt6Test','Qt6Quick']).status!==0},async()=>{
 const root=await mkdtemp('/private/tmp/athanor-composer-qt-');
 try{
  const header=new URL('../desktop/native/workspace-probe.h',import.meta.url).pathname;
  await writeFile(root+'/test.cpp',`#include <QtWidgets>
#include <cassert>
#include <QtTest>
#include <QQmlContext>
#include <dlfcn.h>
#include "${header}"
class AgentWorkspacePanel : public QWidget { Q_OBJECT };
class AgentWorkspaceController : public QObject { Q_OBJECT };
int main(int argc,char** argv){
 QApplication app(argc,argv);AgentWorkspacePanel panel;AgentWorkspaceController controller;
 auto* view=new QQuickView;view->setObjectName("AgentWorkspaceQuickView");view->rootContext()->setContextProperty("ownedController",&controller);
 QQmlComponent component(view->engine());component.setData(R"QML(import QtQuick
import QtQuick.Controls
Item { width:400; height:160; property var workspace: ownedController; property int sends:0
 Item { objectName:"AgentWorkspaceComposer"; width:400; height:160; property bool canSend:true
  TextArea { id:input; objectName:"AgentWorkspaceMessageInput"; width:280; height:120; text:"Existing draft" }
  Rectangle { objectName:"AgentWorkspaceSendButton"; x:300; width:80; height:120
   MouseArea { anchors.fill:parent; onClicked:parent.parent.parent.sends++ }
  }
 }
})QML",QUrl());auto* object=component.create();if(!object)qFatal("%s",qPrintable(component.errorString()));
 view->setContent(QUrl(),&component,object);auto* container=QWidget::createWindowContainer(view,&panel);container->setObjectName("AgentWorkspaceQuickContainer");container->resize(400,160);panel.resize(400,160);panel.show();view->requestActivate();QCoreApplication::processEvents();
 int sequence=0;auto id=[&](QObject* item){auto value=item->property("testIdentity").toString();if(value.isEmpty()){value=QString::number(++sequence);item->setProperty("testIdentity",value);}return value;};
 try { WorkspaceProbe probe(&panel);const auto observed=probe.composer(id);auto* editor=probe.named("AgentWorkspaceMessageInput");editor->setProperty("cursorPosition",14);
 QJsonObject request{{"op","workspace-composer-type"},{"surfaceId",observed["surfaceId"]},{"editorId",observed["editor"].toObject()["id"]},{"sendId",observed["send"].toObject()["id"]},{"expectedText","Existing draft"},{"cursorPosition",14},{"text"," + Ω\\nline"}};
 const auto typed=probe.composerInput(request,id);assert(typed["text"].toString()==QString("Existing draft + Ω\\nline"));
 auto send=request;send["op"]="workspace-composer-send";send["expectedText"]=typed["text"];send.remove("text");send.remove("cursorPosition");
 probe.composerInput(send,id);assert(object->property("sends").toInt()==1);
 auto rejected=[&](QJsonObject value){bool denied=false;try{probe.composerInput(value,id);}catch(const WorkspaceInputError& e){denied=e.status=="Blocked";}catch(const QString&){denied=true;}assert(denied);assert(object->property("sends").toInt()==1);};
 auto stale=send;stale["editorId"]="replaced";rejected(stale);stale=send;stale["surfaceId"]="foreign";rejected(stale);stale=send;stale["sendId"]="foreign";rejected(stale);stale=send;stale["expectedText"]="old draft";rejected(stale);
 auto insertion=request;insertion["expectedText"]=typed["text"];insertion["cursorPosition"]=-1;rejected(insertion);
 insertion["cursorPosition"]=editor->property("cursorPosition").toInt();editor->setProperty("readOnly",true);rejected(insertion);editor->setProperty("readOnly",false);
 assert(QMetaObject::invokeMethod(editor,"select",Q_ARG(int,0),Q_ARG(int,2)));rejected(insertion);assert(QMetaObject::invokeMethod(editor,"deselect"));
 auto* overlay=new QQuickItem(view->rootObject());overlay->setWidth(400);overlay->setHeight(160);overlay->setZ(1000);rejected(send);delete overlay;
 editor->setVisible(false);rejected(send);editor->setVisible(true);editor->setEnabled(false);rejected(send);editor->setEnabled(true);
 probe.named("AgentWorkspaceComposer")->setProperty("canSend",false);rejected(send);
 assert(editor->property("text").toString()==typed["text"].toString());
 qInfo("Composer boundaries verified offscreen"); } catch(const WorkspaceInputError& e){qFatal("%s: %s",qPrintable(e.status),qPrintable(e.message));}catch(const QString& e){qFatal("%s",qPrintable(e));}return 0;
}
#include "test.moc"
`);
  execFileSync('/opt/homebrew/share/qt/libexec/moc',[root+'/test.cpp','-o',root+'/test.moc'],{timeout:10000});
  const flags=execFileSync('pkg-config',['--cflags','--libs','Qt6Widgets','Qt6Test','Qt6Quick'],{encoding:'utf8'}).trim().split(/\s+/);
  execFileSync('clang++',['-std=c++17',root+'/test.cpp','-I'+root,...flags,'-o',root+'/test'],{timeout:60000});
  const result=execFileSync(root+'/test',{encoding:'utf8',timeout:10000,env:{...process.env,QT_QPA_PLATFORM:'offscreen',QT_QUICK_BACKEND:'software'}});assert.equal(result,'');
 }finally{await rm(root,{recursive:true,force:true});}
});
