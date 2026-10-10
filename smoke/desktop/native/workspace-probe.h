#pragma once
#include <QQuickView>
#include <QQuickItem>
#include <QQuickTextDocument>
#include <QQmlComponent>
#include <QTextBlock>
#include <QTextFragment>

// Typed fixture seams and bounded reads on the owned packaged panel; no script evaluation.
struct WorkspaceProbe {
    QQuickView* view=nullptr;
    QObject* controller=nullptr;
    QWidget* container=nullptr;
    explicit WorkspaceProbe(QWidget* panel) {
        if(!panel||!panel->isVisible()||QString(panel->metaObject()->className())!="AgentWorkspacePanel")throw QString("Observe a visible AgentWorkspacePanel first");
        container=panel->findChild<QWidget*>("AgentWorkspaceQuickContainer");
        for(auto* window:QGuiApplication::allWindows())if(auto* candidate=qobject_cast<QQuickView*>(window);candidate&&candidate->objectName()=="AgentWorkspaceQuickView"&&candidate->rootObject()){
            auto* owner=candidate->rootObject()->property("workspace").value<QObject*>();
            bool belongs=false;for(auto* p=candidate->parent();p;p=p->parent())if(p==panel->window()->windowHandle()){belongs=true;break;}
            belongs=belongs&&container&&candidate->isVisible()&&candidate->mapToGlobal(QPoint{})==container->mapToGlobal(QPoint{})&&candidate->width()==container->width()&&candidate->height()==container->height()&&owner&&QString(owner->metaObject()->className())=="AgentWorkspaceController";
            if(belongs){if(view)throw QString("Ambiguous workspace surface");view=candidate;controller=owner;}
        }
        if(!view||!container||!container->isVisible()||!controller||view->status()!=QQuickView::Ready)throw QString("Owned workspace Quick surface is unavailable");
    }
    QList<QQuickItem*> items() const {
        QList<QQuickItem*> all,pending{view->rootObject()};
        while(!pending.isEmpty()){
            if(all.size()>=8192)throw QString("Workspace visual tree exceeds observation bounds");
            auto* item=pending.takeFirst();all.append(item);pending.append(item->childItems());
        }
        return all;
    }
    QQuickItem* named(const QString& name) const {
        QQuickItem* found=nullptr;
        for(auto* item:items())if(item->objectName()==name){if(found)throw QString("Ambiguous workspace item");found=item;}
        if(!found)throw QString("Workspace item unavailable: ")+name;return found;
    }
    QJsonObject inspect(QWidget* panel) const {
        QJsonArray result;const auto offset=container->mapTo(panel,QPoint{});
        for(auto* item:items()){
            if(!QStringList{"AgentWorkspaceMessageList","AgentWorkspaceModelSelector","AgentWorkspaceEffortSelector","AgentWorkspaceTitleSlot","AgentWorkspaceTitleText","AgentWorkspaceEventMenu","AgentWorkspaceCancelButton","AgentWorkspaceMessageBody"}.contains(item->objectName()))continue;
            const auto point=item->mapToScene(QPointF{});
            QJsonObject row{{"name",item->objectName()},{"visible",item->isVisible()},{"enabled",item->isEnabled()},{"x",point.x()+offset.x()},{"y",point.y()+offset.y()},{"localX",item->x()},{"localY",item->y()},{"width",item->width()},{"height",item->height()},{"parentWidth",item->parentItem()?item->parentItem()->width():0},{"focus",item->hasActiveFocus()}};
            for(const char* key:{"text","displayText","contentY","contentHeight","originY","bottomMargin","atYEnd","followTail","count","hovered","open","truncated","currentIndex","disabledIndices"}){
                const auto value=item->property(key);if(value.isValid()){auto json=QJsonValue::fromVariant(value);if(QJsonDocument(QJsonObject{{"v",json}}).toJson().size()>16384)throw QString("Workspace property exceeds observation bounds");row[key]=json;}
            }
            if(item->objectName()=="AgentWorkspaceModelSelector"||item->objectName()=="AgentWorkspaceEffortSelector"){
                QQmlComponent probe(view->engine());
                probe.setData("import QtQuick\nimport QtQuick.Controls\nQtObject { required property var control; readonly property string description: control.Accessible.description; readonly property bool tooltipVisible: control.ToolTip.visible }",QUrl());
                std::unique_ptr<QObject> object(probe.createWithInitialProperties({{"control",QVariant::fromValue(item)}}));
                if(!object)throw QString("Workspace accessibility property probe failed");row["accessibleDescription"]=object->property("description").toString();row["tooltipVisible"]=object->property("tooltipVisible").toBool();
            }
            if(item->objectName()=="AgentWorkspaceMessageBody"){
                auto* quickDocument=item->property("textDocument").value<QQuickTextDocument*>();QJsonArray images;int fragments=0;
                if(quickDocument)for(auto block=quickDocument->textDocument()->begin();block.isValid();block=block.next())for(auto fragment=block.begin();!fragment.atEnd();++fragment){
                    if(++fragments>4096)throw QString("Workspace document exceeds observation bounds");auto part=fragment.fragment();if(!part.isValid()||!part.charFormat().isImageFormat())continue;
                    auto format=part.charFormat().toImageFormat();auto image=qvariant_cast<QImage>(quickDocument->textDocument()->resource(QTextDocument::ImageResource,QUrl(format.name())));
                    images.append(QJsonObject{{"name",format.name()},{"width",format.width()},{"height",format.height()},{"resourceAvailable",!image.isNull()},{"cornerAlpha",image.isNull()?-1:image.pixelColor(0,0).alpha()}});
                }
                row["images"]=images;
            }
            result.append(row);
        }
        QJsonObject state;for(const char* key:{"modelOptions","currentModelIndex","effortOptions","currentEffortIndex","effortEnabled","disabledModelIndices","cancelVisible","chatEvents"})state[key]=QJsonValue::fromVariant(controller->property(key));
        if(result.size()>256)throw QString("Named workspace items exceed observation bounds");
        return {{"items",result},{"controller",state},{"complete",true},{"surface",view->objectName()},{"setupScope","Direct packaged Qt Quick state; no provider execution"}};
    }
    void append(QWidget* panel,const QJsonObject& request) const {
        const auto text=request["text"].toString(),event=request["eventId"].toString();
        if(text.isEmpty()||text.size()>4096||!event.startsWith("athanor-fixture-")||event.size()>100||text.contains("://"))throw QString("Use bounded local fixture text and an athanor-fixture event ID");
        if(text.contains(QRegularExpression("<[^>]+>")))throw QString("Fixture text cannot contain HTML");
        auto references=QRegularExpression(R"(!?\[[^\]]*\]\(([^)]*)\))").globalMatch(text);
        const QRegularExpression imagePath(R"(^assets/context/images/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.png$)");
        while(references.hasNext()){const auto reference=references.next().captured(1);if(!imagePath.match(reference).hasMatch()||reference.contains(".."))throw QString("Fixture references must be local project-relative PNG images");}
        QList<QObject*> histories;for(auto* window:QApplication::topLevelWidgets())if(QString(window->metaObject()->className())=="MainWindow")for(auto* object:window->findChildren<QObject*>())if(QString(object->metaObject()->className())=="ChatHistory")histories.append(object);
        using Append=void(*)(QObject*,const QString&,bool,const QString&);
        auto call=reinterpret_cast<Append>(dlsym(RTLD_DEFAULT,"_ZN11ChatHistory18appendAgentMessageERK7QStringbS2_"));
        if(histories.size()!=1||!call)throw QString("Reviewed three-argument ChatHistory append API unavailable; no fixture was appended");
        call(histories.first(),text,true,event);
    }
    void hover(const QJsonObject& request) const {
        const auto name=request["name"].toString();if(name!="AgentWorkspaceModelSelector"&&name!="AgentWorkspaceEffortSelector")throw QString("Hover requires a model or effort selector");
        auto* item=named(name);if(!item->isVisible()||!item->isEnabled())throw QString("Workspace selector is unavailable");
        QTest::mouseMove(view,item->mapToScene(QPointF(item->width()/2,item->height()/2)).toPoint());
    }
    void header(const QJsonObject& request) const {
        const auto phase=request["phase"].toString();if(phase!="begin"&&phase!="end"&&phase!="hide-cancel")throw QString("Choose begin, hide-cancel or end for the owned header fixture");
        using Options=void(*)(QObject*,const QStringList&);using Index=void(*)(QObject*,int);using Cancel=void(*)(QObject*,bool);using Event=void(*)(QObject*,const QString&,const QString&,const QString&,const QVariantMap&);
        auto models=reinterpret_cast<Options>(dlsym(RTLD_DEFAULT,"_ZN24AgentWorkspaceController15setModelOptionsERK5QListI7QStringE"));
        auto efforts=reinterpret_cast<Options>(dlsym(RTLD_DEFAULT,"_ZN24AgentWorkspaceController16setEffortOptionsERK5QListI7QStringE"));
        auto modelIndex=reinterpret_cast<Index>(dlsym(RTLD_DEFAULT,"_ZN24AgentWorkspaceController20setCurrentModelIndexEi"));
        auto effortIndex=reinterpret_cast<Index>(dlsym(RTLD_DEFAULT,"_ZN24AgentWorkspaceController21setCurrentEffortIndexEi"));
        auto cancel=reinterpret_cast<Cancel>(dlsym(RTLD_DEFAULT,"_ZN24AgentWorkspaceController16setCancelVisibleEb"));
        auto event=reinterpret_cast<Event>(dlsym(RTLD_DEFAULT,"_ZN24AgentWorkspaceController17upsertOzChatEventERK7QStringS2_S2_RK4QMapIS0_8QVariantE"));
        if(!models||!efforts||!modelIndex||!effortIndex||!cancel||!event)throw QString("Reviewed header fixture API unavailable; no state was changed");
        auto backup=controller->property("_athanor_header_fixture").toMap();
        if(phase=="hide-cancel"){if(backup.isEmpty())throw QString("Begin the local header fixture before hiding Cancel");cancel(controller,false);return;}
        if(phase=="begin"){
            if(!backup.isEmpty())throw QString("Header fixture already active; restore it first");
            for(const char* key:{"modelOptions","currentModelIndex","effortOptions","currentEffortIndex","cancelVisible"})backup[key]=controller->property(key);
            controller->setProperty("_athanor_header_fixture",backup);models(controller,{"GPT-6 Luna"});modelIndex(controller,0);efforts(controller,{"Low"});effortIndex(controller,0);event(controller,"athanor-fixture-header","running","Build a rough cut",{});cancel(controller,true);
        }else{
            if(backup.isEmpty())throw QString("Header fixture has no retained restoration state");
            models(controller,backup["modelOptions"].toStringList());modelIndex(controller,backup["currentModelIndex"].toInt());efforts(controller,backup["effortOptions"].toStringList());effortIndex(controller,backup["currentEffortIndex"].toInt());cancel(controller,backup["cancelVisible"].toBool());event(controller,"athanor-fixture-header","complete","Build a rough cut",{});controller->setProperty("_athanor_header_fixture",QVariant());
        }
    }
    void imageWidth(const QJsonObject& request) const {
        const auto width=request["width"].toDouble();if(!request["width"].isDouble()||!std::isfinite(width)||width<80||width>800)throw QString("Use a fixture image width from 80 to 800");
        QQuickItem* body=nullptr;
        for(auto* candidate:items())if(candidate->objectName()=="AgentWorkspaceMessageBody"){
            auto* doc=candidate->property("textDocument").value<QQuickTextDocument*>();if(!doc)continue;
            bool image=false;int fragments=0;
            for(auto block=doc->textDocument()->begin();block.isValid()&&!image;block=block.next())for(auto it=block.begin();!it.atEnd();++it){if(++fragments>4096)throw QString("Image document exceeds observation bounds");if(it.fragment().charFormat().isImageFormat()){image=true;break;}}
            if(image){if(body)throw QString("Ambiguous inline image body");body=candidate;}
        }
        if(!body||body->metaObject()->indexOfMethod("applyMarkdownImageSizing()")<0)throw QString("Local image or packaged sizing method unavailable");
        body->setWidth(width);if(!QMetaObject::invokeMethod(body,"applyMarkdownImageSizing"))throw QString("Packaged image sizing call rejected");
    }
};
