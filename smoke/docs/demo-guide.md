# Athanor team demo and first run

Athanor runs a chosen set of Wizard checks and keeps the result, the actions taken and the evidence together. Users and agents use the same catalog, courses and local service.

## Open it

From the Wiz Ops checkout, with Node.js 24 or newer:

```sh
cd smoke
npm run open
```

Choose your browser on first opening and keep the terminal running. No npm packages are needed. If using a supplied bundle, extract it and double-click `Install Athanor.command`; later use the installed `Open Athanor.command`.

A new workspace starts with the test catalog and no run history. Preparation automatically builds and caches the matching external desktop adapter; see [desktop setup](desktop-tools-setup.md) for SDK requirements and agent repair instructions.

## Walk through the app

1. In Run tests, open Find a build. Show Releases, Nightlies and Tagged builds, then use Mine to find builds containing your PRs. Builds can include several PR authors. Filters search all retained metadata. The list starts at 50 per page, with larger pages, All cached builds and Load older available.
2. Choose a compatible build and course. For the short demo, have your agent save `examples/color-regression.json` once through `smoke.mjs course save --file examples/color-regression.json --server URL`. Color regression then appears as a 13-check course; Build engine checks selects 57 checks. All automated checks selects 137 accepted definitions and needs desktop tools and the course's media/model prerequisites. Add a run name if useful.
3. Press Prepare build. Follow the preparation steps until Build ready, then press Start checks. Athanor records course progress in Results.
4. Click a completed test row. Its details open immediately in the right sidebar. Show the expected result, how the check works, Operations used, recorded actions and evidence. Clicking another row updates that sidebar. Close or Escape returns to the table.
5. Open the report to view the saved run independently. Show its filters, evidence and Edit this test prompt. The report stays on this Mac until someone deliberately shares it.
6. In Checks or Test guide, show how an agent can inspect a check and get a context pack for a focused run or edit. Custom courses can combine accepted tests; adding or changing accepted definitions requires lead review.

Choose the build before promising an outcome. Fail, Blocked and Unknown stay visible with their observations and retained evidence.

## Hand the checkout to an agent

Use [the onboarding prompt](../examples/agent-onboarding.txt). The agent starts with AGENTS.md, validates the framework, starts the local service and discovers builds and courses. It uses the printed URL for every CLI command, so a random port works as well as 4317.

The adapter provides application operations and Qt controls; verified macOS input handles paths needing physical gestures. Tests declare their own assertions and evidence. Read [agent tools](agent-tools.md) for direct calls, [test evidence](test-evidence.md) for editing, and [build discovery](build-finder.md) for the shared metadata cache.

## Explain the counts

| Count | Meaning |
| --- | --- |
| 137 | Accepted automated definitions available to courses |
| 57 / 73 / 7 | Engine / desktop / service checks in the full automated course |
| 143 | All scripted definitions, including six candidates |
| 137 original checklist rows | Logan's user paths; these are tracked separately from automated definitions |

Mapped checks can cover part of an original path. The coverage view records that relationship. Fresh supplies the empty starting project; Story-user, Large and NAS are future fixture work. Human handoff is a later workflow.

## Before the demo

Open Athanor on the intended Mac and prepare the selected build and course. For a full run, keep the desktop unlocked. Check media tools and any required speech model. Keep a completed report handy to show details while another course runs.

For a new testing Mac, follow [source handoff](source-handoff.md) and [installation](maintaining-harness.md). Local installation checks are recorded separately from a first smoke run on that Mac.
