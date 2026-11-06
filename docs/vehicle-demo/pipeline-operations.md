# 车机数据链路部署、运行与回滚

本部署使用现有 ACK/GCP 资源。数据链路 Chart/API 为 0.1.0，Android 独立为 0.1.3；商城 Web 版本独立管理。EMQX、Kafka、Flink、对象存储和 Spark 在 ACK，车机工作台入口仍仅支持本地运行。

## 资源和边界

| 位置 | 新组件 | 内存上限 |
|---|---|---|
| ACK `cn-shenzhen.10.182.137.32` | EMQX、Kafka、SeaweedFS、控制/API | 1024 + 640 + 512 + 192 MiB |
| ACK `cn-shenzhen.10.187.217.80` | Flink JM/TM、短时 Spark Job | 768 + 1792 + 1536 MiB |
| GCP 原车机主机 | SSH 隧道、EMQX 元数据进程 | 48 + 64 MiB |

Kafka 保留 7 天或 1 GiB（先达到者生效），单分区、单副本。EMQX 原生 Sink 使用 100 MB 磁盘缓冲、24 小时过期并公开失败/丢弃计数。S3 数据前缀保留 8 天，检查点最多 3 个；SeaweedFS 的 40 × 128 MB 数据卷约束主体数据量。PV 声明 2 GiB/5 GiB 是调度容量，不是文件系统硬配额，仍须监测宿主机磁盘。

`/var/lib/vehicle-pipeline/{emqx,kafka,lake}` 在现有节点上，PV/PVC 标记 Retain/keep。节点或磁盘永久损坏不能由单节点存储自动恢复；这不是生产级多副本部署。没有新的公网 MQTT、Kafka、Flink、S3 或管理入口。

跨云 MQTT 通过 `vehicle-pipeline-tunnel` SSH 服务加密：GCP loopback 1883/8083/18083 转发到 ACK EMQX ClusterIP，18089 转发到聚合 API。旧的 Docker 网桥 19092 Kafka 转发已移除，EMQX 直接连接集群内 Kafka 9092。ACK 转发账号限制来源 IP 和这四个目标端口，禁止 shell/PTY/Agent/X11。使用预先核验的主机公钥。集群内 Kafka 使用 SASL PLAIN 和独立 ACL，S3 使用独立读/写凭据，MySQL 独立库和最小权限账号。

## 安装顺序

以下为初始链路 bootstrap；已迁移环境升级使用 `deploy/values-ack.yaml` 保留 EMQX 开关。恢复持久数据前必须停止相关写入、核对备份与组件版本，避免双写。已有 MQTT 客户端连接时，不重新执行全量 `configure-emqx.py` 来迁移 connector/action。

脚本在指定机器执行；凭据通过 stdin/Secret 传递，不写入仓库、命令参数或日志。

1. 保存现有 `observability-demo` 的 Deployment/CronJob spec、Helm revision、节点资源和磁盘基线。确认目标 storageNode 正是执行本地目录 bootstrap 的节点。
2. 构建或复用 `vehicle-pipeline/deploy/chart/values.yaml` 固定 digest 的镜像。ACK 若无法连接 Docker Hub，使用当前 Harbor 镜像；基础镜像来源/digest 留在对应配置和记录中。
3. 将 `vehicle-pipeline/schema.sql`、`scripts`、`deploy/chart` 放到 ACK 管理机 `/opt/vehicle-pipeline-source/vehicle-pipeline/`，运行 `python3 .../scripts/bootstrap-ack.py`。脚本支持 Python 3.6，拒绝无归属的 namespace、Secret、数据库或账号，先持久化凭据再建库。
4. `helm upgrade --install vehicle-pipeline <chart目录> -n vehicle-pipeline --wait` 安装 Kafka/S3。默认处理服务关闭、报表暂停。运行 `sh .../scripts/init-kafka.sh` 创建 topic/ACL。
5. GCP 生成专用 SSH key。向 ACK `install-tunnel-ack.py` 的 stdin 传入 `kafka_ip`、`control_ip`（实际 ClusterIP）、`source_ip` 和 `public_key`。向 GCP `install-tunnel-gcp.py` 的 stdin 传入这些字段、已核验 `known_host`、Kafka emqx 密码和 `bridge_token`。私钥留在 GCP `/etc/vehicle-demo/pipeline_ed25519`，配置权限 0600。
6. 经 loopback kubectl/SSH port-forward，向 `uv run scripts/init-lake.py` 的 stdin 传入 `endpoint`、`access_key`、`secret_key`，设置并回读 8 天生命周期规则。
7. `helm upgrade ... --set processingEnabled=true --set reportsSuspended=true --wait`。检查实际 Flink 作业 RUNNING 和完成的检查点，不能只看 Pod Ready。
8. GCP 安装并运行 `configure-emqx.py`，仅配置带 `vehicle-pipeline:v1` 归属的 connector/action/rule；安装 `vehicle-emqx-metadata.service`，核验 action success、Kafka offset、Flink counts 和 Parquet 提交。
9. 创建一次 `kubectl create job vehicle-summary-manual-<唯一后缀> --from=cronjob/vehicle-summary -n vehicle-pipeline`，核验 SQL、API、页面和观测云后启用 `--set reportsSuspended=false`。
10. GCP 使用 `scripts/vehicle-demo/install-web.py` 维护视频、输入和精确报表 GET 路由；不再发布旧车机前端。历史报表使用 `vehicle_reader`，无写权限。工作台与播放器的本地部署见 [运行说明](../../scripts/vehicle-demo/local/README.md)。

## 日常核验

```sh
helm list -n vehicle-pipeline
kubectl get deploy,pods,cronjobs,jobs -n vehicle-pipeline
kubectl top pods -n vehicle-pipeline
kubectl top nodes
kubectl logs -n vehicle-pipeline deployment/vehicle-control --tail=20
kubectl logs -n vehicle-pipeline deployment/vehicle-flink-jobmanager --tail=30
curl -fsS https://35.241.68.75.nip.io/vehicle-demo/api/report
```

API `batch.run_id` 是成功输出批次；`jobs` 包含更新的失败/运行中尝试，两者不能混淆。检查 `lineagePending`、`batch.stale`、组件 `last_seen_at`、Flink `engineState`、原子 `counts` 和 `lastCheckpointId`。短暂取不到引擎时保留最后观测并由页面标记过时，不能伪造 COMPLETE。

Flink 计数在处理时增长，文件在检查点完成后可见，Spark 使用更早的固定快照，所以三层计数不要求在同一秒相等；应按 eventId/sequence 与选定快照核对。直接写入 Kafka 的受控测试样本不计入 EMQX 原生转发量。

## 升级注意

- 保持 source/operator/sink UID、去重状态名称、计数 state 名称稳定。
- 线上 HA job graph 包含序列化 UDF；`CleanAndDetect.serialVersionUID = -1526613859223632353L` 对应首次部署。仅增加方法也可能改变自动生成的 UID。改变状态结构应先设计 savepoint 迁移，不能删除 HA/检查点绕过恢复失败。
- 当前 HashMap 去重状态使用 JVM heap，`taskmanager.memory.managed.fraction=0.0` 将无用的 managed memory 分给 heap。不要机械套用 RocksDB 的内存配置。
- Spark 容器的 UID 10001 必须对应 `/etc/passwd` 中的 `app` 用户；仅写 `USER 10001` 会导致 Hadoop `KerberosAuthException`。
- 原始发布镜像不覆盖，更新镜像标签和 digest 后再 Helm 升级。验证运行镜像、Job 状态、API 批次及原商城 Helm revision，不能把 Git 同步当成部署。

## 暂停与回滚

1. 先 `kubectl patch cronjob vehicle-summary -n vehicle-pipeline --type merge -p '{"spec":{"suspend":true}}'` 暂停新汇总。
2. 需要停止流量时，通过 EMQX 管理 API 禁用**仅** `vehicle_to_kafka` 规则；保留 Android→EMQX 的原始 MQTT 流。正常排障可保留规则，让有界磁盘缓冲暂存。
3. 回滚到已验证的 Helm revision：`helm rollback vehicle-pipeline <revision> -n vehicle-pipeline --wait`。含旧 UDF 或旧指标适配器的修订不适合作为当前代码回滚目标；先检查对应镜像和状态兼容性。
4. 完全停用时 scale 本 namespace 的 Deployment 为 0，停止 GCP 的 `vehicle-emqx-metadata`、`vehicle-pipeline-tunnel`。Caddy 只移除 `BEGIN VEHICLE REPORT` 区块并 validate/reload，原车机和商城区块保留。
5. 默认保留 Kafka/S3 PV、`vehicle_analytics`、Secret、HA ConfigMap 和运行证据。删除数据库、数据目录、namespace 或 SSH 身份需要单独决定；卸载 Helm 不等于已备份数据。

EMQX 迁移后还需保留其 PVC 与 Secret；回滚到 revision 9 之前会移除新 broker 工作负载，必须先完成连接和持久数据的协调回切，不能仅执行 Helm rollback。

## 发布范围

主站 `.github/workflows/release-images.yml` 只发布 Gateway、Order、Inventory、Payment、Game 五个镜像；不会自动发布车机处理链路、指标采集器或本地工作台。

`vehicle-pipeline/scripts/build-images.sh` 会测试、构建并推送 Flink、Spark、Control 镜像，须显式传入未使用的新标签。指标采集器使用 `vehicle-pipeline/Dockerfile.metrics` 独立构建。升级前将相应 image/digest 写入部署值；仓库现有 digest 代表此前发布产物，不代表本次本地源码。

`deploy/values-ack.yaml` 启用处理服务、EMQX 和汇总调度；指标默认关闭，启用时需配置 `metrics.enabled=true`、`metrics.workspace` 及已有只读 Secret/DataKit 目标。见 [指标采集说明](../../vehicle-pipeline/metrics/README.md)。节点名称、存储目录、Secret 与数据库必须匹配目标 ACK，不能把当前 overlay 当作通用集群安装参数。
