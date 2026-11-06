# Vehicle pipeline metrics

These collectors send real operational measurements to an explicitly configured
Guance workspace. Set `metrics.workspace` (the collector `GUANCE_WORKSPACE` environment
variable) and the Android writer configuration before deployment. They are independent of
business processing and OpenLineage delivery. The separately published unified
dashboard is described below; native data-observability page navigation is not
modified.

## Collection paths

- ACK: a new `vehicle-metrics` Deployment contains a Python collector and pinned
  Kafka Exporter 1.9.0. Metrics go to the existing node DataKit on port 9529;
  its destination token was compared with the existing vehicle lineage token.
- EMQX: a dedicated **viewer** API key reads the native Kafka action and rule.
  It cannot change the connector, rule or broker.
- Kafka: Exporter reads only the configured telemetry topic/group using the
  existing consumer credentials. The Python adapter projects its native offsets
  and lag into the common metric naming/tag contract. This does not install
  Broker JMX collection or restart Kafka.
- Flink: read the existing coherent `vehicle.counts` observation using the
  SELECT-only database user; reject observations older than 60 seconds. The
  original runtime observer refreshes approximately every 20 seconds.
- Spark: a consistent read-only database snapshot contains the last successful
  report and its row counts, plus separately identified latest-run status.
- Parquet: list only today's UTC hour prefixes corresponding to the Shanghai
  day, for clean/anomalies/quarantine. Count completed `part-*` objects older
  than five seconds. Do not scan record payloads or all retained history.
- Android: an independent GCP systemd sampler reads existing `VehicleTelemetry`
  aggregate diagnostics from **emulator-5556**. No APK upgrade or application
  restart is required. GCP has no active DataKit; this small stdlib process uses
  HTTPS `/v1/write/metric` with the same workspace token in `X-Token`. The token
  stays in root-only `/etc/vehicle-demo/metrics-writer.json`.

ACK sources collect every 10 seconds; Parquet collects every 60 seconds. Android
polls every 10 seconds and writes each native sample once with its original
timestamp. It rejects samples older than 45 seconds. Source collection and
transport failures never produce artificial zero business values. Each source
has a separate `vehicle_pipeline_collector.up` health series. Transport failure
leaves a gap; the next poll resumes. No durable metric replay is claimed. Existing
DataKit buffering and the separate durable lineage outbox remain unchanged.

## Finding the data

In the target workspace's **指标** explorer, search for `vehicle_pipeline_`.
Every measurement carries `pipeline=vehicle-telemetry` and `component`.
Stable tags identify cluster, action, topic, consumer group, partition, dataset
or job as applicable. No event ID, Run ID, exception text or telemetry payload is
used as a metric tag.

| Measurement | Main fields | Meaning |
|---|---|---|
| `vehicle_pipeline_android` | generated, acknowledged, dropped, pending | Durable device counters; acknowledged means Broker PUBACK |
| `vehicle_pipeline_emqx` | matched, success, failed, dropped, late_reply, queuing, inflight, connected, rule_matched | Native action metrics; rule count is separate |
| `vehicle_pipeline_kafka` | end_offset, oldest_offset, committed_offset, committed_lag | Per-partition offsets and approximate committed-offset lag |
| `vehicle_pipeline_flink` | input, clean, duplicates, quarantine, anomalies, running, completed_checkpoints, checkpoint_age_seconds, observation_age_seconds | Checkpoint-restored processing counters |
| `vehicle_pipeline_parquet` | committed_files, committed_bytes, latest_file_age_seconds | Today's committed objects, split by dataset |
| `vehicle_pipeline_spark` | input_rows, unique_rows, object_count, five_minute_rows, daily_rows, source_age_seconds, report_age_seconds, source_event_time_seconds, batch_completed_time_seconds | Last successful report snapshot |
| `vehicle_pipeline_spark_run` | running, failed, aborted, complete, duration_seconds | Latest run, separate from retained successful report |
| `vehicle_pipeline_collector` | up | Collection health, grouped by source |

Example DQL (select the time range in the UI):

```text
M::vehicle_pipeline_emqx:(last(queuing), last(inflight))
M::vehicle_pipeline_kafka:(last(committed_lag)) BY consumer_group, partition
M::vehicle_pipeline_collector:(last(up)) BY source
```

Counters have different lifetimes and sampling times. Do not subtract unrelated
stage totals to infer loss or backlog. Flink anomalies are a subset of clean
output. Processing output is not yet a committed file. Kafka lag includes work
already read but not committed by a checkpoint, and is not an exact count of
unprocessed unique business events. Use offset advancement as offset progress,
not a fabricated Broker message counter. A zero-file Parquet dataset has no
latest-file age. Spark summary rows are not comparable to raw input rows.

## Deployment and rollback

1. Confirm the named workspace and compare DataKit's destination privately;
   never print tokens. Do not reuse this explicit Demo profile for another space.
2. On the existing GCP management host, run `prepare-emqx-reader.py`. It creates
   only `vehicle-metrics` with role `viewer`, storing the secret root-only. An
   existing key without its saved secret is a hard stop rather than implicit rotation.
3. Supply the key through the owned `vehicle-metrics-reader` Kubernetes Secret
   (`api-key`, `api-secret`). Retain existing reader/consumer/S3 credentials.
4. Build `Dockerfile.metrics` for amd64/arm64 using the frozen uv lock. Pin its
   immutable digest in `metrics.image`; pin the Exporter digest as well.
5. Render the vehicle chart against current effective Helm values. Assert no
   existing resource changes and only `Deployment/vehicle-metrics` is added.
   Set `metrics.enabled=true`, then upgrade the existing release.
6. Install `android_metrics.py` and the `vehicle_metrics` stdlib files under
   `/opt/vehicle-demo/metrics`, install the supplied systemd unit, and provide
   root-only writer configuration containing `workspace`, `url`, and `token`.
   Enable only `vehicle-android-metrics.service`.
7. Validate native snapshots, actual Guance queries, recurring samples and health;
   compare original workload specs and other Helm releases afterward.

Kafka Exporter **1.9.0 requires explicit SASL arguments**. Kubernetes expands the
Secret-backed environment references in its args. Newer upstream source has
environment fallback, but relying on that behavior with this fixed version fails
startup. Never replace the references with literal credentials in manifests.

To stop collection, set `metrics.enabled=false` through Helm using the current
effective values, and stop/disable `vehicle-android-metrics.service`. Business
engines and telemetry are unaffected. Retain credentials for a reversible stop;
revoke only the dedicated EMQX viewer key if permanently retiring this collector.

Validation: `uv run --project vehicle-pipeline/metrics pytest -q vehicle-pipeline/metrics/tests`,
Ruff check/format, Helm lint/template comparison, and live metric reconciliation.


## Unified dashboard

`dashboard/data-observability-pipeline.json` is the importable enhanced user
overview; `dashboard/base-overview.json` retains the supplied source unchanged.
Regenerate with `python3 vehicle-pipeline/metrics/dashboard/build_dashboard.py`.
The CSV field/tag inventory was exported from actual Demo metric discovery.

All points now share pipeline/cluster/topic/consumer_group correlation tags.
The common cluster is the target ACK cluster owning the pipeline; GCP source
location is not misrepresented as ACK execution. Native broker identities are
component_cluster tags. The new vehicle_pipeline_stage measurement is intended
for presentation: -1 means unknown and must be excluded from arithmetic.
Raw metric measurements still reject negative values.

Streaming minute increments are source-timestamped rolling differences with
interpolated window boundaries. Restart, reset, gap>35s or source failure requires
a fresh full minute. Source failures clear current display values; timestamps
distinguish last successful observation from latest collection attempt.
Flink internal backlog is unknown; Kafka output is checkpoint-committed progress.
Spark output counts actual report rows, not unique input samples.

Current views use 45s, Parquet/health 2m and trends 15m, with no outage filling.
Open the dashboard with time=1d and refresh every10s. The retained lineage section
is explicitly whole-workspace and does not use the four metric filters.

The single streaming Sankey uses `vehicle_pipeline_flow`, with stable stage,
level, source and target tags in addition to the four correlation tags. It shows
new generation and opening queue stock flowing into the corresponding stage,
then branches into downstream delivery, closing queue and terminal losses.
For Android: opening35 + generated60 = acknowledged0 + closing95 + dropped0.
On recovery, opening95 + generated60 can produce acknowledged155 and closing0.
The opening queue is necessary: current accumulated stock is not this minute's
new backlog. Values use the existing rolling60s interpolation and may exceed60.

`FlowProjection` reconciles each source's native lifetime counters and queue in
one source sample. Android uses generated/acknowledged/dropped and checks pending
(with a one-record diagnostic-read tolerance); EMQX uses matched/success/failed/
dropped/late_reply and checks queued+inflight; Kafka checks end-minus-committed
against native partition lag, detecting rollback before summation. Flink branches
into clean/quarantine/duplicates, excluding anomaly copies. No fabricated Flink
internal queue is drawn. Reset, incoherence, missing fields or source failure
clear the window and emit unknown for every fixed edge; a full minute is required
again. `value=-1` is a presentation sentinel, never a real weight.

Adjacent components still have independently sampled windows and broker/commit
boundaries: this is source-local accounting, not tracking one exact message cohort
through every component. Kafka downstream means committed position advance, not
actual Flink input at that instant; Flink writer counts are not file commits.

Five explicit nested DQL queries use shared keys n0..n5. Preserve empty metadata
`groupBy=[]` to stop native query rewriting; grouping belongs in DQL itself.
`HAVING amount>0` filters after `last(value)`, preventing old positive samples from
reappearing on unknown/zero. Zero/unknown have no artificial width; stage tables
retain their distinction and source update times. Hover displays exact observed
window estimates. The separate queue-root chart was removed.

The published dashboard `dsbd_fa1c81c86649419e8a4e165351b2c899` has 30 charts and
is **仅自己可见**, owned by the logged-in human user. Portable chart JSON alone
does not enforce platform visibility: set and read back the dashboard's native
visibility after import, and verify its creator is the intended human account.
The saved browser session refreshes every 30s; verify this control after reopening.
The node-branch follow-up updates independent collectors only.

Deployment: the node-branch update only changes the metrics collector image; Android host upgrade
only restarts vehicle-android-metrics. Keep the original engines, APK, schedules
and lineage untouched. Rollback ACK with the previous metrics.image recorded in
the private values-before.json (review manifest diff before upgrade); GCP source
backup is /opt/vehicle-demo/metrics-before-dashboard-20261105.tar. The original
Guance dashboard was not overwritten; the new dedicated dashboard is independently
replaceable. No fault drill was used for acceptance.
