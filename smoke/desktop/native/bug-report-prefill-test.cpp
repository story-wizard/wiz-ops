// Component probe: Qt offscreen widgets only; never launches Wizard or submits.
#include "bug-report-prefill.h"
#include <cassert>
int main(int argc,char** argv){
    QApplication app(argc,argv);
    QDialog dialog;dialog.setObjectName("BugReportDialog");
    auto* layout=new QVBoxLayout(&dialog);
    auto* summary=new QLineEdit(&dialog);summary->setObjectName("BugReportSummary");summary->setMaxLength(256);
    auto* steps=new QPlainTextEdit(&dialog);steps->setObjectName("BugReportSteps");
    auto* expected=new QPlainTextEdit(&dialog);expected->setObjectName("BugReportExpected");
    auto* submit=new QPushButton("Submit",&dialog);submit->setObjectName("BugReportSubmit");
    for(auto* w:QList<QWidget*>{summary,steps,expected,submit})layout->addWidget(w);
    int submits=0;QObject::connect(submit,&QPushButton::clicked,[&]{submits++;});dialog.show();
    const QJsonObject fields{{"summary","A clip loses its name"},{"reproduction_steps","Duplicate\nSave\nReopen"},{"expected_result","Two independent names"}};
    auto result=prefillBugReport(&dialog,fields);assert(result["state"]=="Prefilled"&&result["submitted"]==false);
    assert(summary->text()=="A clip loses its name"&&steps->toPlainText()=="Duplicate\nSave\nReopen"&&expected->toPlainText()=="Two independent names");
    prefillBugReport(&dialog,fields);assert(submits==0);
    auto reject=[&](QJsonObject input){const auto a=summary->text(),b=steps->toPlainText(),c=expected->toPlainText();bool blocked=false;try{prefillBugReport(&dialog,input);}catch(const QString&){blocked=true;}assert(blocked&&summary->text()==a&&steps->toPlainText()==b&&expected->toPlainText()==c&&submits==0);};
    auto changed=fields;changed["summary"]="Another report";reject(changed); // Preserve a manual draft.
    summary->clear();steps->clear();expected->clear();
    auto large=fields;large["summary"]=QString(257,'x');reject(large); // Validate every field before any write.
    steps->setReadOnly(true);reject(fields);steps->setReadOnly(false); // Preserve recovered pending reports.
    summary->setEchoMode(QLineEdit::Password);reject(fields);summary->setEchoMode(QLineEdit::Normal);
    expected->setObjectName("UnknownExpected");reject(fields);expected->setObjectName("BugReportExpected");
    auto* duplicate=new QLineEdit(&dialog);duplicate->setObjectName("BugReportSummary");reject(fields);delete duplicate;
    auto mutate=QObject::connect(summary,&QLineEdit::textChanged,[&](const QString& s){if(s=="A clip loses its name")summary->setMaxLength(3);});
    result=prefillBugReport(&dialog,fields);assert(result["state"]=="Unknown"&&submits==0);QObject::disconnect(mutate);
    qInfo("Draft prefill, preservation, bounds, ambiguity, readback and no-submit guards passed.");
}
