# Repair Athanor for a new build or feature

Start with the error, the selected build and the intended checks. A preparation failure means no tests have started. A failure inside a run is an observed test result; preserve that run and its evidence.

## Inspect the build

Use the existing service URL with `smoke.mjs setup`, `builds` and `context`. Identify the exact local app, tag or asset and package hash. Read the packaged CLI schema without starting Wizard:

```sh
"/absolute/path/to/Wizard.app/Contents/MacOS/wiz-cli" project create --schema --no-spawn
```

Retain that JSON and your comparison outside Git. Compare it with `runner/contracts/installed-schema.json`, including requests, responses, required fields, enums and referenced definitions. Ignore object key order when comparing. Compute structured schema identities with the existing `digest` helper in `runner/files.mjs`; hashing the JSON file's bytes produces a different identity.

The selected package and instrumented desktop tools are separate inputs. A desktop schema failure needs comparison with `runner/contracts/desktop-schema.json` and qualification of the paired runtime. A packaged qualification cannot approve a different desktop CLI or Cocoa plugin.

## Choose the repair

- If an existing reviewed schema matches, inspect the source/service version and configured tool paths. Refresh the source service or install the matching bundle.
- For a compatible, reviewed change, add its exact structured hash and comparison basis to `runner/contracts/packaged-schema-qualifications.json`. Tie it to the existing baseline hash. Keep unreviewed changes blocked. Do not replace the baseline merely to make preparation green.
- If parameters, responses or behavior changed, trace the affected checks and shared adapters. Update their requests and independent assertions, then add a regression that rejects the old incorrect behavior. Preserve each test's stable ID where its purpose is unchanged.
- For a new feature or user path, add a candidate check with fixture needs, readable steps, expected outcomes and evidence requirements. The testing lead accepts it before it enters canonical or accepted courses. Saving a custom course does not accept new tests.
- If the app itself is defective, retain the failure and reproduction context. A repair to Athanor must not disguise an app failure or reduce the assertion to make it pass.

## Verify and deliver

Run `npm test` and `npm run scope:check` from `smoke/`. For a regression, demonstrate failure with the old behavior and success with the repair where practical. Prepare the actual selected package again. Check the added prerequisites and frozen package, schema, fixture and source identities.

Run affected checks within the user's authorized scope before relying on a changed behavioral mapping. Foreground checks control the desktop. Preserve Fail, Blocked and Unknown; never retry an uncertain mutation just because its response was lost.

Keep changes in the source checkout. Preserve old plans, reports and installed versions. Follow `docs/maintaining-harness.md` to build a new versioned bundle after committing. Return the cause, schema differences, source changes, checks executed, evidence and remaining work. Jira writes, merging, publication and messages require their own user request.

## Copyable request

> Repair Athanor for this build or feature: [identity]. Intended course or checks: [selection]. Failure or missing behavior: [observation]. Read AGENTS.md and docs/build-repair.md. Inspect and compare the actual contract, update the mapping or affected checks as needed, validate the repair and retain the evidence. Preserve old results and the review gate for accepted tests.
