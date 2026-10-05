#pragma once
#include <QtWidgets>

// Draft-only interoperability. Validate every field before changing any control.
inline QJsonObject prefillBugReport(QWidget* dialog,const QJsonObject& request){
    if(!dialog||!dialog->isWindow()||!dialog->isVisible()||dialog->objectName()!="BugReportDialog")
        throw QString("Observed Report Bug dialog required");
    auto summary=dialog->findChildren<QLineEdit*>("BugReportSummary");
    auto steps=dialog->findChildren<QPlainTextEdit*>("BugReportSteps");
    auto expected=dialog->findChildren<QPlainTextEdit*>("BugReportExpected");
    if(summary.size()!=1||steps.size()!=1||expected.size()!=1)
        throw QString("Report Bug controls are absent or ambiguous");
    auto* a=summary.front();auto* b=steps.front();auto* c=expected.front();
    if(!a->isEnabled()||a->isReadOnly()||a->echoMode()!=QLineEdit::Normal||!b->isEnabled()||b->isReadOnly()||!c->isEnabled()||c->isReadOnly())
        throw QString("Report Bug is busy or contains a frozen pending report");
    const auto s=request["summary"].toString(),r=request["reproduction_steps"].toString(),e=request["expected_result"].toString();
    if(s.trimmed().isEmpty()||s.size()>qMin(256,a->maxLength())||r.trimmed().isEmpty()||r.size()>16000||e.trimmed().isEmpty()||e.size()>16000)
        throw QString("Reporter fields are missing or exceed their limits");
    const bool same=a->text()==s&&b->toPlainText()==r&&c->toPlainText()==e;
    if(!same&&(!a->text().isEmpty()||!b->toPlainText().isEmpty()||!c->toPlainText().isEmpty()))
        throw QString("Preserve the existing Report Bug draft");
    if(!same){a->setText(s);b->setPlainText(r);c->setPlainText(e);}
    const bool observed=a->text()==s&&b->toPlainText()==r&&c->toPlainText()==e;
    return {{"state",observed?"Prefilled":"Unknown"},{"summary",a->text()},{"reproduction_steps",b->toPlainText()},{"expected_result",c->toPlainText()},{"submitted",false}};
}
