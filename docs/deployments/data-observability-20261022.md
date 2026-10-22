# 订单数据可观测演示部署验收（2026-10-22）

已在 ACK 的 `observability-demo` 命名空间部署独立 Release `mall-data`，
接入「观测云演示Demo → 数据可观测」，每五分钟自动运行。
使用方式见 [操作手册](../data-observability.md)。

## 生效版本

| 项目 | 已核验的值 |
| --- | --- |
| Helm Release / revision | `mall-data` / `3` |
| Chart version / appVersion | `data-observability-demo-0.1.1` / `0.1.1` |
| Python 包 / 镜像 tag | `0.1.1` / `0.1.1` |
| 镜像仓库 | `pubrepo.jiagouyun.com/demo/observability-demo-data-pipeline` |
| 线上固定 digest | `sha256:a39cf7552be0fd4f7b3ae748ced94bfbfdfc6b8f5f370d7cefcac17d5b12a886` |
| 平台 | `linux/amd64`、`linux/arm64` |
| CronJob | `mall-data-pipeline`，`*/5 * * * *`，`suspend=false` |
| Job namespace | `mall-demo.data-pipeline` |
| Dataset namespace | `mysql://demo-observability-demo-mysql:3306` |

本次从未提交的工作树构建；构建基线是 `b02dba3924ef46d81bc634b5f53e372036f4cd7f`，
运行时代码及构建输入的 SHA-256 为
`b574d95416a4412c57528e7e90521ad3478df5873bc3c1f7eb2bf2fdd22503ae`，
已写入镜像 `org.opencontainers.image.revision=tree-sha256:...` 标签。
各文件摘要保存在本地 `build-source.json` 中；基线提交不包含本次新增代码。

首次发布的 `0.1.0` 保留；其 Bearer 请求被接收端以 `dataway.emptyToken` 拒绝。
`0.1.1` 改用实测有效的 `X-Token`，未覆盖旧镜像 tag。
升级后成功补发原事件，保持原 Run ID，业务表内容摘要不变。
本次未创建 Git tag、推送分支或执行远端仓库同步。

## 线上数据与调度

首个自动 Job `mall-data-pipeline-29877335` 在北京时间 11:35:00 启动，
11:35:09 完成，退出码 0；实际 Pod 镜像与上述 digest 一致。

| 项目 | 11:35 首次自动运行结果 |
| --- | ---: |
| 提取源订单数 | 9,399 |
| 清洗后订单数 | 9,257 |
| 排除记录数 | 142 |
| 商品件数 | 9,258 |
| 销售额（分） | 91,653,200 |
| 每日汇总行数 | 7 |
| 已投递 OpenLineage 事件累计 | 63 |
| 待投递事件 | 0 |

窗口为北京时间 10 月 16 日零点到作业启动时刻，左闭右开。
订单持续生成，后续运行数量会变化。销售额直接求和订单总金额，不再乘数量。

## 场景验收

| 场景 | 作业状态 / 退出码 | 已核验结果 |
| --- | --- | --- |
| 正常运行 | COMPLETE → COMPLETE / 0 | 9,393 条输入清洗为 9,251 条，汇总为 7 行 |
| 清洗失败 | FAIL → ABORT / 2 | DELETE 后注入失败；两张输出表完整内容 SHA-256 均与故障前相同 |
| 恢复 | COMPLETE → COMPLETE / 0 | 两阶段恢复成功，清洗 9,253 条 |
| 汇总失败 | COMPLETE → FAIL / 2 | 清洗更新为 9,254 条；汇总表内容及处理时间的 SHA-256 与恢复场景相同 |
| 慢作业 | COMPLETE → COMPLETE / 0 | 汇总阶段 30,108 ms；观测云显示 00:00:30，随后恢复成功 |
| 补发 | 不新建业务运行 / 0 | 原 JSON / Run ID 补发，业务表内容不变 |
| 定时调度 | COMPLETE → COMPLETE / 0 | CronJob 自动创建 Job，两阶段成功，待投递为 0 |

观测云控制台已实际确认：

- 作业列表显示 `orders_clean`、`sales_aggregate`，失败详情有对应 Run ID 和回滚原因。
- 数据目录有源表、清洗表和每日销售表，类型 TABLE、平台 MYSQL。
- 清洗表详情显示 8 个 Schema 字段及类型、最近输出 9,257 行，包含自动、慢作业和失败记录。
- 血缘深度选「全部」后显示三张表、两个作业及四条依赖边，当前全部成功。

## 质量验证

- 22 个单元、Schema、Chart、传输及初始化脚本用例通过。
- 3 个隔离 MySQL 8.4 / HTTP 集成用例通过，覆盖实际 SQL、金额口径、重复运行、
  两种回滚、源表写入拒绝、互斥锁、中断恢复及原事件补发。
- Ruff、mypy、Helm lint、Helm 服务端 dry-run、ShellCheck、actionlint、Shell 语法检查通过。
- 双架构构建、manifest 和非 root / 只读文件系统启动检查通过。
- 管理机 Python 3.6.8 两次执行 bootstrap 成功；先持久化 Secret 再操作数据库，
  重试不生成新口令。Worker 使用 Python 3.12。
- 本次 28 个文件的仓库凭据规则与 Gitleaks 扫描通过；运行时代码文件摘要与发布镜像构建输入一致。
- 本次未改 Java/Web/Android，未将这些组件的测试列为本次通过项。

## 原商城基线

部署前后，7 个既有 Deployment 的 generation 和镜像完全相同；
原 `demo` Release 仍为 revision 34、Chart/App Version 2.4.1；
Java 运行镜像和 `/api/demo/config` 版本仍为 2.4.3，配置响应完整一致。
Chart/App 2.4.1 与运行时 2.4.3 的差异为本次之前已存在的版本漂移。
新增组件未修改商城 Java、Web RUM、SourceMap 或 Android APK 版本。

## 证据与复现

本地证据目录为 `owl-reports/data-observability-20261022/`，按仓库规则不提交原始证据：

- 各场景 `*-job.json`、`*-job.log`：Job、镜像、退出码和运行日志。
- 各场景 `.json`：业务表内容摘要、汇总值、事件队列与运行状态，不保存订单明细。
- `baseline-*` / `after-*`：既有部署、Helm 和配置接口比较。
- `build-source.json`、`image-manifest.txt`：构建输入和双架构镜像身份。
- `02-catalog.png`、`03-failure-jobs.png`、`04-failure-detail.png`、
  `05-lineage.png`、`06-catalog-detail.png`、`07-schema.png`：控制台截图。

管理机工作目录 `/root/data-observability-demo-20261022`。手工演示先执行
`scripts/data-observability.sh suspend`，依次运行故障和恢复场景；每次等待上一 Job 结束。
演示后执行 `scripts/data-observability.sh enable`。完整步骤和 SQL 见操作手册。

## 回滚

执行 `scripts/data-observability.sh suspend`，等待运行中的 Job 结束，
再执行 `scripts/data-observability.sh uninstall`。仅卸载 `mall-data`，
保留分析库、专用账号和 Secret 以便检查与补发；源订单和原商城 Release 保留。
