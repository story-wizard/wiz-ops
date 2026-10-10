# Agent Workspace pipeline checks

`D-AGENT-PIPELINE-CONFIG` tests whether a picker request reaches the shared
ChatIngestPipeline. It reads the pipeline's selected model and effort separately
from the controller's displayed choices. A matching label alone cannot pass it.

The candidate requests Luna, Low, Max and Sol through the packaged controller.
It verifies each result, the same pipeline identity, preserved effort after a
model change, and absence of a live worker. It submits no chat message.

## Application contract

The Qt adapter calls the application-owned
`automationAgentConfiguration()` method through Qt's meta-object API. Version 1
returns `model`, `effort`, `spawnSuppressed`, `agentActive` and `running`.
Model and effort come from the existing diagnostic snapshot. No private memory
layout or inferred picker state is used.

The dedicated candidate group launches its disposable app with
`WIZARD_AUTOMATION_AGENT_FIXTURE=1`. A supporting build suppresses Oz spawning
in the pipeline constructor, before UI startup. Ordinary groups omit the flag.
Suppression lasts for that app instance; there is no adapter operation to turn
it off in the middle of a test.

An older build returns `available: false` from the adapter query. The candidate
records Blocked before requesting a selection. It requires a package containing
the supporting Wizard patch. Framework or component passes do not substitute
for that package qualification.

## Agent tools

Use an owned session and an observed AgentWorkspacePanel target:

```json
{"operation":"workspace-pipeline-inspect","params":{"target":"OBSERVED_PANEL_ID"}}
```

The read-only response includes availability and the observed pipeline identity.
After an idle, suppressed launch, a typed selection request is available:

```json
{"operation":"workspace-request-selection","params":{"target":"OBSERVED_PANEL_ID","kind":"effort","index":4}}
```

Read the current options first. The adapter rejects disabled, missing or
out-of-range choices, active pipelines, and overlapping local model/header
fixtures. Never assume a picker index means the same model across builds.
The maintained candidate binds known labels to exact expected model IDs and
checks effort separately. Inspect a changed catalog before adapting the test.

Keep the package, schema, adapter, course and request identities with the result.
After an uncertain selection response, inspect its retained request instead of
replaying it. A dedicated fixture is closed with its owned app; it does not
change the developer's current Wizard session.

Reopened panels, provider-lock behavior, rejected disabled choices and actual
worker launch payloads remain separate assertions in the source inventory.
