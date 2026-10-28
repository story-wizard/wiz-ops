# Publish a repair as the requesting developer

The manual broker runs on the developer's own Mac. Its credential remains there; the MBP repair worker supplies only review artifacts. The operator reviews those artifacts, installs the exact broker source and invokes one request. There is no background service, shared credential, automatic merge or nightly rollout.

This separates the worker host from the publishing host. File modes and hashes catch changed inputs; they do not protect a credential from another unrestricted process running as the same local developer. Do not describe this slice as a deployed cross-user sandbox.

## Install the reviewed local package

Use a new private directory outside Git for installation and a separate private state directory. INSTALL and STATE below mean absolute, operator-selected paths under the developer's local home. These names are notation, not environment variables consumed by the broker.

1. Review the exact source/patch and qualification. Copy only the files in `brokerFiles` from `runner/repair-broker.mjs`, preserving their paths below INSTALL. `runtime/node` and `runtime/gh` are pinned copies of the developer's verified Node 24+ and gh binaries. Use APFS clones when available; never hardlink and chmod the original runtime. Verify their dynamic dependencies are Apple system libraries or include and pin their complete dependency closure. No package installation or downloaded code runs during publication.
2. Make INSTALL and STATE mode 0700 and owned by the developer. Installed files, policy and request files must be developer-owned and have no group/other write permission; keep request/state data private. Existing ancestors must not permit group/other writes. Reject symlinks and unexpected ACL grants. Do not send this directory, gh configuration or credential to a shared worker.
3. Write INSTALL/broker-policy.json with the exact schema below. Inventory entries include all nine `brokerFiles` names, once each, with SHA-256 of the installed bytes. Pin Node and gh themselves. The broker rejects an interpreter path different from INSTALL/runtime/node.

```json
{
  "format": "athanor-local-user-broker/v1",
  "localUID": 501,
  "repository": "story-wizard/wiz-ops",
  "repositoryId": 1273595664,
  "actor": {"id": 289896211, "login": "charrisIII"},
  "installRoot": "ABSOLUTE_INSTALL",
  "stateRoot": "ABSOLUTE_STATE",
  "credentialHome": "ABSOLUTE_DEVELOPER_HOME",
  "inventory": [{"file": "EACH_BROKER_FILE", "sha256": "EXACT_INSTALLED_BYTE_HASH"}]
}
```

The shown actor identifies Charles for the authorized pilot. Each developer must select and verify their own ID/login and local UID/home. The broker does not switch accounts or accept the actor from raw worker observations. Verify the actual Ops repository ID before a live request; the expected ID above is a reviewed identity, not discovery fallback.

## Freeze and approve one request

Create INSTALL/requests/REQUEST_ID. IDs contain only letters, digits, underscore or hyphen. The directory contains exactly:

- `export/manifest.json`, `export/repair.patch`, `export/PR-PREVIEW.md`: the existing reviewed three-file export.
- `source.bundle`: the reviewed Git bundle. The approved head must have exactly one parent, equal to the observed approved base. Review a separate publication commit when the working repair has multiple commits.
- `approval.json`: the existing `athanor-repair-publication-approval/v1` approval, now with `actor: {id, login}`. It binds exact manifest/source/commit/title/body/paths, expiry and proof receipts. Approving a new actor is a new approval; do not edit old sealed records.
- `proof-KIND.json` for each approved proof (`framework`, `scope` and relevant `native`). Each receipt has `status: Pass` plus the same `kind`, `head`, `patchSHA256`, `failed`, `skipped` and optional `tests` as the approved proof. Its file-byte hash must equal approval.proofs[].receiptSHA256. The operator reviews the actual supporting results before approving these receipts; a worker's asserted counts alone do not establish qualification.
- `review.json`: the external operator envelope below. Its files list contains every file named above except itself, once each; `export` entries use relative paths. Each hash is SHA-256 of its exact bytes. No arbitrary extra filenames are accepted.

```json
{
  "format": "athanor-local-user-request/v1",
  "requestId": "REQUEST_ID",
  "actor": {"id": 289896211, "login": "charrisIII"},
  "policySHA256": "EXACT_POLICY_BYTE_HASH",
  "files": [{"file": "EACH_REQUEST_FILE", "sha256": "EXACT_REVIEWED_BYTE_HASH"}]
}
```

Policy and request hashes remain byte-exact. Actor ID/login equality is semantic, so JSON member order does not change identity. Retain the original failed reports outside the public export. Frozen inputs must stay unchanged during invocation; the current manual boundary trusts the operator's local host.

## Run once and inspect the outcome

Use a reviewed local command with the actual absolute paths:

```sh
/usr/bin/env -i PATH=/usr/bin:/bin HOME=ABSOLUTE_DEVELOPER_HOME \
  ABSOLUTE_INSTALL/runtime/node ABSOLUTE_INSTALL/smoke/scripts/repair-broker.mjs --request REQUEST_ID
```

The CLI accepts only the request ID and reads its installed policy. It validates installed bytes, request ownership/modes, every approved byte, proof agreement and full Git source before invoking gh. It then captures `gh auth token --hostname github.com --user APPROVED_LOGIN` using the pinned executable, fixed local home and minimal environment. GH_TOKEN, GITHUB_TOKEN and SSH agents are not fallbacks. Raw gh output/errors are never returned.

The credential must authenticate `/user` as the approved immutable ID and login. The fixed Ops repository must match its ID/name and show push capability. A missing credential, different account or missing capability stops before publisher dispatch. The personal credential may have broader access; the fixed Git/HTTP publisher is the Ops write boundary. Its short-lived grant expires within 30 minutes or the approval's earlier expiry; this is a broker authorization lease, not a claim about the underlying credential's expiry.

The credential goes to the pinned publisher through inherited descriptor 3, never an argument, environment variable, file or worker connection. The publisher verifies the approved actor against the created or reconciled PR's user ID/login. Returned diagnostics contain fixed codes/status only. The broker discards its transient credential reference and does not revoke or modify the developer's existing authentication.

The authoritative journal is STATE/journal. It retains intent before remote writes. A publisher exit, lost reply or malformed output after possible dispatch is Unknown; pre-dispatch validation failures are Held. Read/reconcile the journal and current remote identity before another action. Human edits to the PR title or description, including bot footers, do not block reuse. Repository, branch, commit, approved author, open state and draft status must still match. An advance of the target branch does not invalidate reuse of an existing matching PR; its approved source head and target branch still match. New publication still requires the approved base commit. Exact title/body approval remains required before publication. Repeating the same reviewed request may reconcile the existing PR; it must never repeat an uncertain create. Do not reset the journal or change roots to retry.

## Qualify and keep the claims separate

From `smoke/`, run `node --test tests/repair-broker.test.mjs tests/repair-publisher.test.mjs` with loopback permission. Controls use a fake pinned gh executable, synthetic identity/repository/PR API, actual broker/publisher processes and temporary bare Git. Runtime copies use filesystem clones and are cleaned up. The fake child checks that its credential is absent from arguments/environment. The tests also stop the publisher after a simulated PR side effect and verify Unknown followed by exact reuse.

Run the full framework suite and scope check. Desktop repairs also need the applicable native fixtures and matching adapter build. The existing QtQuick composer fixture runs with `node --test tests/workspace-composer.test.mjs`; it skips without the required macOS/Qt tools. A skipped native check does not qualify a repair. These counts can overlap the full suite.

Offline controls establish protocol/process behavior. The authorized live pilot must separately verify the real local credential identity, one reviewed draft PR's author, target branch and source head, plus unchanged nightly. The approved title/body payload is checked before dispatch; later cosmetic edits do not invalidate identity. No protected OS account, App installation, unattended request transport or shared-worker credential deployment is established by these tests.

References: [explicit gh account selection](https://cli.github.com/manual/gh_auth_token), [authenticated user identity](https://docs.github.com/en/rest/users/users#get-the-authenticated-user), [repository capability readback](https://docs.github.com/en/rest/repos/repos#get-a-repository), [draft PR metadata](https://docs.github.com/en/rest/pulls/pulls).
