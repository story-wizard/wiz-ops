# Human investigation handoff

## Product idea

An automated smoke failure becomes a prepared investigation for a person:

1. Open the failed result and its functional brief.
2. Prepare a disposable project with the same application/CLI/runtime identities and the state needed immediately before the suspect action.
3. Hand the person an Oz context parcel describing the expected behavior, observed failure, exact project binding, and how Oz can assist without performing the action being tested for them.
4. Arm diagnostics suited to the failure. Start with bounded state/UI/log capture; add opt-in tracing or profiling where it answers a concrete question.
5. Record the person's finding beside the immutable automated observation, and assemble an editable bug-report draft.
6. A later course can resume from an explicit accepted checkpoint; a human sign-off must never silently turn the original automated failure into a pass.

## Research follow-up — requested by Charles

Assess whether this complete workflow is distinctive enough to be a Wizard product feature. This is a hypothesis, not a verified uniqueness claim.

Compare existing testing, observability and agent tools for the combination of:

- reproducible setup in the exact application/build;
- a functional brief understandable without engineering context;
- an in-app agent with bounded operations and explicit human ownership of the tested gesture;
- defect-specific diagnostic capture and a prepared bug report;
- linked automated and human evidence with an explicit resume decision.

Look for working products and documented workflows, not just vendor claims. Record what is already common, what the combination improves, and whether Wizard's application-owned CLI/Oz operations provide a practical advantage. An initial public-documentation review is recorded below. No external publication or hands-on competitor evaluation has been performed.

## Fast follow: discover or dispatch a prepared test

Proposed workflow, not an implemented integration. Use the same assignment for a planned human check or investigation of an automated failure.

The same test assignment can be discovered through a direct agent request, a Slack message, the dashboard, or a linked Jira assignment. For example: "What smoke tests are open?", "Show tests assigned to me", or "Prepare a test I can complete on this machine." These entry points resolve to the same assignment ID and versioned test package.

The package holds the build identity, setup recipe, media requirements, readiness checks, human steps, expected results, diagnostic plan, Oz context, and return destination. The dashboard remains the record of test execution and evidence; a linked Jira issue can supply assignment context. Listing tests is read-only. Claiming or preparing a selected test is a separate action, and completing a test does not automatically close its Jira issue.

1. **Discover and claim.** Find a task tied to a course/check and, where applicable, the original failed run. Show its owner, required build, machine requirements, estimated human effort when known, and setup blockers. A tester claims it so two people do not unknowingly work the same assignment, regardless of where they found it.
2. **Prepare locally.** The tester's agent verifies the required build and available capabilities, then creates a disposable project through the shared CLI/Oz operations. Resolve media by logical role, using either hash-verified fixtures or a pinned generation recipe. Keep credentials and machine-specific paths out of the package.
3. **Verify readiness.** Check the resulting media and project state before marking setup ready. Generate fresh local project/asset IDs and session bindings. Equivalent verified test state is the default; byte-identical generated media requires a pinned toolchain or distributed fixture files.
4. **Hand over to Oz.** Open the prepared project and give Oz the brief, expected behavior, local project binding, and bounded helper operations. Oz acknowledges that the correct project is ready before guiding the tester. The tester performs the gesture under investigation.
5. **Collect the finding.** Capture relevant before/after evidence and ask whether the behavior matched expectations, reproduced the issue, was blocked by setup, or remained uncertain. Offer a bug-report draft populated with reproduction steps, build identity, expected/actual behavior, and diagnostic references. Review the draft before any explicitly authorized submission.
6. **Close the loop.** Store the human finding separately from the automated verdict. Return the result in the current agent conversation or dashboard; explicitly authorized external updates can send a compact outcome and evidence link to the originating Slack thread or linked Jira issue. Route an app defect to a bug, a setup problem to the test harness, or an accepted result to an explicit course-resume decision. Interrupted assignments retain their last verified checkpoint.

Illustrative condensed assignment, with a placeholder link:

> **Smoke check: Add and save tracks**
>
> Give your agent this assignment: `<test-task link>`.
> Prepare its required build, media, and project state locally; verify readiness; then hand the brief to Oz to guide me through the check. Capture the result and help me draft a bug report if behavior differs from the expectation.

Start with a portable package that a person can give their agent directly or share as a link. Add discovery of open and assigned cases, recipient-agent bootstrap, acknowledged Oz handoff, and result return next. Slack/Jira integrations and automatic course resumption can follow once that round trip works reliably. External message or issue text alone must not authorize arbitrary commands, uploads, or publication.

## Initial market assessment, September 25, 2026

The broad process is already commercialized in overlapping products. We should retire the claim that combining agents, automated tests, human investigation, and issue tracking is unique. The narrower hypothesis is that Wizard can make a local native-app investigation unusually easy by preparing verified media/project state and handing the actual project to Oz and a person.

### Closest documented overlaps

| Product | Documented overlap | Implication |
| --- | --- | --- |
| [QA.tech MCP](https://docs.qa.tech/integrations/mcp) and [Slack integration](https://docs.qa.tech/integrations/slack) | Coding agents can list test cases, start runs, inspect issues and execution traces. Slack connects to testing workflows. Its [changelog](https://qa.tech/changelog/2026-08-04) also documents TestRail/Xray discovery and Jira search in chat. | Agent-first discovery and dispatch are already product features. |
| [Qt Test Center 4.4](https://www.qt.io/quality-assurance/blog/test-center-4.4-connects-your-test-results-to-ai-and-further-expands-test-plan-features) and [Squish for Qt](https://www.qt.io/quality-assurance/squish/platform-qt-gui-test-automation) | Results API/MCP, manual tester assignment, test plans, and native Qt object-aware automation. | Particularly relevant existing tools for Wizard; Qt-aware control is not unique either. |
| [Tricentis qTest](https://www.tricentis.com/products/unified-test-management-qtest) | Centralized manual/exploratory/automated testing, automation orchestration, Jira integration, Slack/Teams workflows, and recorded exploratory sessions. | A hybrid course and its coordination have established commercial equivalents. |
| [Testlio fused testing](https://www.testlio.com/blog/manual-automated-testing) | Combines automation with human testing and investigation through a managed service. | The process can be sold as a service, with people absorbing integration and judgment work. |
| [BrowserStack failure analysis](https://www.browserstack.com/docs/test-reporting-and-analytics/agents/test-failure-analysis) | Uses logs, screenshots, and metadata to propose failure explanations, distinguish categories, and support Jira reporting. | Diagnostic summaries and bug-report assistance are already offered. Accuracy was not independently evaluated here. |
| [Microsoft Magentic-UI](https://www.microsoft.com/en-us/research/blog/magentic-ui-an-experimental-human-centered-web-agent/) | Research prototype for human-agent collaboration and intervention. | Agent/human shared control also has prior implementations, though this is not a packaged testing product. |

These sources do not establish an off-the-shelf implementation of our exact local-media setup, Oz guidance, and evidence-linked resume flow. That is an unverified gap, not proof of uniqueness. Vendor documentation establishes advertised/documented behavior, not successful operation in Wizard.

### What could make this fail

- **The adapters cost more than they save.** Each application has its own project state, media, credentials, and version compatibility. Wizard ownership makes this practical internally; a general product could become a custom integration service. QA.tech's own [POC checklist](https://docs.qa.tech/getting-started/poc-setup-checklist) still requires teams to prepare accounts, reachable environments, seeded data, and repeatable state.
- **Setup changes the defect.** A clean Golden Project can remove the corrupt state, cache history, timing, or real-media condition responsible for a failure. Preserve the original evidence and label fresh setups as reproductions with explicit differences.
- **The test agrees with its own implementation.** A CLI operation returning success does not prove the corresponding UI works. Keep a human or independent observable check for the behavior under test, and validate checks against known failures.
- **The handoff is unreliable.** Wrong build, expired session, wrong project, duplicate claim, or interrupted setup can invalidate the finding. Readiness assertions and explicit ownership matter more than conversational fluency.
- **Human review becomes a queue or a rubber stamp.** Someone still owns expected behavior and triage. Present the task neutrally, ask for observations before suggesting a diagnosis, and retain uncertainty.
- **The integration is easy to copy.** Slack, Jira, MCP, prompts, and dashboards provide weak differentiation. Reusable state recipes, reliable app operations, and demonstrated reductions in investigation effort are stronger assets.

### Product decision to validate

Continue as a Wizard capability with a narrow promise: a teammate can reach the right test state, perform the check, and return useful evidence with little expert assistance. Treat a standalone product as unproven.

Compare several existing checklist-based checks with prepared handoffs on another tester's Mac. Include a normal pass, a known app failure, and a setup/environment failure. Measure active human time, time to first useful action, setup success without author help, report usefulness, false conclusions, and recipe maintenance across a build change. Only broaden the product if the savings survive that comparison. Validate portability to a second application before claiming a general platform.
