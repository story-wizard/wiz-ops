// Test-only Qt plugin. The style factory provides a startup hook; Wizard replaces
// the returned style with its normal WizStyle. No macOS accessibility calls.
#include <QtWidgets>
#include <QtTest/QTest>
#include <QStylePlugin>
#include <QSaveFile>
#include <QUuid>
#include <objc/runtime.h>
#include <objc/message.h>
#include <ApplicationServices/ApplicationServices.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>

class SmokeBridge : public QObject {
    QString root, generation=QUuid::createUuid().toString(QUuid::WithoutBraces);
    QHash<QString,QPointer<QObject>> objects;
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
        const auto pos=widget->mapTo(window,QPoint{});const auto frame=window->frameGeometry();const double scale=double(image.width())/frame.width();
        const int title=window->geometry().top()-frame.top();const QRect crop(qRound(pos.x()*scale),qRound((pos.y()+title)*scale),qRound(widget->width()*scale),qRound(widget->height()*scale));
        if(!image.rect().contains(crop))throw QString("Preview crop outside owned window");return QPixmap::fromImage(image.copy(crop));
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
    QJsonObject inspect(){
        QJsonArray widgets,actions;QSet<QAction*> seen;
        for(auto* w:QApplication::allWidgets()){
            if(!w->isVisible())continue;
            QJsonObject item{{"active",w->isActiveWindow()},{"id",id(w)},{"class",w->metaObject()->className()},{"name",w->objectName()},{"tooltip",w->toolTip()},{"parent",w->parentWidget()?id(w->parentWidget()):QString()},{"enabled",w->isEnabled()},{"title",w->windowTitle()},{"window",id(w->window())},{"width",w->width()},{"height",w->height()}};
            const auto pos=w->mapTo(w->window(),QPoint{});item["x"]=pos.x();item["y"]=pos.y();
            for(auto* owner=w;owner;owner=owner->parentWidget())if(auto* proxy=owner->graphicsProxyWidget();proxy&&proxy->scene()&&!proxy->scene()->views().isEmpty()){item["graphView"]=id(proxy->scene()->views().front());break;}
            if(auto* p=qobject_cast<QLabel*>(w))item["text"]=p->text();
            if(auto* p=qobject_cast<QAbstractButton*>(w)){item["text"]=p->text();item["checked"]=p->isChecked();}
            if(auto* p=qobject_cast<QLineEdit*>(w);p&&p->echoMode()==QLineEdit::Normal)item["text"]=p->text();
            if(auto* p=qobject_cast<QPlainTextEdit*>(w);p&&p->isReadOnly())item["text"]=p->toPlainText().right(32768);
            if(auto* p=qobject_cast<QAbstractSpinBox*>(w))item["text"]=p->text();
            if(auto* p=qobject_cast<QAbstractSlider*>(w)){item["value"]=p->value();item["minimum"]=p->minimum();item["maximum"]=p->maximum();item["orientation"]=p->orientation()==Qt::Horizontal?"horizontal":"vertical";}
            if(auto* p=qobject_cast<QSlider*>(w)){QStyleOptionSlider opt;opt.initFrom(p);opt.orientation=p->orientation();opt.minimum=p->minimum();opt.maximum=p->maximum();opt.upsideDown=p->invertedAppearance();auto center=[&](int value){opt.sliderPosition=value;opt.sliderValue=value;return p->style()->subControlRect(QStyle::CC_Slider,&opt,QStyle::SC_SliderHandle,p).center();};auto point=[](QPoint v){return QJsonArray{v.x(),v.y()};};item["handle"]=point(center(p->value()));item["minHandle"]=point(center(p->minimum()));item["maxHandle"]=point(center(p->maximum()));const auto groove=p->style()->subControlRect(QStyle::CC_Slider,&opt,QStyle::SC_SliderGroove,p);item["groove"]=QJsonArray{groove.x(),groove.y(),groove.width(),groove.height()};}
            if(auto* p=qobject_cast<QTextEdit*>(w)){item["text"]=p->toPlainText().left(32768);item["html"]=p->toHtml().left(65536);}
            if(auto* p=qobject_cast<QGraphicsView*>(w);p&&p->scene()){QJsonArray entries;for(auto* g:p->scene()->items()){if(entries.size()>=256)break;QString text;if(auto* t=qgraphicsitem_cast<QGraphicsTextItem*>(g))text=t->toPlainText();if(auto* t=qgraphicsitem_cast<QGraphicsSimpleTextItem*>(g))text=t->text();if(text.isEmpty())continue;auto r=p->mapFromScene(g->sceneBoundingRect()).boundingRect();entries.append(QJsonObject{{"text",text},{"x",r.x()},{"y",r.y()},{"width",r.width()},{"height",r.height()}});}item["sceneText"]=entries;item["viewport"]=id(p->viewport());}

            if(auto* p=qobject_cast<QComboBox*>(w)){QJsonArray entries;for(int i=0;i<p->count();i++)entries.append(p->itemText(i));item["items"]=entries;item["index"]=p->currentIndex();}
            if(auto* p=qobject_cast<QGraphicsView*>(w);p&&p->scene()){QJsonArray entries;for(auto* g:p->scene()->items()){if(entries.size()>=128)break;if(!(g->flags()&QGraphicsItem::ItemIsSelectable))continue;QJsonArray labels;for(auto* child:g->childItems())if(auto* proxy=qgraphicsitem_cast<QGraphicsProxyWidget*>(child);proxy&&proxy->widget())for(auto* label:proxy->widget()->findChildren<QLabel*>())labels.append(label->text());const auto r=p->mapFromScene(g->sceneBoundingRect()).boundingRect();entries.append(QJsonObject{{"labels",labels},{"selected",g->isSelected()},{"x",r.x()},{"y",r.y()},{"width",r.width()},{"height",r.height()}});}item["sceneItems"]=entries;}
            if(auto* p=qobject_cast<QTabBar*>(w)){QJsonArray entries;for(int i=0;i<p->count();i++)entries.append(p->tabText(i));item["tabs"]=entries;item["index"]=p->currentIndex();QJsonArray rects;for(int i=0;i<p->count();i++){const auto r=p->tabRect(i);QWidget* close=p->tabButton(i,QTabBar::RightSide);if(!close)close=p->tabButton(i,QTabBar::LeftSide);rects.append(QJsonObject{{"text",p->tabText(i)},{"x",r.x()},{"y",r.y()},{"width",r.width()},{"height",r.height()},{"close",close&&close->isVisible()?id(close):QString()}});}item["tabRects"]=rects;}
            if(auto* p=qobject_cast<QMenu*>(w)){QJsonArray entries;for(auto* a:p->actions()){const auto r=p->actionGeometry(a);entries.append(QJsonObject{{"text",a->text()},{"enabled",a->isEnabled()},{"x",r.x()},{"y",r.y()},{"width",r.width()},{"height",r.height()}});}item["menuItems"]=entries;}
            if(auto* p=qobject_cast<QAbstractItemView*>(w);p&&p->model()){
                QJsonArray rows;auto* m=p->model();item["rows"]=m->rowCount(p->rootIndex());
                for(int r=0;r<qMin(64,m->rowCount(p->rootIndex()));r++){QJsonArray cols;for(int col=0;col<qMin(6,m->columnCount(p->rootIndex()));col++)cols.append(m->data(m->index(r,col,p->rootIndex())).toString());rows.append(cols);}item["model"]=rows;item["viewport"]=id(p->viewport());item["currentRow"]=p->currentIndex().row();QJsonArray selected;for(const auto& index:p->selectionModel()->selectedRows())selected.append(index.row());item["selectedRows"]=selected;
                QJsonArray rects;for(int r=0;r<qMin(64,m->rowCount(p->rootIndex()));r++){auto rect=p->visualRect(m->index(r,0,p->rootIndex()));rects.append(QJsonObject{{"row",r},{"x",rect.x()},{"y",rect.y()},{"width",rect.width()},{"height",rect.height()}});}item["itemRects"]=rects;
            }
            widgets.append(item);
            for(auto* a:w->findChildren<QAction*>())if(!seen.contains(a)){seen.insert(a);actions.append(QJsonObject{{"id",id(a)},{"text",a->text()},{"name",a->objectName()},{"enabled",a->isEnabled()},{"shortcut",a->shortcut().toString()}});}
        }
        return {{"widgets",widgets},{"actions",actions},{"focus",qApp->focusWidget()?id(qApp->focusWidget()):QString()}};
    }
    QJsonObject perform(const QJsonObject& request){
        if(request["generation"].toString()!=generation)throw QString("Stale GUI generation");
        const auto op=request["op"].toString(),key=request["target"].toString();
        QObject* target=objects.value(key);auto* widget=qobject_cast<QWidget*>(target);
        if(op=="inspect")return inspect();
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
        connect(qApp,&QCoreApplication::aboutToQuit,this,[this]{restoreClipboard();});
        save("ready.json",{{"cocoaImage",QString::fromUtf8(class_getImageName(objc_getClass("QMacAccessibilityElement")))},{"pid",qint64(QCoreApplication::applicationPid())},{"generation",generation},{"harness",qEnvironmentVariable("WIZ_HARNESS_RUN_ID")}});
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
        QTimer::singleShot(0,qApp,[root]{new SmokeBridge(root);});
        return QStyleFactory::create("Fusion");
    }
};
#include "bridge.moc"
