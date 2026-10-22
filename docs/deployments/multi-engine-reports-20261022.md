# 多引擎经营报表部署验收（2026-10-22）

2026-10-22 15:33–15:52（Asia/Shanghai）在 Demo 的 `observability-demo` namespace 验收完成。原 Python pipeline 保持运行，Java 经营日报、真实 Apache Spark SQL 趋势和商城报表已连接真实订单汇总。所有本记录数字均为验收时快照，后续订单和定时任务会持续更新。

入口：[商城经营报表](http://120.79.13.13:31080/reports.html?lang=zh)，也可从商城顶部「经营报表」进入。观测云在「观测云演示Demo → 数据可观测」查看四个作业与完整上下游血缘。

## 生效版本

| 组件 | Helm release / revision | Chart / App Version | 状态 |
| --- | --- | --- | --- |
| 商城五个 Java 服务 | demo / 35 | 2.4.4 / 2.4.4 | 全部 1/1 Ready |
| Java / Spark 报表作业 | mall-reports / 2 | 0.1.0 / 0.1.0 | 两条 CronJob 已启用 |
| 既有 Python pipeline | mall-data / 3 | 0.1.1 / 0.1.1 | 原配置、镜像、调度保持不变 |

商城升级前为 revision 34，Chart/appVersion 2.4.1、实际镜像和 config 2.4.3；本次统一到 2.4.4。五个运行镜像、`DD_VERSION`、`/api/demo/config.version`、RUM version 均核验为 2.4.4。商城与游戏的 SourceMap 均以 version `2.4.4`、env `demo` 上传并合并成功，未覆盖旧版本。

MySQL、Redis Deployment spec 和 generation 保持不变，现有数据库 Secret 未改变。除 version 外 `/api/demo/config` 全部字段与基线一致；Android APK 仍为独立版本 `2.3.32`、最低 Android `7.0`，播放器版本保持原值。

## 不可变镜像

所有镜像位于 `pubrepo.jiagouyun.com/demo/observability-demo-*`，均已核验 `linux/amd64` 与 `linux/arm64`。报表 release 使用 manifest digest 固定镜像。

| 镜像 | 版本 | Manifest digest |
| --- | --- | --- |
| gateway-service | 2.4.4 | `sha256:6a006e8e3820f9a97a42869f874594789add79868d14bc5461f10e8e164bf048` |
| order-service | 2.4.4 | `sha256:ea5ce5ee321be94b435d31f3db1376bff70357afe10c5814b7984963062817eb` |
| inventory-service | 2.4.4 | `sha256:b707fcf6bbb182a4eb5327593dc0632600d18928f5e9cf25166e6799616a4fe7` |
| payment-service | 2.4.4 | `sha256:9ca705715d5cfb920e2d9f1d0ab22d7e58570b0ef88cc070555b2c38fea8240b` |
| game-service | 2.4.4 | `sha256:5e22817d8db42cf3a9fa79b0b6e3432d75137fcc9f059c22c180b5215ddccf22` |
| report-jobs | 0.1.0 | `sha256:586179338da4131a9c378704e980f93d14426a36a0c090ad88df8a1bab079203` |

未覆盖已发布 tag。Web 镜像源代码哈希为 `2efd8c52badd3883c612024614a5ef6b3c205dbfda3f0cc5c4e1b04a69d9e0c8`，报表源代码哈希为 `1109b239cf5e3cf726045d2bbeac0c7022d26ebb166560139dcf0186876c9547`；验收时逐文件与构建清单核对一致。构建以 `tree-sha256` 标识尚未提交的源树，基线提交为 `0faeb71`。

本次不推送 Git、不创建 release tag；发布前已检查 `personal` 与 `origin` 均不存在 `v2.4.4`。这些远端尚未同步本次变更，因此不声称 Git 发布已完成。

## 真实数据与自动调度

Java `business_daily` 使用 JDBC 读取 Python 日销售汇总，计算日报并补齐七天；`sales_trend` 日志确认 Apache Spark `3.5.8`、`local[2]` 实际执行 Window SQL。

- Java 自动任务 `mall-reports-daily-29877586`：15:46:00 启动，成功结束，exit 0。
- Spark 自动任务 `mall-reports-trend-29877587`：15:47:00 启动，成功结束，exit 0。
- 原 Python CronJob spec、Helm release 信息与基线一致；升级期间和之后仍自动成功执行。

验收批次：

| 指标 | SQL / API 一致值 |
| --- | --- |
| 日期 | 2026-10-16 至 2026-10-22 |
| 成交订单 | 9,506 |
| 售出件数 | 9,507 |
| 营业额 | ¥941,123.00 |
| 平均客单价 | ¥99.00（页面显示精度） |
| 每个输出表行数 | 7 |
| 累计报表血缘事件 / 待发送 | 36 / 0 |

Python source Run ID：`4ad9e038-c379-4498-8c03-826a1f7dc9a2`；Java Run ID：`f1ee2125-f977-4705-b91e-bcab5a6d65b7`；Spark Run ID：`42c52e26-52eb-4ea5-a32e-78f5399af692`。

已逐日比较 Python 汇总、Java 日报、Spark 趋势与 API 的订单数、件数、营业额，并比较 Spark SQL 与 API 的移动平均、累计值和环比。所有展示字段来自同一 Spark 成功批次，当天 `partial=true`、环比为 null。

## 故障与控制台验收

| 场景 | 结果 |
| --- | --- |
| 手动 Java 日报 / Spark 趋势 | 成功，输出七行，事件送达 |
| fail-daily | DELETE 后失败，exit 2；两张报表表全行哈希与之前相同 |
| Java 恢复 | COMPLETE，新成功批次可供 Spark 消费 |
| fail-trend | 实际 Spark 计算后注入失败，exit 2；趋势表全行哈希不变 |
| 页面失败状态 | 显示最近作业失败提示，保留上一成功报表 |
| Spark 恢复 | COMPLETE，页面恢复成功状态 |
| 观测云作业 | `orders_clean` / `sales_aggregate` 为 PYTHON，`business_daily` 为 JAVA，`sales_trend` 为 SPARK |
| 完整血缘 | 5 个表节点 + 4 个作业节点、8 条边连续连接 |
| 页面操作 | 商城入口、中英文、营业额/订单量切换、日期选择、刷新成功 |
| 窄屏 | 同一构建静态资源在 390px 容器验证中英文布局，无横向页面溢出 |

首次在新节点拉取报表镜像约 90 秒，随后 Spark 计算约 6–7 秒。当前依赖组合会打印 SLF4J 无绑定提示，作业使用的结构化 stdout、数据库状态和 OpenLineage 事件正常；Spark 内部 debug 日志未启用。部署没有常驻 Spark 集群。

## 验证范围与证据

- 原 Maven 工程 79 项测试通过；报表工程 8 项 JUnit（含真实 MySQL / Spark）、2 项 bootstrap 测试通过。
- 6 项 Java Agent 合约、9 项 Workshop 安装合约通过；Compose 配置可渲染。
- 10 条 SDK 事件通过官方 OpenLineage 2-0-2 Schema 校验；真实 HTTP 测试验证 X-Token、重试与缓存成功响应。
- JS 语法、Helm lint（含 EKS/Workshop 配置）、ShellCheck、actionlint、Ruff、空白检查通过；Kubeconform 验证商城 19 个和报表 2 个 Kubernetes 资源均有效。
- 发布镜像逐一核验双架构与源码哈希；线上商城 smoke test 通过，包含登录、下单、支付故障/恢复和日志读取，结束时故障全部关闭。
- 仓库自定义敏感信息规则与 Git 源文件范围的 Gitleaks 扫描通过。忽略的本地证据、缓存和环境凭据不作为源码提交。
- 本轮未运行 GitHub 远端 CI / CodeQL，也未另起 Compose、Kind 全套 E2E；已运行本次变更的测试、配置检查和实际 Demo Kubernetes 端到端验收。

本地证据目录：`owl-reports/multi-engine-reports-20261022/`（不提交运行环境数据）。核心文件为 `acceptance.json`、`scheduled.json`、`report-api.json`、各 Job JSON/log、`web-release.json`、`sourcemap-upload.json`、构建清单与镜像 manifest。

截图包括 `01-report-failure-preserved.png`、`02-report-success.png`、`03-guance-jobs.png`、`04-full-lineage.png`。在线定时数据持续变化，截图仅代表捕获时刻。

## 回滚

```bash
# 管理机，暂停新增自动报表。
cd /root/multi-engine-reports-20261022
scripts/report-jobs.sh suspend

# 商城恢复升级前已验证 revision。
helm rollback demo 34 -n observability-demo --wait --timeout 8m
```

回滚保留新报表表、账号和历史血缘；原 Python release 不需要改变。若只回滚报表镜像，使用新的 Helm revision 指向已验证旧 digest，不覆盖 registry tag。卸载/删除数据库数据不属于本次操作。
