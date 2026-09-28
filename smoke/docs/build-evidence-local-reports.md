# Packaged build, evidence and local report slice

September 27, 2026. WIZ-504–509 and the local portion of WIZ-512. Human handoff, remote build integration, external publication and destination selection are deferred for this slice.

## Outcome and acceptance scenarios

A developer can prepare an explicit retained Wizard app, inspect readiness, start its frozen packaged-engine course, and deliver a readable report locally. Existing Node, SQLite, course definitions and fixture recipes remain the execution authority.

- Given a prepared app and its plan hash, starting the course admits that exact plan. A different app or stale hash is rejected before a run starts.
- Given a stopped worker, Tower observes Unknown and blocked remaining checks instead of an indefinitely active job. No uncertain mutation is replayed.
- Given completed or interrupted execution, exporting a report preserves the original outcomes and flags missing or inconsistent evidence. Repeating the export neither reruns the course nor creates another identical report.
- Given duplicate fixture identities or altered bytes, fixture validation fails. Original source rows and remaining coverage stay visible.

## Run the selected package

Use the existing local smoke server. Replace the app path and operator with the intended values.

```sh
npm run smoke:prepare -- --app /path/to/Retained/Wizard.app
npm run smoke:preflight
```

Preparation records the exact package, operation schema, runner, course, media and cached speech-model identities. The preflight command prints the plan hash. It does not run a smoke test.

```sh
npm run smoke:run -- --app /path/to/Retained/Wizard.app --plan-hash HASH_FROM_PREFLIGHT --operator "Tester name"
```

The new command uses the same local server admission route as the dashboard. Its returned run ID means admitted, not passed. The worker repeats preflight before launching Wizard. A lost start response is Unknown and is not automatically retried.

Preparation remains a CLI action in this slice. Named subsets and explicit runtime inputs are available through the agent CLI. Build-server dispatch remains separate. Keep normal builds unchanged; the eventual optional Build + Smoke job should supply a stable retained app to this same path.

## What acceptance evidence means

| Claim | Evidence required | What it does not establish |
|---|---|---|
| Build ready | Selected app identity; compatible schema; unchanged course/runner; valid media and model prerequisites | Application behavior |
| Check passed | Exact build and fixture identities; expected behavior; independent state/output assertion; observed outcome and operation receipts | Every UI gesture or original source-row variant |
| Evidence ready for review | Consistent frozen plan/course/final results; required result inventory; retained receipts; scope and environment context | Correctness or sufficiency of the oracle |
| Check accepted for its stated scope | Review of the user behavior and oracle; representative fixture; meaningful wrong-result test; actual package execution; explicit limits | Human, desktop, CI or release acceptance outside that scope |
| V1 accepted | Approved coverage map and variants; required results and all WIZ-423 workflow acceptance evidence | Implied by a green check count |

An oracle is the observation that decides whether the action worked. For a split, that might be the resulting clip identities and exact source/timeline intervals. A command returning success is only a receipt. For an export, the evidence needs the application's exported artifact and decoded properties/pixels, not a substitute external encoding operation.

Acceptance review is still explicit and manual in this slice. No new approval database or automatic promotion is introduced. The report always labels V1 acceptance **Not assessed**.

### Required per-check evidence

- Stable check ID, source-row relationship and named behavior/variant.
- Frozen expected result and the operation/gesture actually used.
- Independent observed state or output, with enough context to understand a failure.
- Build, fixture and recipe identity.
- Timing and terminal outcome, including Fail, Blocked and Unknown.
- Retained artifacts appropriate to that assertion.
- For important oracles, a negative control that fails for a deliberately wrong result.

Framework test results are evidence about the runner. They are not Wizard smoke passes. Human observations, desktop behavior and unit/build validation retain separate evidence types.

## Local delivery

```sh
npm run smoke:report -- --run-id RUN_ID
```

The web run detail also has **Save local report**. Export writes:

- A standalone dark HTML report.
- A structured report JSON with original outcomes, evidence gaps, identities, source coverage and fixture descriptions.
- Copies of retained plan, course, final report, operation journal, fixture manifest, scope and execution context when available.
- SHA-256 and byte size for each included evidence file.

Reports are named by run identity and content digest. Identical re-export resolves to the same directory. Changed evidence produces a new snapshot. An active execution cannot be exported as a final report. Missing evidence in an interrupted or historical run remains visible; exporting never fills it with invented records.

The local folder can be reviewed without the app. It is **not yet a complete portable reproduction kit**: media, saved projects, rendered outputs and raw process logs remain in the original run folder. Operation journals can contain local paths and identifying context. The included files are copied as retained evidence, not represented as sanitized external attachments.

The report is designed to become the readable payload for WIZ-512. A later publisher can place an approved report/evidence set at a shared destination and record its delivery receipt separately. Destination, credentials, sharing policy and Slack delivery are intentionally unconfigured. Publication retries must not re-execute tests or rewrite outcomes.

## Coverage and fixture review

The proposal still contains 143 scripted definitions linked to 137 original rows:

- 77 Partial.
- 32 Not automated.
- 24 Deferred NAS.
- 4 Undefined.

Run `npm run scope:check` to inspect integrity, dispositions and fixture recipe sources. This command grants no acceptance. This slice adds duplicate-mapping and disposition validation; it does not approve or reduce the candidate scope.

The current GP has eight synthetic files: ProRes with stereo audio, H.264 at another frame rate, stereo tone, still, MXF, mask, speech audio and matching speech video. Each prepared pack has hashes, expected media properties and retained probe output. The speech model is pinned and offline.

### Reproducibility limits and next decisions

1. **Repeatable inputs on this Mac:** current media hashes verify the exact bytes. The fixture validator now rejects duplicate IDs/files and unsupported manifest versions before execution.
2. **Generation elsewhere:** ffmpeg and the macOS Samantha voice can produce different bytes across versions. Use retained approved media for exact cross-machine reproduction, or approve a new pack identity after checking its properties. Do not assume generator invocation implies byte identity.
3. **Project variants:** Fresh is the empty, newly created project and is available now. Checks populate a disposable Fresh project with the state they need. Story-user and Large will be added as versioned project inputs when supplied; they remain unavailable until then. See [the composable-course plan](composable-courses-plan.md). This clarification does not promote individual source-row outcomes.
4. **Missing scenarios:** an older-format migration fixture, required scale/nesting cases and any required external/plugin media need specific fixtures. Keep unsupported work explicit.
5. **Time savings:** the workbook contains outcomes, not a manual timing baseline. Measure preparation, hands-on testing and investigation separately in the later pilot.

The fixture source hash in the proposed scope changed because validation now rejects duplicate identities and unsupported versions. Media generation, expected media content, course membership and approval status did not change.


Reports and runtime evidence are written under the external `SMOKE_DATA_DIR` workspace. Historical verification logs are not versioned with the source.
