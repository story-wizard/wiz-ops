# PF-25: ten-minute idle editor CPU

Candidate definition `S-PF-IDLE`; not added to the accepted registry. As of October 2, it is excluded from `smoke-full` revision 2 and retained for a separate later run.

Charles approved provisional limits of **2% mean CPU and 5% time-weighted p95**, relative to one CPU core. Run for ten minutes; use the final five minutes after settling. Sample cumulative process CPU time and RSS every five seconds. Reject truncated evidence, missing process identity, negative CPU deltas and sample gaps over fifteen seconds. Verify transport remains paused at the same frame and timeline content remains unchanged. Do not poll the application during the measurement window.

This measures one owned instrumented editor process with synthetic Fresh media. It excludes child processes, GPU work and system-wide CPU. Background window state and test-plugin overhead are part of this particular runtime. Repeat against the intended release configuration before claiming release idle performance. RSS is retained for diagnosis; there is no memory verdict in this check.

## Running the candidate

Prepare an accepted service check against the intended selected package to establish matching tools and fixtures. The candidate command uses that plan only for its verified inputs; it does not execute the selected export check. Preparation must be refreshed after code or build changes.

From the command root, with the service running and `SMOKE_DATA_DIR` set to its external workspace:

```sh
node scripts/smoke.mjs plan --app /path/to/Wizard.app --checks S-EXPORT-PRORES --out /tmp/idle-plan.json --server URL
/usr/bin/caffeinate -i node desktop/service-run.mjs --candidate-idle /tmp/idle-plan.json
```

Reserve the Mac for this explicit ten-minute performance measurement. Do not run it alongside interactive testing.

The candidate command runs **only S-PF-IDLE** and retains its own one-check report under `$SMOKE_DATA_DIR/desktop-runs/`. It does not create a normal accepted-course run in the results database. After definition review, accepting it will allow normal composable course selection; no separate performance service is needed.
