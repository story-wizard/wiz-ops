# Worker storage

The same storage controls run on a personal developer Mac or a dedicated worker. Start with [personal Mini setup](personal-mini.md) for on-demand use. Controls are off until configured in that workspace's external data directory. They never change the test selection, schedule, delivery or results. Keep Charles's MBP nightly suspended until he confirms resumption, including after restoring a backup.

## Configure a worker

Use the existing worker data directory, outside the source checkout. Choose the budget after measuring available disk space and one representative run. To create the initial policy:

```sh
node scripts/storage.mjs configure --data-dir /absolute/worker-data
node scripts/storage.mjs status --data-dir /absolute/worker-data
```

The starting limits are 40 GiB for packages/native tools/seeded templates/fixtures, 60 GiB for retained run and preparation scratch, and free capacity of at least 50 GiB or 15% of the volume, whichever is greater. These are conservative starting settings, not measured sizing for a Mini. `--policy /absolute/policy.json` supplies the same fields with reviewed values. Configuration creation refuses to overwrite an existing policy.

The worker checks capacity before preparation, imports and run admission. It first tries safe cache maintenance where possible. If the remaining pinned content or retained scratch exceeds the configured budget, new work waits for space; logs, projects and required evidence are not silently deleted. Configure enough room for the current build, rollback build and measured peak run. There is no partial test Pass caused by a storage refusal.

## Reuse and maintenance

Imported official/ZIP packages are registered when successfully imported or reused. Package identity verification remains unchanged. Verified attachment-tool directories are registered during selected-build preparation. The most recently used two registered versions of each cache family are kept by default, along with the prepared plan, active execution and unresolved job dependencies. Local app registrations and unregistered caches are never deletion targets. Reimport a known cache through the ordinary intake to verify and register it; do not blanket-register old directories.

The running service checks idle storage every fifteen minutes and after packaged runs finish. The same maintenance function can be requested explicitly:

```sh
node scripts/storage.mjs maintain --server http://127.0.0.1:4317
```

This is part of the existing worker lifetime; it does not install a service, dispatch a job or add another scheduler. New mutations wait during maintenance. Only registered unused package and attachment-tool caches can be evicted. Native helper caches without a verified ownership descriptor remain measured but cannot be deleted automatically. Canonical paths, inode, package/metadata identity, current worker state and process/open-file references are rechecked. App logs are retained separately before deletion. Interrupted registered retirements can resume; changed, redirected or in-use content stays retained with a diagnostic reason.

Per-session disposable App/mirror retirement and failure-focused image retention continue through the existing harness mechanisms. Logs and result history are outside cache eviction. APFS copy-on-write is requested for App, media and disposable project copies, with normal copying as the platform fallback; mutable copies are never hard links. Source templates keep their existing identity and isolation checks.

Status reports both logical bytes and allocated blocks. APFS shared extents can be counted repeatedly even by block totals, so actual volume free bytes govern admission. Do not claim physical savings from logical file sizes alone.

## Private backup and restore

Add `backupDirectory` to a policy supplied during configuration to enable idle snapshots, preferably on a separate mounted backup volume. It must be outside worker data. Set this path separately on each host; do not copy another machine's paths or credentials. Without it, automatic backup is disabled and status retains that explicit configuration.

Automatic snapshots run at most once per 24 hours, keep three verified snapshots by default and cap each snapshot at 2 GiB. They include the existing result/controller databases and known top-level worker/controller/runtime/storage JSON files. Use an explicit file list for differently named configuration files. Snapshots carry a worker identity; two workers sharing a backup volume do not rotate one another's snapshots. They do not include media, packages, raw run evidence or arbitrary service files outside the data root. The backup directory itself still needs authorized off-machine replication; a local snapshot does not survive loss of the whole disk.

SQLite write locks are held across both database snapshots. `VACUUM INTO` includes committed WAL state and omits unused database pages. Busy workers are not snapshotted. Private files use mode 0600 and new backup directories use 0700. Oversized or failed snapshots leave previous backups intact and report the problem without blocking otherwise runnable tests.

```sh
node scripts/storage.mjs backup --data-dir /absolute/worker-data --out /absolute/backups/new-snapshot --files /absolute/config-files.json
node scripts/storage.mjs verify --backup /absolute/backups/new-snapshot
node scripts/storage.mjs restore --backup /absolute/backups/new-snapshot --out /absolute/new-worker-data
```

The optional config file list is a JSON array of paths relative to worker data, for example `["worker-profile.json","controller.json","storage-policy.json"]`. Explicit backup checks active executions and desktop ownership. It never uploads a backup.

Restore requires a new directory, verifies every copied file and database, and disables the restored controller schedule. Original results and the 176-check/03:00 selection are retained; no service starts and no historical slot is replayed. Worker profiles and embedded paths must be reviewed/rebased for the new host and exact source before explicit re-enablement. A restore is not permission to resume the held MBP nightly.

## Qualification boundary

Local qualification covers disposable filesystem/SQLite state, actual package intake, HTTP admission and maintenance, copy independence and existing report retention. Native Wizard execution and actual MBP/Mini storage peaks need a later owned worker check after maintenance. No claim of end-to-end acceptance or production adoption follows from local tests.
