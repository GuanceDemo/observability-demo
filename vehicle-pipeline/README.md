# 车机实时数据处理与血缘

EMQX 6.3.2 与分析服务部署在现有 ACK 的 `vehicle-pipeline` namespace。GCP 保留 Android 0.1.3、输入/音视频、受限 SSH 转发及轻量观察器；车机前端由本地工作台提供。原商城 GCP 业务容器尚未迁移。完整链路是：

```text
Android MQTT 5 / QoS 1
  → EMQX 原生 Kafka Sink（磁盘缓冲）
  → Kafka 4.1.2 / vehicle.telemetry.raw.v1
  → Flink 1.20.3 JAR / vehicle_clean_and_detect
  → SeaweedFS 4.51 S3 / Parquet
  → Spark 3.5.8 SQL / vehicle_summary
  → MySQL vehicle_analytics / 只读报表
```

- [本地车机画面与报表](http://127.0.0.1:8767/business.html?scene=vehicle-telemetry&view=web)
- [本地工作台运行说明](../scripts/vehicle-demo/local/README.md)
- [观测云作业](https://console.guance.com/data-observability/jobs)
- [部署与回滚](../docs/vehicle-demo/pipeline-operations.md)

## 数据契约

`eventId = vehicleId:sequence` 是去重身份。Flink 校验 schemaVersion、字段类型和取值、静止场景速度、可选采样时钟字段；同 ID 同内容计入重复，同 ID 不同内容进入隔离。高温阈值为 55°C，低电量阈值为 15%。`anomalies` 是 `clean` 的子集，不能重复计入输出总数。

三个输出前缀：`s3://vehicle-lake/clean`、`anomalies`、`quarantine`。按 UTC 处理日期/小时分目录，60 秒检查点提交；保留 3 个检查点，Kubernetes ConfigMap + S3 支持 JobManager/TaskManager 恢复。去重状态 TTL 为 8 天。独立数值指标可以存在采样时差，业务核对只使用 `vehicle.counts` 的原子 JSON 快照：

```text
input = clean + duplicates + quarantine
anomalies <= clean
```

Spark 每五分钟汇总北京时间今天的数据。只枚举从今天零点至本次开始时间对应的 UTC 小时目录，不递归扫描历史目录；冻结已完成、至少稳定 5 秒的 `part-*.parquet` 文件集合，以排序路径 SHA256 标识输入快照。再按事件时间筛选今天、按 eventId 去重后执行真实 Spark SQL。两张报表复用已缓存的里程计算结果。五分钟与日汇总同事务替换；START 在工作前提交，COMPLETE 与新结果同事务提交，FAIL 前回滚。里程取按车辆序列排列的里程表增量；首样本不推测之前的里程。充电样本数不等于充电秒数。

源数据超过 900 秒、今天无已提交输入或今天快照文件数超过 12000 时中止并保留上一批结果。报表只展示今天，跨零点不会把昨日数据算入今日。固定文件集合里的数据量、唯一行数、文件数、源时间和 Run ID 都保存在 `report_batches`。

日志 `vehicle_report_stage` 分别记录 initialize、snapshot、read、deduplicate、aggregate、publish 的 `durationMs` 和 Run ID，便于核对实际耗时。

## 对象存储回收

SeaweedFS 保持 40 个 128 MB 卷的既有容量预算；删除对象后由原生压缩释放物理空间。默认每 120 秒检查垃圾比例，达到 10% 时压缩，限制并发并为压缩保留内存余量。这个固定版本的 `mini` 使用维护插件接管压缩，单改 Master 参数不会覆盖已保存的插件配置。`vacuum-policy` 辅助容器每 30 秒通过同 Pod 的回环 API 核对实际策略，设置 2 分钟、10%、单任务并发并确认回读，重启后自动恢复。管理 API 仅绑定回环地址，不新增公开入口。主机有空闲磁盘不代表这些卷仍可写，不能只看主机 `df` 判断容量。

`lake.retention.enabled=true` 启用每小时的 `vehicle-lake-retention` CronJob，可参考 `deploy/values-lake-retention.example.yaml`。它仅清理 `clean/anomalies/quarantine` 下已完成的 `part-*.parquet`，保留当前 UTC 日期及前三天；日期和最后修改时间都过期才会删除。当前北京时间日报输入始终在保护范围内。检查点、HA、savepoint、进行中的文件及分段上传不参与年龄清理，检查点仍由 Flink 保留最近 3 个。

首次启用前，使用固定版本 metrics 镜像中的 Python 3.12 运行 `deploy/chart/files/lake-retention.py`，配置现有 S3 环境变量，默认只预演，核对日志中的 cutoff、eligible 和 selected；只有 `--execute` 才删除。定时任务挂载同一脚本，使用现有 Secret 引用，不包含密钥明文。每次最多扫描 15 万个文件、删除 1 万个，脚本期限 240 秒，禁止定时任务重叠；超限或失败会保留 Kubernetes Job 和脱敏日志，下一次继续。

部署后查看 `kubectl -n vehicle-pipeline get cronjob,jobs`，以及 `kubectl -n vehicle-pipeline logs job/<回收 Job 名称>` 的 completed/deleted 状态。初始历史较多时需要多个受限批次。清理成功后还要确认物理压缩、Flink 新检查点和报表源时间推进，不能仅以删除接口成功判断恢复。

## 血缘

EMQX/Flink 由显式适配器读取原生动作指标和 Flink REST 状态；Spark 使用 OpenLineage Java SDK 显式埋点。这不是自动 SQL/SparkListener 捕获。SDK 事件只含结构和运行元数据，原始遥测保留在受限存储。

作业 namespace 为 `vehicle-demo.telemetry`。数据集身份在上下游完全一致：MQTT `mqtt://vehicle-emqx`，Kafka `kafka://vehicle-kafka.vehicle-pipeline.svc.cluster.local:9092`，对象存储 `s3://vehicle-lake`，MySQL `mysql://demo-observability-demo-mysql:3306`。作业分别是 `emqx_telemetry_to_kafka`、`vehicle_clean_and_detect`、`vehicle_summary`。

`lineage_outbox` 持久化 SDK 原始 JSON，按 ID 重试，保留相同 Run ID、事件时间与内容；复用现有 `mall_pipeline.transport.HttpSink` 的 X-Token、重试、禁用重定向和脱敏实现。发送失败不会撤销成功的报表。流作业持续发送 RUNNING，仅在观察到真实终态时结束。

## 本地验证与构建

```sh
mvn -q -f vehicle-pipeline/pom.xml test
uv run --project vehicle-pipeline/control pytest -q vehicle-pipeline/control/tests
uv run --project vehicle-pipeline/control pytest -q vehicle-pipeline/scripts/tests/test_apm*.py
uv run --project vehicle-pipeline/control ruff check vehicle-pipeline/control
uv run --project vehicle-pipeline/control mypy vehicle-pipeline/control/src --config-file vehicle-pipeline/control/pyproject.toml
uv run --project vehicle-pipeline/control ruff check --isolated --select E4,E7,E9,F,I,B vehicle-pipeline/scripts
helm lint vehicle-pipeline/deploy/chart
node --check vehicle-pipeline/web/reports.js
```

`sh vehicle-pipeline/scripts/build-images.sh <未使用的镜像标签>` 执行测试并构建 amd64/arm64 镜像。Dockerfile 以已构建 JAR 为输入；专用 dockerignore 包含这些产物，排除虚拟环境和缓存。镜像标注工作树内容摘要，不冒充 Git 提交。当前应用/Chart/API 版本为 0.1.0，线上修订镜像使用 0.1.0-r1/r2 并固定 digest；尚未创建 Git 发布 tag。

### Retention cleanup concurrency

History cleanup commits the delivery snapshot, then uses `READ COMMITTED` for that one transaction. This avoids outbox gap locks racing a Spark START/catalog write; the public report reader keeps its default repeatable-read batch snapshot. The MySQL regression covers both the original error 1213 and the corrected concurrent writes. Run it against a disposable MySQL 8.4 instance with `VEHICLE_TEST_MYSQL_PORT=<loopback-port> uv run --project vehicle-pipeline/control pytest vehicle-pipeline/control/tests`. The tests create and drop only their randomly named test databases.

## Vehicle APM

APM is separate from OpenLineage and pipeline metrics. The optional integration
uses OpenTelemetry Java SDK 1.54.0: Android `vehicle-android-producer` publishes
a root `mqtt.publish` span per actual attempt, carries W3C `traceparent` in MQTT5
User Properties, and finishes on PUBACK/error. EMQX exports its own native spans
over OTLP/gRPC. Its owned Kafka action preserves the original context in a
Kafka header. `vehicle-flink-consumer` extracts that header and records real
validation/deduplication/collection in `flink.clean_and_detect`. EMQX and Flink can be
sibling spans under the producer: the native Kafka sink forwards the original
context, so do not describe Flink as a child of an EMQX internal span. Consumer
completion does not claim Parquet checkpoint visibility or Spark completion.

Enable `apm.enabled` with an explicit DataKit HTTP traces endpoint and cluster
label. The private `vehicle-apm` trace-only DataKit receives EMQX gRPC and producer/
consumer HTTP, explicitly preserves SDK service.name with split_service_name=false,
and writes to the Demo workspace using the existing pipeline Secret. No workspace
token belongs in the APK. Shared DataKit and DDTrace compatibility flags remain
unchanged for other applications. Flink uses the JDK
HTTP sender rather than OkHttp to avoid the older Kotlin libraries in Flink's
parent classloader. Preserve its relocated SDK and service-provider resources.

On the GCP host, add `apm_http_host` (the exact DataKit Service IPv4) to the
private tunnel config (use the vehicle-apm Service IPv4) and run both tunnel
installers to authorize only port9529
and bind local18090. Restart that dedicated tunnel. Run `install-apm-ingress.py`
(requires python3-bcrypt) to expose only POST protobuf at
`/vehicle-otel/v1/traces`, with the existing vehicle-publisher Basic identity.
Anonymous requests must return401. Keep its protected Caddy backup for rollback.

Before `configure-apm.py --apply`, stop only the vehicle publisher under its
maintenance guard and wait for native queue/inflight to reach zero. The script
refuses active traffic, foreign ownership, unexpected SQL/header mappings or
encoding. It saves a0600 original configuration backup, preserves payload/key/
buffer settings, adds only trace context forwarding and native tracing, and
verifies readback. Never use the full connector installer to retrofit APM while
buffered deliveries exist. Resume the publisher even if configuration fails.

Build the independent signed APK with `-PvehicleApm=true` and
`-PvehicleCluster=<ACK cluster ID>`; default builds keep APM disabled. Install
with `adb -s emulator-5556 install -r` so Room, sequence and encrypted credentials
survive. A Flink upgrade that changes the RawEvent POJO must use a verified
stop-with-savepoint and a fresh HA cluster identity (`flinkClusterId`,
`flinkRestorePath`), retaining all operator UIDs and original HA/savepoint data.
Verify actual same-trace spans in the intended workspace, restored counters,
completed checkpoints and advancing report data before declaring acceptance.

APM displays `vehicle-android-producer` (Android `mqtt.publish`), `emqx`
(`process_message`) and `vehicle-flink-consumer` (Flink `flink.clean_and_detect`).
The bound view also retains the legacy `kafka.process` mapping for historical spans.
MQTT/Kafka are retained as `messaging.system` attributes, not substituted for
component identities. The earlier shared receiver used protocol-based names;
historical spans keep those old names. Verify new spans by matching trace and
parent IDs. A deployable opt-in overlay is available at
`deploy/values-apm.example.yaml`; preserve the deployed release values and
verified Flink migration settings when applying it. The private receiver uses
the existing openlineage-token Secret key through ENV expansion; never render
the token into Helm values. Its private ingress permits same-namespace clients
and only the exact SSH management-node CIDR on9529.

Optional `apm.resourceIdentityEnabled=true` corrects the private receiver's
default host for Android, EMQX, Flink and Spark without restarting the engines.
A loopback resolver refreshes namespace Pod metadata every5s (expires after30s),
matching source IP, component ownership and Pod lifetime; Flink/Spark additionally
require their exact service instance/Pod name. Cluster spans get their actual
node `host` and Pod name/namespace/UID/IP, including normalized OTel aliases.
Android gets no invented host or Kubernetes Pod. Missing, stale or ambiguous
metadata omits those fields with `resource_identity=unknown`; it never falls back
to the receiver hostname. Only the resolver mounts a rotating API token, with
pods/list permission in this namespace. The DataKit container has no token.
Preserve this enabled value on subsequent upgrades. Verify fresh destination
spans and a later Spark Pod before deleting an erroneous catalog host URN, then
observe later ingestion/discovery cycles for recurrence. Historical spans retain
their old identities. This feature can coexist with optional Run correlation.

Optional `apm.correlationEnabled=true` adds a receiver-only context cache using
the existing control image and SELECT-only `vehicle_reader` Secret. It adds
pipeline/cluster/topic/consumer_group/component context to the three owned
services. Only EMQX and Flink have lineage job identities. A Span receives a
`run_id` only within one observed Run interval; stale, missing or ambiguous
evidence leaves it unset with `run_correlation=unknown`. A running interval
ends at its latest engine observation, so very recent Spans can remain unknown.
Android has `run_correlation=not_applicable` and no fabricated job or Run.

Generate the private APM user view with
`python3 vehicle-pipeline/metrics/dashboard/build_apm_view.py` from the repository
root. Import `metrics/dashboard/vehicle-apm-correlation.json` as a user view,
bind service IN `vehicle-android-producer`, `emqx`, `vehicle-flink-consumer`,
and set visibility to self only. Import clears existing binding rules; restore
and read back them after import. The native Span drawer passes matching scalar
fields into view variables; charts follow that drawer's time range. Without
job/run fields, the Run table shows all runs within that range and must not be
described as an exact Run match. This view does not add an APM link to the native
data-observability Job page or a Spark execution trace.

The presentation view collapses its technical selectors and keeps their original
values for context inheritance. Request rows show readable processing stages and
operations; Run rows show job name, latest event timestamp and state. Full IDs
remain available as diagnostic columns and query grouping identities. Native
selectors render `*` literally, so do not rely on defaultVal.label to rename it.

Flink's native SDK also supports `VEHICLE_RUN_CONTEXT_URL` pointing to the existing
private control `/api/report`. Its export worker matches the actual Flink JobID
and a unique observed interval, waiting at most25 seconds for the next control
observation. Processing and checkpoint threads do not wait. Missing evidence
keeps `run_correlation=unknown`; SDK processing timestamps and parents remain
unchanged. This native path does not require receiver correlation scripts.

With APM enabled, each Spark report process emits service `vehicle-spark-summary`:
one `spark.batch` root and six actual execution-stage spans, all carrying the
same job namespace/name and Run UUID as its database/OpenLineage batch. Counts
describe the original successful commit; failed stages record safe classifications.
The self-only APM view can bind this service and use its Run context directly.
When migrating Flink images, preserve a fresh stop-with-savepoint and use a new
HA cluster identity. A rollback must restore the old image from that fresh
savepoint, rather than the historical restore path in earlier release values.
