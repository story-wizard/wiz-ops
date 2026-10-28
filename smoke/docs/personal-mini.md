# Athanor on a developer Mac

Use Athanor on your own Mini for an authorized test task, then stop it when finished. The same harness can become a dedicated worker later. Starting the developer service installs no background service, enables no schedule and launches no Wizard process.

## First setup

Clone the reviewed Ops revision and work from `smoke/`. Use Node.js 24 or newer; no npm dependencies are required. Keep GitHub credentials in your usual local credential store. Build discovery uses your existing `gh` identity. Do not copy another developer's credentials, runtime databases or host profile.

Choose an absolute runtime directory outside every Git checkout:

```sh
export SMOKE_DATA_DIR="$HOME/Library/Application Support/Athanor/dev"
node scripts/storage.mjs configure --data-dir "$SMOKE_DATA_DIR"
node scripts/storage.mjs status --data-dir "$SMOKE_DATA_DIR"
npm run open -- --data-dir "$SMOKE_DATA_DIR" --no-open
```

Keep the service in the foreground and use its printed loopback URL. Run `node scripts/smoke.mjs setup --server URL` for discovery. Reuse the same data directory for session commands. Stop the service with Control-C after known test cleanup. Existing storage configuration is never overwritten; omit `configure` on later launches.

The initial policy allows 40 GiB of caches and 60 GiB of scratch, reserving at least 50 GiB or 15% of the volume. These are starting budgets, not measured sizing for a full course. Check available capacity and other work before a large run. `configure --policy /absolute/policy.json` accepts reviewed values on first setup; see the [example policy](../examples/personal-mini/storage-policy.json). Review and edit an existing policy while the service is stopped. Choose any backup destination separately on each host.

Choose the build explicitly. A global `/Applications/Wizard.app` is optional. Read [desktop setup](desktop-tools-setup.md) for prerequisites. `SMOKE_QT_PREFIX` selects the SDK for matching attachment tools; its Qt version must still match the selected package.

## Run with your agent

Give the agent the question, selected build and authorized testing scope. Discover existing checks and select the smallest useful course or subset. A dedicated worker's 176-check / 03:00 schedule is not a requirement for a developer run.

Arrange an available, unlocked desktop before GUI work. Check for other owners, dialogs and notifications. The existing cross-workspace lease and input guards protect harness ownership; they do not establish that the developer has stopped using the desktop. Do not dismiss unrelated work, change Focus settings or take over another owner without authorization. Use Athanor's Qt adapter, screenshots and guarded physical input. Do not inspect Wizard through the macOS accessibility bridge.

Keep test expectations intact. Recover safe setup and read-only observation failures where possible, preserving original attempts. Uncertain input or cleanup stops mutations until reconciled. Independent checks may continue after known cleanup.

Return the HTML report location, build, results and remaining gaps to the requesting user. Keep reports and detailed evidence local/private unless sharing was requested. Developer runs do not send Slack messages. PR publication is a separate requested action using the developer's own GitHub identity.

## Keep disk use bounded

Controls apply only to this configured workspace. Idle maintenance runs while the foreground service is open and after its packaged runs finish; no extra service is installed. It can remove registered unused imported packages and attachment tools. Current/rollback versions, active or uncertain work, changed files and unregistered caches stay protected. Logs, results and projects remain retained. New work waits for capacity rather than silently deleting them.

Known terminal desktop courses retire their registered disposable App and exact Python mirror after ownership, process-absence and cleanup checks. Logs remain outside those copies. Live or uncertain copies stay retained with a reason. Read [storage controls](worker-storage.md) for maintenance, private backup and restore. APFS clones reduce copying where supported; logical sizes do not measure physical savings.

## Repeat or relocate

On another Mac, use the reviewed revision, choose new host paths and configure storage again. Runtime paths stay outside source. For an existing packaged harness, run `node scripts/harness.mjs check --bundle /absolute/bundle` before installation. This checks its inventory without launching Wizard. Native tools must match the target Mac and selected package; an arbitrary copied cache does not replace preparation.

To migrate history, create and verify a private storage backup, then restore into a new directory. Restore preserves results and selection but disables the controller schedule and starts no service. Review paths and qualify the target before activation. A same-disk backup does not protect against disk loss.

For a dedicated worker, follow [worker setup](workers.md) and [job control](job-controller.md) after target qualification. Scheduling and services require a separate rollout. Charles's MBP stays suspended until he confirms resumption.
