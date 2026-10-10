// Test-only Qt plugin. The style factory provides a startup hook; Wizard replaces
// the returned style with its normal WizStyle. No macOS accessibility calls.
#include <QtWidgets>
#include "bug-report-prefill.h"
#include <QtTest/QTest>
#include <QtTest/QSignalSpy>
#include <QStylePlugin>
#include <QScreen>
#include <QSaveFile>
#include <QUuid>
#include <dlfcn.h>
#include <algorithm>
#include <cmath>
#include <objc/runtime.h>
#include <objc/message.h>
#include <ApplicationServices/ApplicationServices.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#include "workspace-probe.h"

class SmokeBridge : public QObject {
    QString root, generation=QUuid::createUuid().toString(QUuid::WithoutBraces);
    QHash<QString,QPointer<QObject>> objects;
    QHash<QString,QSharedPointer<QSignalSpy>> previewSpies;
    std::unique_ptr<QMimeData> previousClipboard;
    QByteArray ownedClipboardHash;
    QByteArray clipboardHash() {
        QCryptographicHash hash(QCryptographicHash::Sha256);const auto* mime=QGuiApplication::clipboard()->mimeData();
        if(mime)for(const auto& format:mime->formats()){hash.addData(format.toUtf8());hash.addData(mime->data(format));}return hash.result();
    }
    bool restoreClipboard(){
        const bool owned=previousClipboard&&!ownedClipboardHash.isEmpty()&&clipboardHash()==ownedClipboardHash;
        if(owned)QGuiApplication::clipboard()->setMimeData(previousClipboard.release());
        previousClipboard.reset();ownedClipboardHash.clear();return owned;
    }
    int sequence=0;
    QJsonArray menuItems(QMenu* menu,int depth,int& remaining){
        QJsonArray entries;
        for(auto* a:menu->actions()){
            if(remaining--<=0)break;
            const auto r=menu->actionGeometry(a);
            QJsonObject item{{"id",id(a)},{"text",a->text()},{"value",QJsonValue::fromVariant(a->data())},{"enabled",a->isEnabled()},{"x",r.x()},{"y",r.y()},{"width",r.width()},{"height",r.height()}};
            if(a->menu()){item["submenu"]=id(a->menu());if(depth<4)item["items"]=menuItems(a->menu(),depth+1,remaining);}
            entries.append(item);
        }
        return entries;
    }
    static NSArray<NSMenuItem*>* quitItems(NSMenu* menu){
        NSMutableArray<NSMenuItem*>* found=[NSMutableArray array];
        for(NSMenuItem* item in menu.itemArray){
            if(item.submenu)[found addObjectsFromArray:quitItems(item.submenu)];
            else if([item.keyEquivalent isEqualToString:@"q"]&&item.keyEquivalentModifierMask==NSEventModifierFlagCommand&&!item.hidden)[found addObject:item];
        }
        return found;
    }
    static void click(QWidget* widget,QPoint point){
        const QPoint global=widget->mapToGlobal(point);QPointer<QWidget> original(widget);
        QTest::mousePress(widget,Qt::LeftButton,Qt::NoModifier,point);
        // QTest does not route release to a parent that grabbed the mouse on press.
        QWidget* receiver=QWidget::mouseGrabber();if(!receiver)receiver=original;
        if(receiver)QTest::mouseRelease(receiver,Qt::LeftButton,Qt::NoModifier,receiver->mapFromGlobal(global));
    }
    static QPixmap presented(QWidget* widget){
        auto* window=widget->window();void* view=reinterpret_cast<void*>(window->winId());
        auto send=reinterpret_cast<void*(*)(void*,SEL)>(objc_msgSend);void* native=send(view,sel_registerName("window"));
        if(!native)throw QString("Owned native window unavailable");
        const auto number=reinterpret_cast<long(*)(void*,SEL)>(objc_msgSend)(native,sel_registerName("windowNumber"));
        struct Capture { QPointer<QEventLoop> loop;CGImageRef image=nullptr;QString error;~Capture(){if(image)CGImageRelease(image);} };
        QEventLoop loop;auto state=std::make_shared<Capture>();state->loop=&loop;
        auto finish=^(CGImageRef image,NSString* error){CGImageRef retained=image?CGImageRetain(image):nullptr;const QString message=QString::fromNSString(error?:@"");QMetaObject::invokeMethod(qApp,[state,retained,message]{if(!state->loop){if(retained)CGImageRelease(retained);return;}state->image=retained;state->error=message;state->loop->quit();},Qt::QueuedConnection);};
        [SCShareableContent getCurrentProcessShareableContentWithCompletionHandler:^(SCShareableContent* content,NSError* error){
            if(error){finish(nullptr,error.localizedDescription);return;}SCWindow* owned=nil;for(SCWindow* candidate in content.windows)if(candidate.windowID==number&&candidate.owningApplication.processID==QCoreApplication::applicationPid()){owned=candidate;break;}
            if(!owned){finish(nullptr,@"Owned window absent from capture inventory");return;}
            SCContentFilter* filter=[[SCContentFilter alloc] initWithDesktopIndependentWindow:owned];SCStreamConfiguration* config=[SCStreamConfiguration new];config.width=NSUInteger(owned.frame.size.width*2);config.height=NSUInteger(owned.frame.size.height*2);config.showsCursor=NO;
            [SCScreenshotManager captureImageWithFilter:filter configuration:config completionHandler:^(CGImageRef image,NSError* error){finish(image,error.localizedDescription);}];
        }];
        QTimer::singleShot(4000,&loop,&QEventLoop::quit);loop.exec();state->loop=nullptr;
        if(!state->error.isEmpty())throw state->error;CGImageRef capture=state->image;state->image=nullptr;
        if(!capture)throw QString("Window-specific capture unavailable");
        QImage image(int(CGImageGetWidth(capture)),int(CGImageGetHeight(capture)),QImage::Format_RGBA8888);image.fill(Qt::transparent);
        CGColorSpaceRef colors=CGColorSpaceCreateDeviceRGB();CGContextRef ctx=CGBitmapContextCreate(image.bits(),image.width(),image.height(),8,image.bytesPerLine(),colors,kCGImageAlphaPremultipliedLast|kCGBitmapByteOrder32Big);
        if(!ctx){CGColorSpaceRelease(colors);CGImageRelease(capture);throw QString("Capture conversion failed");}
        CGContextDrawImage(ctx,CGRectMake(0,0,image.width(),image.height()),capture);CGContextRelease(ctx);CGColorSpaceRelease(colors);CGImageRelease(capture);
        const auto visible=widget->visibleRegion().boundingRect();if(visible.isEmpty())throw QString("Target has no visible capture region");
        const auto pos=widget->mapTo(window,visible.topLeft());const auto frame=window->frameGeometry();const double scale=double(image.width())/frame.width();
        const int title=window->geometry().top()-frame.top();const QRect crop=QRect(qRound(pos.x()*scale),qRound((pos.y()+title)*scale),qRound(visible.width()*scale),qRound(visible.height()*scale)).intersected(image.rect());
        if(crop.isEmpty())throw QString("Target is outside the owned window");return QPixmap::fromImage(image.copy(crop));
    }
    QString id(QObject* object) {
        auto key=object->property("_smoke_id").toString();
        if(key.isEmpty()){key=QString::number(++sequence);object->setProperty("_smoke_id",key);objects[key]=object;}
        return key;
    }
    void save(const QString& file,const QJsonObject& value){
        QSaveFile output(root+"/"+file);if(!output.open(QIODevice::WriteOnly))return;
        output.write(QJsonDocument(value).toJson());output.commit();
    }
    static QJsonObject capabilities(){
        return {{"protocol",1},{"version",11},{"operations",QJsonArray{"capabilities","inspect","add-floating-panel","workspace-inspect","workspace-append","workspace-hover","workspace-header","workspace-image-width","model-page","model-value","model-reveal","bug-report-prefill","timeline-clip-rect","timeline-point","quit","clipboard-save","clipboard-mark","clipboard-restore","screenshot","snapshot-widget","snapshot-presented","snapshot-node-preview","item-click","context-click","drop-model-item","drag","close-window","resize-window","activate","action","click","type-text","text","key","spellbook-run-local","select"}},
                {"buttonClickGeometry",true},{"timelineGeometry",bool(dlsym(RTLD_DEFAULT,"_ZNK14TimelineWidget11clipRectForERK7QString"))},
                {"timelinePoint",bool(dlsym(RTLD_DEFAULT,"_ZNK14TimelineWidget7timeToXEd")&&dlsym(RTLD_DEFAULT,"_ZNK14TimelineWidget14trackYForIndexEi")&&dlsym(RTLD_DEFAULT,"_ZNK14TimelineWidget11trackHeightEi"))},
                {"limits",QJsonObject{{"modelRows",64},{"modelPageRows",64},{"timelineClipIds",1024},{"sceneItems",128},{"sceneText",256},{"requestBytes",1024*1024},{"typedCharacters",1024}}},
                {"captures",QJsonObject{{"screenshot","Qt widget raster"},{"snapshot-presented","Owned native window pixels"},{"snapshot-node-preview","Rendered graph preview"}}}};
    }
    QJsonObject modelPage(QWidget* widget,const QJsonObject& request){
        auto* view=qobject_cast<QAbstractItemView*>(widget);
        if(!view||!view->isVisible()||!view->model())throw QString("Choose an observed visible model view");
        const auto offsetValue=request.value("offset"),limitValue=request.value("limit");
        const int offset=offsetValue.isUndefined()?0:offsetValue.toInt(-1);
        const int limit=limitValue.isUndefined()?32:limitValue.toInt(-1);
        if((!offsetValue.isUndefined()&&(!offsetValue.isDouble()||offsetValue.toDouble()!=offset))||offset<0||
           (!limitValue.isUndefined()&&(!limitValue.isDouble()||limitValue.toDouble()!=limit))||limit<1||limit>64)
            throw QString("Model page needs an integer offset >= 0 and limit from 1 to 64");
        auto* model=view->model();const auto root=view->rootIndex();const int count=model->rowCount(root);
        if(!model->property("_smoke_model_watched").toBool()){
            model->setProperty("_smoke_model_watched",true);model->setProperty("_smoke_model_revision",0);
            auto changed=[model]{model->setProperty("_smoke_model_revision",model->property("_smoke_model_revision").toULongLong()+1);};
            QObject::connect(model,&QAbstractItemModel::dataChanged,model,changed);QObject::connect(model,&QAbstractItemModel::rowsInserted,model,changed);
            QObject::connect(model,&QAbstractItemModel::rowsRemoved,model,changed);QObject::connect(model,&QAbstractItemModel::rowsMoved,model,changed);
            QObject::connect(model,&QAbstractItemModel::columnsInserted,model,changed);QObject::connect(model,&QAbstractItemModel::columnsRemoved,model,changed);
            QObject::connect(model,&QAbstractItemModel::modelReset,model,changed);QObject::connect(model,&QAbstractItemModel::layoutChanged,model,changed);
        }
        QJsonArray rootPath;for(auto index=root;index.isValid();index=index.parent()){if(rootPath.size()>=32)throw QString("Model root exceeds the inspection limit");rootPath.prepend(index.row());}
        const QJsonObject cursor{{"modelIdentity",id(model)},{"revision",double(model->property("_smoke_model_revision").toULongLong())},{"root",rootPath}};
        if(request.contains("cursor")&&request["cursor"].toObject()!=cursor)throw QString("Model changed between pages; restart inspection");
        QJsonArray headers;for(int col=0;col<qMin(64,model->columnCount(root));col++)headers.append(model->headerData(col,Qt::Horizontal).toString());
        if(offset>count)throw QString("Model offset exceeds the current row count; observe again");
        const int end=offset+qMin(limit,count-offset);QJsonArray rows,rects;
        for(int r=offset;r<end;r++){
            QJsonArray cols;for(int col=0;col<qMin(6,model->columnCount(root));col++)cols.append(model->data(model->index(r,col,root)).toString());
            rows.append(cols);const auto rect=view->visualRect(model->index(r,0,root));
            const auto visible=rect.intersected(view->viewport()->rect());
            rects.append(QJsonObject{{"row",r},{"x",rect.x()},{"y",rect.y()},{"width",rect.width()},{"height",rect.height()},{"visible",!visible.isEmpty()}});
        }
        return {{"target",id(view)},{"viewport",id(view->viewport())},{"rows",count},{"offset",offset},{"limit",limit},{"model",rows},{"itemRects",rects},
                {"nextOffset",end<count?QJsonValue(end):QJsonValue(QJsonValue::Null)},{"hasMore",end<count},{"cursor",cursor},{"headers",headers},{"columns",model->columnCount(root)}};
    }
    QJsonObject inspect(QWidget* scope=nullptr){
        QJsonArray widgets,actions;QSet<QAction*> seen;
        for(auto* w:QApplication::allWidgets()){
            if(!w->isVisible()||(scope&&w!=scope&&!scope->isAncestorOf(w)&&!w->isAncestorOf(scope)))continue;
            QJsonObject item{{"visible",w->isVisible()},{"active",w->isActiveWindow()},{"id",id(w)},{"class",w->metaObject()->className()},{"name",w->objectName()},{"tooltip",w->toolTip()},{"parent",w->parentWidget()?id(w->parentWidget()):QString()},{"enabled",w->isEnabled()},{"title",w->windowTitle()},{"window",id(w->window())},{"width",w->width()},{"height",w->height()}};
            const auto pos=w->mapTo(w->window(),QPoint{});item["x"]=pos.x();item["y"]=pos.y();
            item["accessibleName"]=w->accessibleName();item["accessibleDescription"]=w->accessibleDescription();
            if(w->objectName()=="InspectorParamControlRow"){
                const auto key=w->property("inspectorInteractionKey").toString(),parameter=w->property("paramPath").toString();
                item["inspectorBindingIncomplete"]=key.isEmpty()||key.size()>4096||parameter.isEmpty()||parameter.size()>256;
                if(!item["inspectorBindingIncomplete"].toBool()){item["inspectorInteractionKey"]=key;item["paramPath"]=parameter;}
            }
            const auto visible=w->visibleRegion().boundingRect();item["visibleRect"]=QJsonObject{{"x",visible.x()},{"y",visible.y()},{"width",visible.width()},{"height",visible.height()}};
            item["focused"]=w==qApp->focusWidget();
            if(w->isWindow()){NSView* view=(__bridge NSView*)reinterpret_cast<void*>(w->winId());item["nativeWindow"]=qint64(view.window.windowNumber);item["keyWindow"]=view.window.isKeyWindow;const auto order=[NSApp.orderedWindows indexOfObject:view.window];item["nativeOrder"]=order==NSNotFound?QJsonValue(QJsonValue::Null):QJsonValue(double(order));item["nativeLevel"]=double(view.window.level);item["nativeHasParent"]=view.window.parentWindow!=nil;item["nativeHidesOnDeactivate"]=view.window.hidesOnDeactivate;}
            for(auto* owner=w;owner;owner=owner->parentWidget())if(auto* proxy=owner->graphicsProxyWidget();proxy&&proxy->scene()&&!proxy->scene()->views().isEmpty()){item["graphView"]=id(proxy->scene()->views().front());break;}
            if(auto* p=qobject_cast<QLabel*>(w))item["text"]=p->text();
            if(auto* p=qobject_cast<QAbstractButton*>(w)){item["text"]=p->text();item["checked"]=p->isChecked();}
            if(auto* p=qobject_cast<QCheckBox*>(w)){QStyleOptionButton opt;opt.initFrom(p);opt.text=p->text();opt.icon=p->icon();opt.iconSize=p->iconSize();const auto r=p->style()->subElementRect(QStyle::SE_CheckBoxClickRect,&opt,p).intersected(p->rect());item["clickRect"]=QJsonObject{{"x",r.x()},{"y",r.y()},{"width",r.width()},{"height",r.height()}};}
            if(auto* p=qobject_cast<QLineEdit*>(w);p&&p->echoMode()==QLineEdit::Normal)item["text"]=p->text();
            if(auto* p=qobject_cast<QLineEdit*>(w))item["editableText"]=p->echoMode()==QLineEdit::Normal&&!p->isReadOnly()&&p->isEnabled();
            if(auto* p=qobject_cast<QKeySequenceEdit*>(w)){item["text"]=p->keySequence().toString();item["keySequenceCapture"]=true;}
            if(auto* p=qobject_cast<QPlainTextEdit*>(w))item["editableText"]=!p->isReadOnly()&&p->isEnabled();
            if(auto* p=qobject_cast<QTextEdit*>(w))item["editableText"]=!p->isReadOnly()&&p->isEnabled();
            if(auto* p=qobject_cast<QPlainTextEdit*>(w);p&&p->isReadOnly())item["text"]=p->toPlainText().right(32768);
            if(auto* p=qobject_cast<QAbstractSpinBox*>(w))item["text"]=p->text();
            if(auto* p=qobject_cast<QAbstractSlider*>(w)){item["value"]=p->value();item["minimum"]=p->minimum();item["maximum"]=p->maximum();item["orientation"]=p->orientation()==Qt::Horizontal?"horizontal":"vertical";}
            if(auto* p=qobject_cast<QSlider*>(w)){QStyleOptionSlider opt;opt.initFrom(p);opt.orientation=p->orientation();opt.minimum=p->minimum();opt.maximum=p->maximum();opt.upsideDown=p->invertedAppearance();auto center=[&](int value){opt.sliderPosition=value;opt.sliderValue=value;return p->style()->subControlRect(QStyle::CC_Slider,&opt,QStyle::SC_SliderHandle,p).center();};auto point=[](QPoint v){return QJsonArray{v.x(),v.y()};};item["handle"]=point(center(p->value()));item["minHandle"]=point(center(p->minimum()));item["maxHandle"]=point(center(p->maximum()));const auto groove=p->style()->subControlRect(QStyle::CC_Slider,&opt,QStyle::SC_SliderGroove,p);item["groove"]=QJsonArray{groove.x(),groove.y(),groove.width(),groove.height()};}
            if(auto* p=qobject_cast<QTextEdit*>(w)){item["text"]=p->toPlainText().left(32768);item["html"]=p->toHtml().left(65536);}
            if(auto* p=qobject_cast<QGraphicsView*>(w);p&&p->scene()){QJsonArray entries;item["sceneTextTruncated"]=false;for(auto* g:p->scene()->items()){QString text;if(auto* t=qgraphicsitem_cast<QGraphicsTextItem*>(g))text=t->toPlainText();if(auto* t=qgraphicsitem_cast<QGraphicsSimpleTextItem*>(g))text=t->text();if(text.isEmpty())continue;if(entries.size()>=256){item["sceneTextTruncated"]=true;break;}auto r=p->mapFromScene(g->sceneBoundingRect()).boundingRect();entries.append(QJsonObject{{"text",text},{"x",r.x()},{"y",r.y()},{"width",r.width()},{"height",r.height()}});}item["sceneText"]=entries;item["viewport"]=id(p->viewport());}

            if(QString(w->metaObject()->className())=="TimelineWidget"){
                for(auto* owner=w->parentWidget();owner;owner=owner->parentWidget())if(QString(owner->metaObject()->className())=="TimelinePanel"){
                    item["timelinePanel"]=id(owner);
                    using Mode=int(*)(const QWidget*);auto mode=reinterpret_cast<Mode>(dlsym(RTLD_DEFAULT,"_ZNK13TimelinePanel8toolModeEv"));if(mode)item["toolMode"]=mode(owner);
                    using TrackId=QString(*)(const QWidget*,int,bool);
                    using TrackY=int(*)(const QWidget*,int);
                    auto trackId=reinterpret_cast<TrackId>(dlsym(RTLD_DEFAULT,"_ZN13TimelinePanel15trackIdForIndexEPK14TimelineWidgetib"));
                    auto trackY=reinterpret_cast<TrackY>(dlsym(RTLD_DEFAULT,"_ZNK14TimelineWidget14trackYForIndexEi"));
                    if(trackId&&trackY){QJsonArray tracks;int index=0;for(;index<1024&&trackY(w,index)>=0;index++)tracks.append(trackId(w,index,false));item["trackIds"]=tracks;item["trackIdsTruncated"]=index==1024;}
                    break;
                }
                using Getter=QSet<QString>(*)(const QWidget*);
                auto getter=reinterpret_cast<Getter>(dlsym(RTLD_DEFAULT,"_ZNK14TimelineWidget10allClipIdsEv"));
                if(getter){auto ids=getter(w).values();std::sort(ids.begin(),ids.end());QJsonArray clips;
                    for(int i=0;i<qMin<qsizetype>(1024,ids.size());i++)clips.append(ids[i]);
                    item["clipIds"]=clips;item["clipIdsTruncated"]=ids.size()>1024;}
            }
            // Read the packaged public getters; missing symbols leave identity unavailable.
            if(QString(w->metaObject()->className())=="RenderGraphView"){
                using Getter=QString(*)(const QWidget*);
                auto graph=reinterpret_cast<Getter>(dlsym(RTLD_DEFAULT,"_ZNK16RenderGraphPanel16inspectorGraphIdEv"));
                auto timeline=reinterpret_cast<Getter>(dlsym(RTLD_DEFAULT,"_ZNK16RenderGraphPanel19inspectorTimelineIdEv"));
                for(auto* owner=w->parentWidget();owner;owner=owner->parentWidget())if(QString(owner->metaObject()->className())=="RenderGraphPanel"){
                    if(graph)item["graphId"]=graph(owner);if(timeline)item["timelineId"]=timeline(owner);break;
                }
            }
            if(auto* p=qobject_cast<QComboBox*>(w)){QJsonArray entries,values;for(int i=0;i<p->count();i++){entries.append(p->itemText(i));values.append(QJsonValue::fromVariant(p->itemData(i)));}item["items"]=entries;item["itemValues"]=values;item["index"]=p->currentIndex();}
            if(auto* p=qobject_cast<QGraphicsView*>(w);p&&p->scene()){QJsonArray entries;item["sceneItemsTruncated"]=false;for(auto* g:p->scene()->items()){if(!(g->flags()&QGraphicsItem::ItemIsSelectable))continue;if(entries.size()>=128){item["sceneItemsTruncated"]=true;break;}QJsonArray labels;for(auto* child:g->childItems())if(auto* proxy=qgraphicsitem_cast<QGraphicsProxyWidget*>(child);proxy&&proxy->widget())for(auto* label:proxy->widget()->findChildren<QLabel*>())labels.append(label->text());const auto r=p->mapFromScene(g->sceneBoundingRect()).boundingRect();QJsonArray ports;
                for(auto* child:g->childItems())if(child->isVisible()&&(qgraphicsitem_cast<QGraphicsEllipseItem*>(child)||(QString(p->metaObject()->className())=="RenderGraphView"&&child->type()==QGraphicsItem::UserType+1&&child->boundingRect()==QRectF(-6,-6,12,12)))){
                    const auto center=p->mapFromScene(child->mapToScene(child->boundingRect().center()));
                    ports.append(QJsonObject{{"x",center.x()},{"y",center.y()},{"side",child->pos().x()<g->boundingRect().center().x()?"input":"output"},{"tooltip",child->toolTip()}});
                }
                QJsonObject node{{"labels",labels},{"selected",g->isSelected()},{"x",r.x()},{"y",r.y()},{"width",r.width()},{"height",r.height()},{"sceneX",g->pos().x()},{"sceneY",g->pos().y()},{"ports",ports}};
                if(QString(p->metaObject()->className())=="RenderGraphView"&&g->type()==QGraphicsItem::UserType+4&&g->toGraphicsObject()){
                    using Getter=QString(*)(const QGraphicsObject*);auto getter=reinterpret_cast<Getter>(dlsym(RTLD_DEFAULT,"_ZNK14RenderNodeItem6nodeIdEv"));
                    if(getter)node["nodeId"]=getter(g->toGraphicsObject());
                }
                entries.append(node);}item["sceneItems"]=entries;}
            if(auto* p=qobject_cast<QTabBar*>(w)){QJsonArray entries;for(int i=0;i<p->count();i++)entries.append(p->tabText(i));item["tabs"]=entries;item["index"]=p->currentIndex();QJsonArray rects;for(int i=0;i<p->count();i++){const auto r=p->tabRect(i);QWidget* close=p->tabButton(i,QTabBar::RightSide);if(!close)close=p->tabButton(i,QTabBar::LeftSide);rects.append(QJsonObject{{"text",p->tabText(i)},{"x",r.x()},{"y",r.y()},{"width",r.width()},{"height",r.height()},{"close",close&&close->isVisible()?id(close):QString()}});}item["tabRects"]=rects;}
            if(auto* p=qobject_cast<QMenu*>(w)){int remaining=256;item["menuItems"]=menuItems(p,0,remaining);item["menuTruncated"]=remaining<=0;}
            if(auto* p=qobject_cast<QAbstractItemView*>(w);p&&p->model()){
                QJsonArray rows;auto* m=p->model();item["rows"]=m->rowCount(p->rootIndex());
                for(int r=0;r<qMin(64,m->rowCount(p->rootIndex()));r++){QJsonArray cols;for(int col=0;col<qMin(6,m->columnCount(p->rootIndex()));col++)cols.append(m->data(m->index(r,col,p->rootIndex())).toString());rows.append(cols);}item["model"]=rows;item["viewport"]=id(p->viewport());item["currentRow"]=p->currentIndex().row();QJsonArray selected;for(const auto& index:p->selectionModel()->selectedRows())selected.append(index.row());item["selectedRows"]=selected;
                QJsonArray rects;for(int r=0;r<qMin(64,m->rowCount(p->rootIndex()));r++){auto rect=p->visualRect(m->index(r,0,p->rootIndex()));rects.append(QJsonObject{{"row",r},{"x",rect.x()},{"y",rect.y()},{"width",rect.width()},{"height",rect.height()}});}item["itemRects"]=rects;
            }
            if(QString(w->metaObject()->className())=="PreviewPanel"){
                const auto index=w->metaObject()->indexOfSignal("playClicked()");
                if(index>=0){const auto key=id(w);if(!previewSpies.contains(key))previewSpies[key]=QSharedPointer<QSignalSpy>::create(w,w->metaObject()->method(index));if(previewSpies[key]->isValid())item["playClickedCount"]=previewSpies[key]->count();}
            }
            widgets.append(item);
            for(auto* a:w->findChildren<QAction*>(QString{},scope?Qt::FindDirectChildrenOnly:Qt::FindChildrenRecursively))if(!seen.contains(a)){seen.insert(a);QJsonObject action{{"id",id(a)},{"text",a->text()},{"name",a->objectName()},{"enabled",a->isEnabled()},{"checked",a->isChecked()},{"checkable",a->isCheckable()},{"shortcut",a->shortcut().toString()}};if(a->property("mediaSearchBaseLabel").isValid())action["mediaSearchSource"]=a->property("mediaSearchBaseLabel").toString();actions.append(action);}
        }
        QString focus=qApp->focusWidget()?id(qApp->focusWidget()):QString();
        // Native file panels are AppKit surfaces. Read public view/window APIs;
        // do not traverse Qt's macOS accessibility implementation.
        if(!scope)for(NSWindow* window in NSApp.windows){
            if(!window.visible||!window.contentView)continue;
            bool represented=false;for(const auto& value:widgets)if(value.toObject()["nativeWindow"].toInteger()==window.windowNumber){represented=true;break;}
            if(represented)continue;
            const QString windowId="native-window-"+QString::number(window.windowNumber);const NSRect bounds=window.contentView.bounds;
            const QString klass=[window isKindOfClass:[NSOpenPanel class]]?"NSOpenPanel":"NSPanel";
            const int nativeWindowIndex=widgets.size();
            widgets.append(QJsonObject{{"id",windowId},{"window",windowId},{"class",klass},{"title",QString::fromNSString(window.title)},{"nativeWindow",qint64(window.windowNumber)},{"keyWindow",window.keyWindow},{"active",window.keyWindow},{"enabled",true},{"x",0},{"y",0},{"width",bounds.size.width},{"height",bounds.size.height}});
            NSMutableArray<NSView*>* pending=[NSMutableArray arrayWithObject:window.contentView];int count=0;
            while(pending.count&&count++<512){
                NSView* view=pending.lastObject;[pending removeLastObject];if([view isHiddenOrHasHiddenAncestor])continue;[pending addObjectsFromArray:view.subviews];
                if(![view isKindOfClass:[NSButton class]]&&![view isKindOfClass:[NSTextField class]])continue;
                const NSRect rect=[view convertRect:view.bounds toView:window.contentView];
                const QString viewId=QString("native-view-%1").arg(quintptr((__bridge void*)view),0,16);
                QJsonObject item{{"id",viewId},{"window",windowId},{"nativeWindow",qint64(window.windowNumber)},{"class",[view isKindOfClass:[NSButton class]]?"NSButton":"NSTextField"},{"x",rect.origin.x},{"y",bounds.size.height-NSMaxY(rect)},{"width",rect.size.width},{"height",rect.size.height},{"enabled",[(NSControl*)view isEnabled]}};
                if([view isKindOfClass:[NSButton class]])item["text"]=QString::fromNSString([(NSButton*)view title]);
                else if(![view isKindOfClass:[NSSecureTextField class]]){
                    NSTextField* field=(NSTextField*)view;item["text"]=QString::fromNSString(field.stringValue).left(4096);item["editableText"]=field.editable&&field.enabled;
                    const bool focused=window.keyWindow&&[field currentEditor]&&window.firstResponder==[field currentEditor];item["focused"]=focused;if(focused)focus=viewId;
                }
                widgets.append(item);
            }
            auto nativeWindow=widgets[nativeWindowIndex].toObject();nativeWindow["nativeViewsTruncated"]=pending.count>0;widgets[nativeWindowIndex]=nativeWindow;
        }
        return {{"widgets",widgets},{"actions",actions},{"focus",focus},{"scope",scope?QJsonValue(id(scope)):QJsonValue(QJsonValue::Null)},
                {"modalWindow",QApplication::activeModalWidget()?QJsonValue(id(QApplication::activeModalWidget())):QJsonValue(QJsonValue::Null)},
                {"popupWindow",QApplication::activePopupWidget()?QJsonValue(id(QApplication::activePopupWidget())):QJsonValue(QJsonValue::Null)},
                {"mouseGrabber",QWidget::mouseGrabber()?QJsonValue(id(QWidget::mouseGrabber())):QJsonValue(QJsonValue::Null)}};
    }
    QJsonObject perform(const QJsonObject& request){
        if(request["generation"].toString()!=generation)throw QString("Stale GUI generation");
        const auto op=request["op"].toString(),key=request["target"].toString();
        QObject* target=objects.value(key);auto* widget=qobject_cast<QWidget*>(target);
        if(op=="capabilities")return capabilities();
        if(op=="add-floating-panel"){
            using Add=void(*)(QWidget*,const QString&);auto add=reinterpret_cast<Add>(dlsym(RTLD_DEFAULT,"_ZN10MainWindow16addFloatingPanelERK7QString"));const auto panel=request["panel"].toString();
            if(!add||!widget||!widget->isVisible()||QString(widget->metaObject()->className())!="MainWindow"||QApplication::activeModalWidget()||(panel!="Timeline"&&panel!="Preview"))throw QString("Adding a floating panel requires the owned main window and Timeline or Preview");
            add(widget,panel);return {{"added",panel}};
        }
        if(op.startsWith("workspace-")){
            WorkspaceProbe probe(widget);
            if(op=="workspace-inspect")return probe.inspect(widget);
            if(op=="workspace-append")probe.append(widget,request);
            else if(op=="workspace-hover")probe.hover(request);
            else if(op=="workspace-header")probe.header(request);
            else if(op=="workspace-image-width")probe.imageWidth(request);
            else throw QString("Unsupported workspace operation");
            return {{"dispatched",op}};
        }
        if(op=="inspect"){if(request.contains("target")&&(!widget||!widget->isVisible()))throw QString("Scoped target is unavailable; observe again");return inspect(widget);}
        if(op=="model-page")return modelPage(widget,request);
        if(op=="model-value"){
            const auto page=modelPage(widget,request);auto* view=qobject_cast<QAbstractItemView*>(widget);
            const int column=request["column"].toInt(-1),role=request["role"].toInt(-1);
            if(page["model"].toArray().isEmpty()||!request["column"].isDouble()||request["column"].toDouble()!=column||column<0||column>=view->model()->columnCount(view->rootIndex())||!request["role"].isDouble()||request["role"].toDouble()!=role||role<0||role>Qt::UserRole+1024)throw QString("Use an observed row, column and bounded Qt data role");
            const auto value=view->model()->data(view->model()->index(page["offset"].toInt(),column,view->rootIndex()),role);
            QJsonObject result{{"target",id(view)},{"cursor",page["cursor"]},{"row",page["offset"]},{"column",column},{"role",role},{"available",value.isValid()},{"type",QString(value.typeName()?value.typeName():"invalid")}};
            if(value.metaType().id()==QMetaType::QPixmap||value.metaType().id()==QMetaType::QImage){
                const auto image=value.metaType().id()==QMetaType::QPixmap?value.value<QPixmap>().toImage():value.value<QImage>();
                if(image.isNull()){result["available"]=false;return result;}
                if(image.width()>8192||image.height()>8192)throw QString("Model image exceeds capture bounds");
                const QString file=root+"/model-"+QUuid::createUuid().toString(QUuid::WithoutBraces)+".png";
                if(!image.scaled(512,512,Qt::KeepAspectRatio,Qt::SmoothTransformation).save(file))throw QString("Model image capture failed");
                result["path"]=file;result["width"]=image.width();result["height"]=image.height();
                const auto sample=image.scaled(64,32,Qt::IgnoreAspectRatio,Qt::SmoothTransformation).convertToFormat(QImage::Format_RGB888);QByteArray bytes;
                for(int row=0;row<sample.height();row++)bytes.append(reinterpret_cast<const char*>(sample.constScanLine(row)),sample.width()*3);
                result["sampleWidth"]=64;result["sampleHeight"]=32;result["sampleRgb"]=QString::fromLatin1(bytes.toBase64());
            }else{
                const auto json=QJsonValue::fromVariant(value);if(QJsonDocument(QJsonObject{{"value",json}}).toJson().size()>16384)throw QString("Model value exceeds observation bounds");result["value"]=json;
            }
            return result;
        }
        if(op=="model-reveal"){
            auto page=modelPage(widget,request);auto* view=qobject_cast<QAbstractItemView*>(widget);
            if(page["model"].toArray().isEmpty())throw QString("No row exists at the requested offset");
            view->scrollTo(view->model()->index(page["offset"].toInt(),0,view->rootIndex()),QAbstractItemView::PositionAtCenter);
            return modelPage(widget,request);
        }
        if(op=="activate"&&key.startsWith("native-window-")){
            for(NSWindow* window in NSApp.windows)if(window.visible&&window.windowNumber==key.mid(14).toLongLong()){[window makeKeyAndOrderFront:nil];return {{"activated",key}};}
            throw QString("Native panel window is unavailable");
        }
        if(op=="bug-report-prefill")return prefillBugReport(widget,request);
        if(op=="timeline-point"){
            using TimeX=int(*)(const QWidget*,double);using TrackValue=int(*)(const QWidget*,int);
            auto timeX=reinterpret_cast<TimeX>(dlsym(RTLD_DEFAULT,"_ZNK14TimelineWidget7timeToXEd"));
            auto trackY=reinterpret_cast<TrackValue>(dlsym(RTLD_DEFAULT,"_ZNK14TimelineWidget14trackYForIndexEi"));
            auto trackH=reinterpret_cast<TrackValue>(dlsym(RTLD_DEFAULT,"_ZNK14TimelineWidget11trackHeightEi"));
            const auto indexValue=request["trackIndex"],timeValue=request["timeSeconds"];const int index=indexValue.toInt(-1);const double seconds=timeValue.toDouble(-1);
            if(!timeX||!trackY||!trackH||!widget||!widget->isVisible()||!widget->isEnabled()||QString(widget->metaObject()->className())!="TimelineWidget"||!indexValue.isDouble()||indexValue.toDouble()!=index||index<0||index>=1024||!timeValue.isDouble()||!std::isfinite(seconds)||seconds<0||seconds>8640000)throw QString("Packaged track/time geometry unavailable; use an observed timeline canvas and bounded track index/time");
            const int y=trackY(widget,index);if(y<0)throw QString("Track index is absent from this timeline canvas");const int height=trackH(widget,index);
            const QPoint point(timeX(widget,seconds),y+height/2);const auto visible=widget->visibleRegion();
            if(height<=0||!widget->rect().contains(point)||!visible.contains(point))throw QString("Track/time point is outside the visible canvas; scroll and observe again");
            return {{"trackIndex",index},{"timeSeconds",seconds},{"point",QJsonObject{{"x",point.x()},{"y",point.y()}}},{"method","packaged TimelineWidget::timeToX/trackYForIndex/trackHeight"}};
        }
        if(op=="timeline-clip-rect"){
            using ClipRect=QRect(*)(const QWidget*,const QString&);
            auto geometry=reinterpret_cast<ClipRect>(dlsym(RTLD_DEFAULT,"_ZNK14TimelineWidget11clipRectForERK7QString"));
            const auto clipId=request["clipId"].toString();
            if(!geometry||!widget||!widget->isVisible()||QString(widget->metaObject()->className())!="TimelineWidget"||clipId.isEmpty()||clipId.size()>256)throw QString("Packaged clip geometry unavailable; choose an observed timeline and clip ID");
            // Reuse the packaged painter's public QRect function; never infer its object layout.
            const auto rect=geometry(widget,clipId),visible=rect.intersected(widget->visibleRegion().boundingRect());
            if(rect.isEmpty())throw QString("Clip ID is absent from this timeline widget");
            auto json=[](QRect r){return QJsonObject{{"x",r.x()},{"y",r.y()},{"width",r.width()},{"height",r.height()}};};
            return {{"clipId",clipId},{"rect",json(rect)},{"visibleRect",json(visible)},{"method","packaged TimelineWidget::clipRectFor"}};
        }
        if(op=="quit"){
            if(!widget||!widget->isWindow()||!widget->isVisible()||QString(widget->metaObject()->className())!="MainWindow"||QApplication::activeModalWidget())throw QString("Quit requires the observed main window with no modal dialog");
            NSArray<NSMenuItem*>* items=quitItems(NSApp.mainMenu);if(items.count!=1||!items.firstObject.enabled||!items.firstObject.action)throw QString("Unique enabled Command-Q menu action unavailable");
            NSMenuItem* item=items.firstObject;const QString title=QString::fromNSString(item.title);
            QTimer::singleShot(0,this,[item]{[item.menu performActionForItemAtIndex:[item.menu indexOfItem:item]];});
            return {{"dispatch","native-menu"},{"title",title},{"shortcut","Command-Q"}};
        }
        if(op=="clipboard-save"){
            if(previousClipboard)throw QString("Clipboard already preserved");
            auto copy=std::make_unique<QMimeData>();qint64 bytes=0;const auto* mime=QGuiApplication::clipboard()->mimeData();
            if(mime)for(const auto& format:mime->formats()){const auto data=mime->data(format);bytes+=data.size();if(bytes>16*1024*1024)throw QString("Clipboard exceeds test preservation limit");copy->setData(format,data);}
            previousClipboard=std::move(copy);return {{"preserved",true}};
        }
        if(op=="clipboard-mark"){
            if(!previousClipboard)throw QString("Preserve clipboard before copy");ownedClipboardHash=clipboardHash();
            QJsonArray formats;const auto* mime=QGuiApplication::clipboard()->mimeData();if(mime)for(const auto& f:mime->formats())formats.append(f);return {{"formats",formats}};
        }
        if(op=="clipboard-restore")return {{"restored",restoreClipboard()}};
        if(op=="screenshot"||op=="snapshot-widget"||op=="snapshot-presented"||op=="snapshot-node-preview"){
            if(!widget||!widget->isVisible()||(op=="screenshot"&&!widget->isWindow()))throw QString("Choose an observed visible window or widget");
            const QString name="screen-"+request["id"].toString()+".png";
            QPixmap image;
            if(op=="snapshot-node-preview"){
                auto* view=qobject_cast<QGraphicsView*>(widget);if(!view||!view->scene()||request["label"].toString().isEmpty())throw QString("Observed graph and node label required");
                QList<QGraphicsPixmapItem*> matches;
                for(auto* item:view->scene()->items())if(auto* pix=qgraphicsitem_cast<QGraphicsPixmapItem*>(item);pix&&pix->isVisible()&&pix->pixmap().width()>64&&pix->pixmap().height()>64){
                    auto* node=item;while(node&&!(node->flags()&QGraphicsItem::ItemIsSelectable))node=node->parentItem();if(!node)continue;
                    bool found=false;for(auto* child:node->childItems())if(auto* proxy=qgraphicsitem_cast<QGraphicsProxyWidget*>(child);proxy&&proxy->widget())for(auto* label:proxy->widget()->findChildren<QLabel*>())found|=label->text()==request["label"].toString();
                    if(found)matches.append(pix);
                }
                if(matches.size()!=1)throw QString("Expected one rendered node preview");image=matches.front()->pixmap();
            }else image=op=="snapshot-presented"?presented(widget):widget->grab();
            if(!image.save(root+"/"+name))throw QString("Window capture failed");
            QJsonObject result{{"path",root+"/"+name},{"width",op=="snapshot-node-preview"?image.width():widget->width()},{"height",op=="snapshot-node-preview"?image.height():widget->height()}};
            if(op=="snapshot-widget"||op=="snapshot-presented"||op=="snapshot-node-preview"){
                const auto small=image.toImage().scaled(64,32,Qt::IgnoreAspectRatio,Qt::SmoothTransformation).convertToFormat(QImage::Format_RGB888);
                QByteArray rgb;for(int y=0;y<small.height();y++)rgb.append(reinterpret_cast<const char*>(small.constScanLine(y)),small.width()*3);
                result["sampleRgb"]=QString::fromLatin1(rgb.toBase64());result["sampleWidth"]=small.width();result["sampleHeight"]=small.height();
            }
            return result;
        }
        if(op=="item-click"){
            auto* view=qobject_cast<QAbstractItemView*>(target);int row=request["row"].toInt(-1);
            if(view&&view->model()&&request.contains("text")){row=-1;for(int r=0;r<view->model()->rowCount(view->rootIndex());r++)if(view->model()->data(view->model()->index(r,0,view->rootIndex())).toString()==request["text"].toString()){if(row>=0)throw QString("Ambiguous item text");row=r;}}
            if(!view||!view->isVisible()||!view->isEnabled()||!view->model()||row<0||row>=view->model()->rowCount(view->rootIndex()))throw QString("Invalid visible item row");
            const QPersistentModelIndex index=view->model()->index(row,0,view->rootIndex());const bool twice=request["double"].toBool(),context=request["context"].toBool();
            if(twice&&context)throw QString("Choose open or context menu, not both");
            QTimer::singleShot(0,view,[view,index,twice,context]{if(!index.isValid())return;view->scrollTo(index);view->setFocus();const auto rect=view->visualRect(index);if(!view->viewport()->rect().intersects(rect))return;QTest::mouseClick(view->viewport(),Qt::LeftButton,Qt::NoModifier,rect.center());if(twice)QTest::mouseDClick(view->viewport(),Qt::LeftButton,Qt::NoModifier,rect.center());if(context){QContextMenuEvent event(QContextMenuEvent::Mouse,rect.center(),view->viewport()->mapToGlobal(rect.center()));QApplication::sendEvent(view->viewport(),&event);}});
        }else if(op=="context-click"){
            if(!widget||!widget->isVisible()||!widget->isEnabled())throw QString("Context target unavailable");const QPoint p(qRound(request["x"].toDouble(widget->width()/2.0)),qRound(request["y"].toDouble(widget->height()/2.0)));if(!widget->rect().contains(p))throw QString("Context outside target");
            QTimer::singleShot(0,widget,[widget,p]{QContextMenuEvent event(QContextMenuEvent::Mouse,p,widget->mapToGlobal(p));QApplication::sendEvent(widget,&event);});
        }else if(op=="drop-model-item"){
            auto* source=qobject_cast<QAbstractItemView*>(objects.value(request["source"].toString()));if(!widget||!widget->isVisible()||!source||!source->isVisible()||!source->model())throw QString("Observed drag source and target required");
            int row=-1;for(int r=0;r<source->model()->rowCount(source->rootIndex());r++)if(source->model()->data(source->model()->index(r,0,source->rootIndex())).toString()==request["text"].toString()){if(row>=0)throw QString("Ambiguous drag item");row=r;}if(row<0)throw QString("Drag item absent");
            const auto index=source->model()->index(row,0,source->rootIndex());std::unique_ptr<QMimeData> mime(source->model()->mimeData({index}));if(!mime||mime->formats().isEmpty())throw QString("Source has no drag payload");qint64 bytes=0;QJsonArray formats;for(const auto& f:mime->formats()){bytes+=mime->data(f).size();formats.append(f);}if(bytes>1024*1024)throw QString("Drag payload too large");
            const QPoint p(qRound(request["x"].toDouble(widget->width()/2.0)),qRound(request["y"].toDouble(widget->height()/2.0)));if(!widget->rect().contains(p))throw QString("Drop outside target");QDragEnterEvent enter(p,Qt::CopyAction,mime.get(),Qt::LeftButton,Qt::NoModifier);QApplication::sendEvent(widget,&enter);if(!enter.isAccepted())throw QString("Drop target refused drag entry");QDropEvent drop(QPointF(p),Qt::CopyAction,mime.get(),Qt::LeftButton,Qt::NoModifier);QApplication::sendEvent(widget,&drop);return {{"accepted",drop.isAccepted()},{"formats",formats},{"scope","Application model payload and Qt drop events; not OS pointer drag"}};
        }else if(op=="drag"){
            if(!widget||!widget->isVisible()||!widget->isEnabled())throw QString("Drag target unavailable");const QPoint from(qRound(request["x"].toDouble(-1)),qRound(request["y"].toDouble(-1))),to(qRound(request["toX"].toDouble(-1)),qRound(request["toY"].toDouble(-1)));if(!widget->rect().contains(from)||!widget->rect().contains(to))throw QString("Drag outside target");
            QTimer::singleShot(0,widget,[widget,from,to]{QTest::mousePress(widget,Qt::LeftButton,Qt::NoModifier,from);for(int n=1;n<=10;n++){const auto pos=from+(to-from)*n/10;QMouseEvent event(QEvent::MouseMove,QPointF(pos),QPointF(widget->mapToGlobal(pos)),Qt::NoButton,Qt::LeftButton,Qt::NoModifier);QApplication::sendEvent(widget,&event);}QTest::mouseRelease(widget,Qt::LeftButton,Qt::NoModifier,to);});
        }else if(op=="close-window"){
            if(!widget||!widget->isWindow()||!widget->isVisible())throw QString("Choose a visible top-level window");QTimer::singleShot(0,widget,[widget]{widget->close();});
        }else if(op=="resize-window"){
            if(!widget||!widget->isWindow()||!widget->isVisible()||!widget->screen())throw QString("Choose a visible owned top-level window");
            const int width=request["width"].toInt(-1),height=request["height"].toInt(-1);const auto area=widget->screen()->availableGeometry();
            if(width<200||height<200||width>4096||height>4096||width>area.width()-40||height>area.height()-80||width<widget->minimumWidth()||height<widget->minimumHeight())throw QString("Window size exceeds the observed display or minimum control size");
            widget->resize(width,height);const auto frame=widget->frameGeometry();widget->move(qBound(area.left(),frame.x(),area.right()-frame.width()+1),qBound(area.top(),frame.y(),area.bottom()-frame.height()+1));
            return {{"width",widget->width()},{"height",widget->height()},{"scope","Public QWidget setup; inspect fresh geometry before input"}};
        }else if(op=="activate"){
            if(!widget||!widget->isWindow())throw QString("Choose an observed top-level window");[NSApp activateIgnoringOtherApps:YES];widget->raise();widget->activateWindow();NSView* view=(__bridge NSView*)reinterpret_cast<void*>(widget->winId());[view.window makeKeyAndOrderFront:nil];
        }else if(op=="action"){
            auto* action=qobject_cast<QAction*>(target);if(!action||!action->isEnabled())throw QString("Action unavailable");QTimer::singleShot(0,action,[action]{action->trigger();});
        }else if(op=="click"){
            if(!widget||!widget->isVisible()||!widget->isEnabled())throw QString("Widget unavailable");
            const QPoint p(qRound(request["x"].toDouble(widget->width()/2.0)),qRound(request["y"].toDouble(widget->height()/2.0)));
            if(!widget->rect().contains(p))throw QString("Click outside target");
            const bool twice=request["double"].toBool();QTimer::singleShot(0,widget,[widget,p,twice]{if(twice)QTest::mouseDClick(widget,Qt::LeftButton,Qt::NoModifier,p);else click(widget,p);});
        }else if(op=="type-text"){
            const QString text=request["text"].toString();
            if(!widget||!widget->isVisible()||!widget->isEnabled()||text.isEmpty()||text.size()>1024||text.contains(QRegularExpression("[^\\x20-\\x7e]")))throw QString("Type text requires a visible widget and 1-1024 printable ASCII characters");
            widget->setFocus();QTimer::singleShot(0,widget,[widget,text]{QTest::keyClicks(widget,text);});
        }else if(op=="text"){
            auto* edit=qobject_cast<QLineEdit*>(target);if(!edit||edit->echoMode()!=QLineEdit::Normal||!edit->isEnabled())throw QString("Editable text field unavailable");edit->setFocus();edit->setText(request["text"].toString());
        }else if(op=="key"){
            if(!widget||!widget->isVisible())throw QString("Key target unavailable");
            const auto sequence=QKeySequence::fromString(request["key"].toString(),QKeySequence::PortableText);
            if(sequence.count()!=1)throw QString("Supply one key combination");
            if(sequence[0].key()==Qt::Key_unknown)throw QString("Unsupported key name; use Qt PortableText");
            widget->setFocus();const auto combo=sequence[0];QTimer::singleShot(0,widget,[widget,combo]{QTest::keyClick(widget,combo.key(),combo.keyboardModifiers());});
        }else if(op=="spellbook-run-local"){
            // The adapter admits only an inspected local image -> blur graph.
            if(!widget||!widget->isVisible()||QString(widget->metaObject()->className())!="DetachedGraphPanel")throw QString("Observed Spellbook panel required");
            if(!QMetaObject::invokeMethod(widget,"onRun",Qt::QueuedConnection))throw QString("Spellbook render command unavailable");
        }else if(op=="select"){
            auto* combo=qobject_cast<QComboBox*>(target);int index=request["index"].toInt(-1);
            if(!combo||index<0||index>=combo->count())throw QString("Invalid combo selection");combo->setCurrentIndex(index);emit combo->activated(index);
        }else throw QString("Unsupported test operation");
        return {{"dispatched",true}}; // Dispatch is not a behavioral pass; observe afterward.
    }
public:
    explicit SmokeBridge(QString directory):QObject(qApp),root(std::move(directory)){
        QCoreApplication::setAttribute(Qt::AA_DontUseNativeDialogs); // Only this disposable smoke process.
        connect(qApp,&QCoreApplication::aboutToQuit,this,[this]{restoreClipboard();save("quit-observed.json",{{"pid",qint64(QCoreApplication::applicationPid())},{"generation",generation},{"event","aboutToQuit"}});});
        save("ready.json",{{"cocoaImage",QString::fromUtf8(class_getImageName(objc_getClass("QMacAccessibilityElement")))},{"pid",qint64(QCoreApplication::applicationPid())},{"generation",generation},{"harness",qEnvironmentVariable("WIZ_HARNESS_RUN_ID")},{"settingsFile",QSettings().fileName()},{"settingsFormat",int(QSettings().format())},{"capabilities",capabilities()}});
        auto* timer=new QTimer(this);timer->setInterval(100);
        connect(timer,&QTimer::timeout,this,[this]{
            QFile input(root+"/request.json");if(!input.open(QIODevice::ReadOnly))return;
            const auto bytes=input.read(1024*1024);input.close();const auto request=QJsonDocument::fromJson(bytes).object();
            const auto requestId=request["id"].toString();
            if(!QRegularExpression("^[a-f0-9-]{36}$").match(requestId).hasMatch()){input.rename(root+"/invalid-request.json");return;}
            if(!input.rename(root+"/request-"+requestId+".json"))return;
            QJsonObject result{{"id",requestId},{"generation",generation},{"pid",qint64(QCoreApplication::applicationPid())}};
            try{result["result"]=perform(request);result["ok"]=true;}catch(const QString& error){result["ok"]=false;result["error"]=error;}
            save("response-"+requestId+".json",result);
        });timer->start();
    }
};

class SmokeStylePlugin : public QStylePlugin {
    Q_OBJECT
    Q_PLUGIN_METADATA(IID "org.qt-project.Qt.QStyleFactoryInterface" FILE "smoke-style.json")
public:
    QStyle* create(const QString& key) override {
        if(key.compare("Basic",Qt::CaseInsensitive)!=0)return nullptr;
        const auto root=qEnvironmentVariable("WIZ_SMOKE_CONTROL_DIR");
        if(root.isEmpty()||qEnvironmentVariable("WIZ_HARNESS_RUN_ID").isEmpty()||!QFileInfo(root).isDir())return nullptr;
        const auto settings=qEnvironmentVariable("WIZ_SMOKE_SETTINGS_DIR");
        if(!settings.isEmpty()){
            if(!QDir::isAbsolutePath(settings)||!QFileInfo(settings).isDir())return nullptr;
            // This owned process uses external INI settings, before MainWindow loads them.
            QSettings::setDefaultFormat(QSettings::IniFormat);
            QSettings::setPath(QSettings::IniFormat,QSettings::UserScope,settings);
            QSettings::setPath(QSettings::IniFormat,QSettings::SystemScope,settings);
            QStandardPaths::setTestModeEnabled(true);
        }
        QTimer::singleShot(0,qApp,[root]{new SmokeBridge(root);});
        return QStyleFactory::create("Fusion");
    }
};
#include "bridge.moc"
