# PF-25: ten-minute idle editor CPU

September 28, 2026. Candidate definition `S-PF-IDLE`; not added to the accepted registry.

Charles approved provisional limits of **2% mean CPU and 5% time-weighted p95**, relative to one CPU core. Run for ten minutes; use the final five minutes after settling. Sample cumulative process CPU time and RSS every five seconds. Reject truncated evidence, missing process identity, negative CPU deltas and sample gaps over fifteen seconds. Verify transport remains paused at the same frame and timeline content remains unchanged. Do not poll the application during the measurement window.

This measures one owned instrumented editor process with synthetic Fresh media. It excludes child processes, GPU work and system-wide CPU. Background window state and test-plugin overhead are part of this particular runtime. Repeat against the intended release configuration before claiming release idle performance. RSS is retained for diagnosis; there is no memory verdict in this check.

## Running the candidate

Use an explicit retained runtime manifest with `app`, `cli`, `qtPlugin` and optional `libraries` paths. Preparation must be refreshed after runner or desktop source changes. The existing accepted service selection is used only to fingerprint prerequisites; neither its connection check nor its export check runs in the candidate command.

Set `SMOKE_DATA_DIR` to an absolute external directory, then from the smoke project root, with `runtime.json` pointing at the intended local runtime:

```js
// Run with node --input-type=module (or save as a local .mjs script).
import fs from 'node:fs';
import path from 'node:path';
import {dataDirectory} from './runner/files.mjs';
import {DatabaseSync} from 'node:sqlite';
import {initializeCourses,resolveSelection} from './runner/catalog.mjs';
import {prepare} from './runner/prepare.mjs';
const db=new DatabaseSync(':memory:');
try {
  initializeCourses(db);
  const selection=resolveSelection(db,{checkIds:['S-EXPORT-PRORES']});
  const runtime=JSON.parse(fs.readFileSync('runtime.json','utf8'));
  const plan=await prepare({selection,runtime});
  fs.writeFileSync(path.join(dataDirectory(),'idle-preparation.json'),JSON.stringify(plan,null,2));
} finally { db.close(); }
```

```sh
/usr/bin/caffeinate -i node desktop/service-run.mjs --candidate-idle "$SMOKE_DATA_DIR/idle-preparation.json"
```

The candidate command runs **only S-PF-IDLE** and retains its own one-check report under `$SMOKE_DATA_DIR/desktop-runs/`. It does not create a normal accepted-course run in the results database. After definition review, accepting it will allow normal composable course selection; no separate performance service is needed.
