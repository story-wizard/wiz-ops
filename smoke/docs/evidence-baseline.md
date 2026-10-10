# Nightly evidence and delivery

Every run freezes its selected package, schema, runner, fixtures and course. Test outcomes and evidence completeness are separate. A failed assertion remains Fail when a screenshot collector fails; the report also records the missing evidence.

## Lightweight performance evidence

Packaged and shared desktop checks retain performance JSON beside their operation journal: check elapsed time, collection overhead and before/after CPU-time and resident-memory samples from the actual owned process. PID, process start, generation and package identity bind both samples. A changed generation, unavailable process or invalid counter produces Incomplete with a reason and no invented metric.

CPU time is cumulative process time; its delta is CPU seconds consumed over the check. RSS is KiB at the collection points, not peak memory. These observations cover the instrumented owned process, excluding children, GPU, system load and a production performance verdict. No new threshold is imposed. The ten-minute idle test stays outside ordinary courses.

Run/action timing and readable step receipts remain available. Performance files travel with portable reports; incomplete records create evidence gaps. An interrupted check retains its started measurement. Resource telemetry alone never qualifies application behavior.

## State and recordings

Definitions declare image/video/audio/JSON requirements and collection points. Independent state/pixel assertions and owned failure captures remain authoritative. Focused investigations use before/after state, screenshots and logs. Motion/playback checks use the sampled presented-frame recorder, retaining PNGs, transport, sample spacing and observation cost alongside video. It is not an every-frame/drop-rate or audio measurement. Required but uncollected artifacts remain Missing or Not reached.

Add a bounded recording when the behavior needs motion evidence; avoid recording every check continuously. Reserve costly tracing/profiling for focused repros. Use the ordinary uninstrumented build for production performance or permission-persistence claims.

## Preparation blockers

Retain a failed/interrupted preparation and export into a new external directory:

```sh
node scripts/nightly.mjs blocked --preparation ID --build REQUESTED_VERSION --out /external/Athanor/nightly/blocked-ATTEMPT --server URL
```

This records the requested build, source, preparation error and selection. Package verification remains incomplete, checks are Blocked, functional assertions are Not run, and no run/execution is invented. Do not substitute an older build to obtain Ready.

## Private delivery

The helper records intent and receipts; it performs no network send and holds no credentials. Managed-worker QA goes only to Charles's verified Story Company DM. Developer runs remain local to their requesting user.

Verify the route through supported Slack tools and retain an external JSON file:

```json
{"workspace":"story-company","userId":"U0BDBFNU0G1","type":"im","user":"U0BDBFNU0G1","channelId":"ACTUAL_DM_ID"}
```

```sh
node scripts/report-delivery.mjs prepare --report REPORT_DIR --file ROUTE_JSON
node scripts/report-delivery.mjs inspect --report REPORT_DIR
```

Prepare retains the report hash, identity, destination and a condensed message, and refuses a second intent. Send through the supported Slack connector after verifying those facts. A route JSON is a retained observation, not Slack authentication or network-delivery proof. Use the returned intent ID and authoritative connector timestamp/URL in the receipt:

```json
{
  "intentId":"RETAINED_INTENT_ID",
  "state":"DELIVERY_CONFIRMED",
  "route":{"workspace":"story-company","userId":"U0BDBFNU0G1","type":"im","user":"U0BDBFNU0G1","channelId":"ACTUAL_DM_ID"},
  "messageId":"ACTUAL_SLACK_TIMESTAMP",
  "messageUrl":"EXACT_RETURNED_SLACK_MESSAGE_URL",
  "observation":"Describe the verified connector result."
}
```

```sh
node scripts/report-delivery.mjs record --report REPORT_DIR --file RECEIPT_JSON
```

Record DELIVERY_PENDING or DELIVERY_UNKNOWN with that intent ID and a reason when the route is unavailable or response lost. Inspect Slack before retrying. Later confirmation appends a receipt, preserving uncertainty. Confirmed delivery is immutable; identical recording is idempotent. A recording lock left after a crash requires inspection, not automatic deletion. No email, alternate recipient, Jira write or upload fallback is permitted.

Delivery stays outside the immutable QA report. Message confirmation never changes a test verdict or qualifies source.
