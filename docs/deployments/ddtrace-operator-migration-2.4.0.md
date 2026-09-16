# Demo 2.4.0 发布候选与 ddtrace Operator 迁移

本文件是发布准备记录，不代表正式环境已经部署。

## 本批内容

- 紧凑小游戏大厅、真实商城登录、飞机大战及本地托管的开源植物大战僵尸。
- 游戏 iframe 等比例缩放、生命周期和 ResizeObserver 修复。
- 游戏 RUM/View/Action、Replay 帧率与清晰度修复和版本对应符号包。
- Android 2.3.17 及现有 Replay 补丁；真实 APK、播放器与控制桥的固定命令通信。
- Web Android 故障注入、恢复、RUM View/真实 Trace 链接，商城样式侧栏和底部参数收纳。
- 游戏后端拆分为独立 `game-service`，详见 [拆分验收记录](game-service-split-2.4.0.md)。
- Java Agent 从内置 v1.55.10-ext 迁移到外部注入 v1.65.6-ext。

Web/五个 Java 服务统一候选版本为 2.4.0。Android APK 继续使用独立的
2.3.17，播放器保持 20260915-apk-control-v1。不把 Agent 版本写进 DD_VERSION。

## 已实现的注入方式

五个 Dockerfile 只启动 `java -jar /app/app.jar`，不再打包 Agent。

| Helm ddtrace.mode | 用途 | 提供 Agent 的方式 |
| --- | --- | --- |
| initContainer（默认） | 无 Operator 的 Kind/EKS/普通集群 | 独立 initContainer + emptyDir + JAVA_TOOL_OPTIONS |
| operator | 正式迁移目标 | DataKit Operator 注入共享卷和 JAVA_TOOL_OPTIONS |
| legacy | 原有 2.3.x 镜像/固定 Workshop | 保留旧镜像自己的 Agent；显式禁止 Operator 注入 |
| disabled | 有意不采集的诊断运行 | 不注入 |

模板拒绝给已知 2.3.x 发布镜像开启第二个 Agent，也拒绝让 2.4.0+ 发布镜像
使用 legacy。自定义镜像 tag 仍必须检查实际 Entrypoint，不能只靠 tag 判断。

Compose 使用一次性 `ddtrace-init` 服务；五个应用等待复制成功后再启动，
只读挂载 Agent。`DDTRACE_VERSION` 同时决定镜像 tag 和共享卷名称，升级时
不会覆盖旧 JVM 正在使用的 JAR。它不是另一套 Gateway/Order 服务。
已有 GCP Compose 更新时必须同时使用新 compose 和五个无内置 Agent 的镜像，
不能把新 JAVA_TOOL_OPTIONS 配到旧镜像上。

## Operator 规则与安装前检查

规则文件：`observability/datakit-operator/demo-ddtrace-rule.json`。
其 namespace 正则为 `^observability-demo$`，且同时要求 Demo 应用 label 和
Java 注入 label。`check_annotation=true`，版本由 Pod annotation 控制。

1. 读取目标集群的 Operator 版本、Deployment、ConfigMap/jsonconfig 和
   MutatingWebhookConfiguration，确认支持 `admission_inject_v2.ddtraces`。
   当前本机没有配置 kubectl context，尚未执行目标集群的 admission 验收。
2. 已安装 Operator 时备份原配置，将 Demo 规则放在宽泛 Java 默认规则之前，
   保留其他租户规则与 `admission_inject_v2` 下其他配置，避免首条规则抢先匹配。
   未安装时按官方安装说明安装已固定版本的 Operator；先配置不匹配旧业务 Pod
   的规则，验证 webhook/certificate/RBAC/readiness，不能直接套全 namespace 默认规则。
3. 确认公共 init 镜像在目标节点可拉取；本次核对的多架构 manifest digest：
   `sha256:3344f190686335a7b34a8de2c76ffa61c1d195db5d10fb39193a9eafe5a20e15`。
   JAR SHA256：`320d6dc825c8d4599be153e030862b0cd511f63162be48b062ac1c8d3e0073cc`。
4. 使用真实集群的服务端 dry-run 创建候选 Pod，确认仅一个 Agent、对应 init
   容器与挂载、保留 DD_SERVICE/DD_ENV/DD_VERSION/DD_TAGS/hostIP/9529/8125。
   Operator 修改的是新 Pod，不会更改已运行 Pod。
5. 在不接入正式流量的候选服务先验证 admission、Java 启动、完整 Trace、
   Profiler、JVM 指标和自定义业务/fault 标签，然后执行统一 Helm 发布。

官方契约：
[DataKit Operator DDTrace](https://docs.guance.com/datakit/operator-ddtrace/)。

## 正式发布步骤

1. 整理当前工作区全部变更，审阅并冻结同一源码提交；代码提交与 main 推送见 Git 历史；tag 与正式发布单独执行。
2. 将候选源码发布为统一标签 v2.4.0，由 personal 仓库构建五个 amd64/arm64
   Harbor 镜像；验证镜像后再镜像相同提交/标签到 Guance origin。
3. 备份真实 Helm values、revision、Operator 配置和数据库；保护备份中的凭据。
   使用导出的用户 values 与新版 Chart defaults 合并，避免直接 reuse-values
   导致新增 ddtrace 默认字段缺失。
   复用现有 MySQL/Redis/PVC/NodePort/DataKit/RUM/workspace 配置。
4. 在现有 release values 基础上添加 `values-operator.yaml`，更新 image.tag=2.4.0。
   同批写入已有 GCP playerUrl、playerVersion、apkVersion 等元数据。
   本文件不提供默认密码或凭空生成 application ID。
5. lint/template/dry-run；确认全部五个应用镜像与 DD_VERSION/RUM Version 一致。
6. 在单服务候选验证通过后执行原 release 的 `helm upgrade --atomic --wait`。
   验证五服务 Ready、入口/登录/游戏/Android 控制及平台采集，恢复演示故障。
7. 上传与实际发布版本对应的 Web SourceMap；Android 使用独立的 2.3.17 符号包。
   当前仅打包，保持用户上传约定。

## 回滚

- 优先 Helm 回滚到备份的旧 revision：旧镜像、旧 Pod 模板一起恢复。
- Demo Operator 规则必须保持 opt-in label，确保旧 Pod 无注入 label 时不会被
  注入。不要只换旧镜像、却保留新 Operator 注入 annotation/label。
- 若新版业务必须保留而 Operator 异常，可通过一次 Helm 更新切回
  `ddtrace.mode=initContainer` 并保留同一 Agent 版本；明确禁用 Operator annotation。
- 保留原 Operator 规则备份，避免影响集群中其他业务。

## 本地证据与待验收项

- 五个 arm64 候选业务镜像已构建，Entrypoint 均只有普通 Java 启动。
- 59 Maven、43 游戏/Web/player、6 注入契约、9 Workshop 检查通过。
- Android 91 项测试、TypeScript、ESLint 通过（此前同批验证）。K8s Agent 复制步骤已以 UID/GID 10001 验证；Compose 新卷首次复制使用一次性 root 容器，应用仍为非 root，详见拆分记录。
- Helm 默认/EKS/Operator 和 Compose 均可渲染。
- 独立临时支付服务在 non-root、只读根目录、外部只读 Agent 挂载下 readiness=UP。
- Agent 日志确认 `1.65.6-ext`、`agent_error=false`、`profiling_enabled=true`；
  Demo 支付请求成功，日志携带真实 trace_id/span_id 和业务请求 ID。
- `/tmp` 必须允许 Profiler 的临时 native library 加载。验证容器最初使用
  Docker 默认 noexec tmpfs 时加载失败，改为专用 exec tmpfs 后通过；K8s
  保留现有可写 emptyDir，仍需在实际集群安全策略下验收。
- 尚未验证正式集群 Operator admission、五服务完整 Trace、云端 Profiler/JVM
  数据和本批正式发布后的 Replay；这些是发布闸门，不能用本地启动结果代替。
- 镜像信息/日志在 `dist/ddtrace-migration-2.4.0/`；Web 符号包为
  `dist/observability-demo-rum-sourcemap-2.4.0.zip`。
