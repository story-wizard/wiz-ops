# Tower live run status

`GET /api/tower/live?run=<id>` returns `wizard-smoke-live/v1` from the existing loopback service. `run` is optional; without it, detail selects the active or newest recorded run. Tower and agents can use this read without triggering execution recovery, source hashing, setup, or process control.

The response contains `observedAt`, `active`, `activeRun`, compact `runs`, and one `detail`. Each run has a `live` projection: fixed selected-check total, completed count, counts by status, current check, phase, start, last activity, and finish timestamps. Detailed checks retain their status, expected result, observation, and recorded timing. Summary results are empty; consumers retain previously loaded details until a new detail arrives.

Database-backed runs use executions, frozen course/results and result events. Standalone desktop/service runs use the selected session checks, compact check journal and final report. A partial final journal line waits for the next read. The final report supplies frozen definitions when available; unfinished standalone sessions use the current definitions for their selected IDs. Status reflects recorded state; this endpoint does not decide process liveness or heal interrupted runs.

Bounds: 30 recent database runs, up to eight active runs, the explicitly selected database run, and the newest 100 standalone directories. JSON records and journals are limited to 2 MB each. The full catalog remains at `/api/tower`; historical records outside the live summary are retained by Tower. IDs are restricted to 1–80 letters, digits or hyphens. No environment or operation logs are returned.

Tower shares the feed per workspace. Visible rooms poll serially every two seconds while work is active, ten seconds when idle or after a read failure, and refresh on application focus. Identical selections share a read. Closing the last room cancels watching. Failures keep the last successful data. Follow current selects and scrolls to the running check; manual check selection pauses following.

Run `node --test tests/tower-live.test.mjs tests/tower.test.mjs` for isolated coverage of idle discovery, partial journal writes, terminal counts, read-only state and HTTP routing. Runtime observations belong in the external workspace.
