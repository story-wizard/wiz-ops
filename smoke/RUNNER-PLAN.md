# First runnable course

The September 25 candidate catalog remains the full backlog. This implementation turns the supported local subset into an executable packaged-app course. It does not claim completion of all 71 current candidates or human acceptance.

## Boundary

- Launch a new process from a fingerprinted `.app`, with isolated Wizard settings, runtime files and a disposable project directory.
- Use the shipped CLI with an explicit owned loopback endpoint and `--no-spawn` on every call. Preserve observed bundle revision tokens.
- Prepare the GP at execution time using project/media/timeline operations. The media pack is generated and verified in advance. No handwritten `.wiz` files.
- Exercise editor-service behavior in the packaged headless engine. Do not claim mouse/keyboard, playback quality, live panel binding or visual acceptance.
- No existing Wizard GUI session, personal project, release pipeline, Studio service, NAS or paid provider is used.
- Actual course runs require their own recorded package identity and observations. Schema inspection, fixture preparation and runner contract tests are separate development evidence.

## Acceptance

1. Given a changed package, fixture, cached speech model, course or script, an old prepared plan is rejected before launching Wizard.
2. Given a healthy owned process, commands address only its PID-verified runtime endpoint and a new project within the run directory.
3. A command returning success with the wrong timeline state fails an independent assertion.
4. A timed-out mutation is unknown, is not retried, and blocks dependent checks. Errors and partial project state are retained.
5. The runner writes live results, command receipts, package/fixture identities and terminal outcomes to the dashboard. Automated evidence cannot be overwritten through the manual-result form.
6. Each run freezes its test definitions and recipe. A started but abandoned run remains interrupted/unknown after dashboard restart.
7. Preparation reports readiness without dispatching Wizard. Starting the real course is an explicit separate action.

## Small implementation

Use the existing Node/SQLite dashboard, Node child processes and JSON course metadata. Add a fixture generator, packaged CLI adapter, independent assertions, fixed executable cases and read-only preflight. Avoid a generic workflow language or human handoff engine for this first course.

The detailed operation mapping lives in `runner/course.json`. Candidate cases lacking complete controllable actions or observable results remain explicitly deferred. All automated counterpart definitions preserve their source checklist IDs and state their narrower automated scope.
