# Java 经营日报、Spark 销售趋势与商城报表

这个扩展保留已有 Python `0.1.1` pipeline，在真实订单销售汇总后增加 Java 经营日报和 Apache Spark SQL 销售趋势。商城 `2.4.4` 提供「经营报表」入口，独立报表作业版本为 `0.1.0`。

```mermaid
flowchart LR
  A["selfheal.demo_orders"] --> B["Python · orders_clean"]
  B --> C["mall_analytics.demo_orders_clean"]
  C --> D["Python · sales_aggregate"]
  D --> E["mall_analytics.demo_sales_daily"]
  E --> F["Java · business_daily"]
  F --> G["mall_reports.demo_business_daily"]
  G --> H["Spark SQL · sales_trend"]
  H --> I["mall_reports.demo_sales_trend"]
  I --> J["商城经营报表"]
```

四个作业都上报 OpenLineage，数据库 namespace 和 job namespace 保持一致，观测云能够显示一条连续血缘。新增 Java/Spark 作业使用 OpenLineage Java SDK `1.54.0` 显式记录输入输出、Schema、批次、行数、运行状态及错误；Spark SQL 本身由 Apache Spark `3.5.8` 的 `local[2]` 引擎执行。此实现没有启用 SparkListener 自动发现整个 Spark 应用的血缘。

## 指标与数据一致性

- 处理窗口沿用 Python pipeline：北京时间近 7 个自然日，包含尚未结束的当天。Java 根据上游清洗作业的窗口日期补齐无成交日期。
- `amount_cent` 是整单总金额，不能再乘 `qty`。营业额、订单数、售出件数直接沿用已确认且有效的订单汇总。
- Java 计算每日客单价、营业额占比，补齐零销量日期；金额保持整数分，除法使用 DECIMAL。
- Spark 执行 `LAG`、最近 3 行 `AVG` 和累计 `SUM`，生成日环比、3 日移动平均、累计营业额。当天未结束、前日缺失或前日营业额为零时，环比为 `null`。
- 两个作业以 MySQL 一致性快照读取同一已提交批次，校验 Run ID。页面只从一个成功的 Spark 批次读取全部指标，不混用最新 Java 表与旧 Spark 表。
- 输出表替换和 `COMPLETE` 事件在同一事务提交。计算失败或注入故障会回滚，保留最近成功结果；页面显示失败状态、源数据截止时间与报表生成时间。
- 来源超过 15 分钟时，作业报告 `ABORT / UPSTREAM_STALE`，页面将旧结果标为过期，不显示为新数据。

页面位于 `/reports.html`，API 为 `GET /api/reports/sales`。支持中文/英文、营业额/订单量趋势、日期选择、每日明细和来源批次。页面可手动刷新，在可见时每 60 秒检查新数据；后端作业每 5 分钟执行。商城入口在新窗口打开，保留原商城页面及其 Replay 上下文。

## 安装

前提：已部署商城 MySQL 和 [Python 数据 pipeline](data-observability.md)，管理机可运行 `kubectl`、Helm 与 Python 3.6+。Worker 使用 Java 17；Spark 为进程内临时作业，不需要常驻 Spark 集群。

```bash
# 创建 mall_reports 表、受限数据库账号和两个 Kubernetes Secret。
# 从既有 pipeline 的 Secret 复用 OpenLineage token，全程不打印凭据。
python3 scripts/report-jobs-bootstrap.py

# 默认暂停，先验收手动作业。
scripts/report-jobs.sh install
scripts/report-jobs.sh run daily
scripts/report-jobs.sh run trend
scripts/report-jobs.sh status
scripts/report-jobs.sh logs <Job名称>
```

首次安装商城报表功能时，合并原环境配置与新 Chart 默认值，设置 `reports.enabled=true`、`reports.secretName=mall-report-reader` 和已发布商城镜像版本；不要丢弃原数据库、RUM、DataKit 或 Android 配置。使用新 Chart 时直接复用旧 values 可能遗漏新增默认项，应使用受保护的环境 values 文件传入 Helm。

验证手动结果、页面和血缘后启用调度：

```bash
scripts/report-jobs.sh enable
scripts/report-jobs.sh status
```

Python 保持 `*/5 * * * *`；Java 默认 `1-56/5 * * * *`，Spark 默认 `2-57/5 * * * *`。错峰减少等待，一致性由已提交批次和校验保证；前一批尚未完成时仍可消费最近成功且未过期的批次。

生产式部署建议把 `image.digest` 固定到已验证的多架构摘要。默认 Spark 限制 2 CPU / 1536 MiB，JVM heap 896 MiB；Java 日报限制 1 CPU / 384 MiB。Pod 非 root、只读根文件系统、禁用 ServiceAccount token，临时 Spark 文件写入受限 `emptyDir`。

## 故障与恢复

```bash
scripts/report-jobs.sh suspend
scripts/report-jobs.sh run daily
scripts/report-jobs.sh run trend
scripts/report-jobs.sh run fail-daily
scripts/report-jobs.sh run daily
scripts/report-jobs.sh run fail-trend
scripts/report-jobs.sh run trend
scripts/report-jobs.sh run replay
scripts/report-jobs.sh enable
```

`fail-daily` / `fail-trend` 在输出表 `DELETE` 后故意失败，用于验证事务回滚。故障只影响本次手动作业，不写入定时任务配置。演示期间可同时查看商城的旧报表保留提示和观测云 `FAIL` 记录。

独立的 `report_runs` / `report_outbox` 与 Python 状态表隔离。`START` 先持久化，成功结果与唯一终态原子提交；持有互斥锁后将中断的 `START` 恢复为 `ABORT`。HTTP 失败保留原始事件 JSON 和 Run ID，下一次执行或 `replay` 按顺序重放。发送使用 `X-Token`，对 429 / 5xx 有限重试，拒绝跳转；`dataway.cached` 视为已接收。保留最近 7 天已完成记录，未送达事件不清除。

| 退出码 | 含义 |
| --- | --- |
| 0 | 本次作业与事件发送成功 |
| 1 | 配置或基础设施错误 |
| 2 | 业务作业 FAIL / ABORT，包括注入故障或上游过期 |
| 3 | 事件发送失败，待重放 |
| 4 | 另一报表作业持锁，当前跳过 |

观测云「数据可观测 → 作业」应看到 `business_daily / JAVA`、`sales_trend / SPARK`；「数据血缘」选择 `business_daily`、上下游、全部深度，应连通现有两个 Python 作业和五张表。作业错误是有限的分类码，不发送订单行值、数据库密码或 token。

## 数据库权限与 API 状态

`mall_reports_writer` 只能读取 `mall_analytics.demo_sales_daily` / `pipeline_runs`，并在 `mall_reports` 内读写；不具备运行时建表、删除表或修改源订单权限。`mall_reports_reader` 只读趋势表与运行状态表。Bootstrap 先保存有归属标记的 Secret 再建账号，支持安全重试；遇到不属于本组件的 Secret 或缺少对应 Secret 的同名账号会拒绝覆盖。

API 使用独立只读连接池，最大 2 个连接、短连接和查询超时。报表未配置不阻塞商城启动，返回 `disabled`；尚无成功结果返回 `empty`；查询异常返回 HTTP 503 和 `REPORT_DATABASE_UNAVAILABLE`，不返回驱动原始报错。公开 Gateway 只放行新增的四个精确只读路径。

## 开发验证

```bash
# 启动一次性 MySQL 8.4，执行真实 MySQL + Spark 测试，然后清理容器。
report-jobs/integration.sh
python3 -m unittest discover -s report-jobs/tests
mvn -pl order-service,gateway-service -am test
helm lint charts/report-jobs
helm lint charts/observability-demo
node --check order-service/src/main/resources/static/assets/reports.js
bash -n scripts/report-jobs.sh report-jobs/integration.sh
sh -n report-jobs/entrypoint.sh
```

测试覆盖多件订单金额、空日期、零分母、跨午夜窗口、真实 Spark 窗口计算、故障回滚、读写权限、互斥锁、中断恢复、原样事件重放、HTTP 重试及 API/Gateway 行为。CI 位于 `.github/workflows/report-jobs.yml`。

## 回滚与验收

暂停报表使用 `scripts/report-jobs.sh suspend`。商城可回滚到升级前 Helm revision；新报表表与已采集血缘保留用于检查，不修改原 Python pipeline。卸载报表 release 不自动删除业务表或账号。

[2026-10-22 部署验收记录](deployments/multi-engine-reports-20261022.md) 记录实际镜像摘要、Helm revision、自动运行与对账结果。
