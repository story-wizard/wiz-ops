# Current Athanor worker

Fill in this host-local record after deploying and qualifying a reviewed version.
Keep it beside README.md; never copy another Mac's paths without checking them.

- Worker name: REPLACE_WITH_HOST_LABEL
- Source commit: REPLACE_WITH_REVIEWED_COMMIT
- Command root: REPLACE_WITH_ABSOLUTE_SMOKE_DIRECTORY
- External profile: REPLACE_WITH_ABSOLUTE_WORKER_PROFILE
- Loopback URL: REPLACE_WITH_PROFILE_URL
- Scheduler: preserve its current paused state until the reporting cutover is verified.

Read `docs/workers.md` from that source. Run `node scripts/worker.mjs check` and
`status` with `--profile` before new preparation or dispatch. An active run returns
Busy and its existing link. Do not fetch/rebase the live source or duplicate a
schedule. Keep uncertain actions unresolved until their retained receipts have
been inspected. Worker updates are separate reviewed operations.

Mac Mini installation is deferred until its connection is available. Developer
clones run the ordinary local service and do not need this record.
