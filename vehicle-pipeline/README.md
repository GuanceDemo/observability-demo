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

源数据超过 900 秒、今天无已提交输入或今天快照文件数超过 12000 时中止并保留上一批结果。旧原始数据仍按原保留策略存储；报表只展示今天，跨零点不会把昨日数据算入今日。固定文件集合里的数据量、唯一行数、文件数、源时间和 Run ID 都保存在 `report_batches`。

日志 `vehicle_report_stage` 分别记录 initialize、snapshot、read、deduplicate、aggregate、publish 的 `durationMs` 和 Run ID，便于核对实际耗时。

## 血缘

EMQX/Flink 由显式适配器读取原生动作指标和 Flink REST 状态；Spark 使用 OpenLineage Java SDK 显式埋点。这不是自动 SQL/SparkListener 捕获。SDK 事件只含结构和运行元数据，原始遥测保留在受限存储。

作业 namespace 为 `vehicle-demo.telemetry`。数据集身份在上下游完全一致：MQTT `mqtt://vehicle-emqx`，Kafka `kafka://vehicle-kafka.vehicle-pipeline.svc.cluster.local:9092`，对象存储 `s3://vehicle-lake`，MySQL `mysql://demo-observability-demo-mysql:3306`。作业分别是 `emqx_telemetry_to_kafka`、`vehicle_clean_and_detect`、`vehicle_summary`。

`lineage_outbox` 持久化 SDK 原始 JSON，按 ID 重试，保留相同 Run ID、事件时间与内容；复用现有 `mall_pipeline.transport.HttpSink` 的 X-Token、重试、禁用重定向和脱敏实现。发送失败不会撤销成功的报表。流作业持续发送 RUNNING，仅在观察到真实终态时结束。

## 本地验证与构建

```sh
mvn -q -f vehicle-pipeline/pom.xml test
uv run --project vehicle-pipeline/control pytest -q vehicle-pipeline/control/tests
uv run --project vehicle-pipeline/control ruff check vehicle-pipeline/control
uv run --project vehicle-pipeline/control mypy vehicle-pipeline/control/src --config-file vehicle-pipeline/control/pyproject.toml
uv run --project vehicle-pipeline/control ruff check --isolated --select E4,E7,E9,F,I,B vehicle-pipeline/scripts
helm lint vehicle-pipeline/deploy/chart
node --check vehicle-pipeline/web/reports.js
```

`sh vehicle-pipeline/scripts/build-images.sh <未使用的镜像标签>` 执行测试并构建 amd64/arm64 镜像。Dockerfile 以已构建 JAR 为输入；专用 dockerignore 包含这些产物，排除虚拟环境和缓存。镜像标注工作树内容摘要，不冒充 Git 提交。当前应用/Chart/API 版本为 0.1.0，线上修订镜像使用 0.1.0-r1/r2 并固定 digest；尚未创建 Git 发布 tag。

### Retention cleanup concurrency

History cleanup commits the delivery snapshot, then uses `READ COMMITTED` for that one transaction. This avoids outbox gap locks racing a Spark START/catalog write; the public report reader keeps its default repeatable-read batch snapshot. The MySQL regression covers both the original error 1213 and the corrected concurrent writes. Run it against a disposable MySQL 8.4 instance with `VEHICLE_TEST_MYSQL_PORT=<loopback-port> uv run --project vehicle-pipeline/control pytest vehicle-pipeline/control/tests`. The tests create and drop only their randomly named test databases.
