# 可观测信号与字段

| 信号 | 来源 | 关键关联字段 |
| --- | --- | --- |
| Kubernetes/容器指标 | DataKit container、kubernetesprometheus | `project`、`cluster_name_k8s`、`pod_name`、`container_name` |
| eBPF 网络可观测性 | DataKit ebpf-net、ebpf-conntrack | `project`、`src_*`、`dst_*`、`direction`、`family`、NAT 与 HTTP/DNS 字段 |
| APM Trace | DDTrace Java Agent | `project`、`trace_id`、`span_id`、`service`、`env`、`version`、Gateway 路由与来源字段 |
| 应用日志 | stdout + `datakit/logs` Annotation | Trace 字段、业务字段、故障字段、进程/Pod/容器字段、Gateway 路由与来源字段、Java 错误字段 |
| JVM 指标 | Java Agent → StatsD `8125` | `project`、`service`、`env`、JVM measurement |
| Profiling | Java Agent → Profile `9529` | `project`、`service`、`env`、`version` |
| RUM / Browser Logs / Replay | Browser SDK → `/rum-proxy` → DataKit | `project`、application、session、view、业务/故障上下文 |

统一产品标签为 `project=mall-demo`，由 DataKit global tag、Kubernetes label、Java Agent `DD_TAGS`、应用日志与浏览器全局上下文共同设置。统一日志 `source` 为 `java_selfheal_demo`。DataKit 不绑定本地 Pipeline，采集时保留完整原始 `message`；以下字段由平台 Pipeline 从日志内容中解析：

- 产品：`project`。
- 业务：`key_request`、`biz_request_id`。
- 用户身份：`visitor_id`、`user_id`、`user_tier`、`auth_state`。这些值在日志中保留为字段，不提升为 Tag；`user_id` 和 `user_tier` 只接受 order-service 会话解析后的值。
- 语言：`language`，值为 `zh` 或 `en`。
- 故障：`fault_id`、`fault_layer`、`fault_kind`、`fault_target`。
- 链路：`trace_id`、`span_id`、`service`、`env`、`version`。
- 运行身份：`process_id`、`host_process_id`、`container_process_id`、`host`、`host_name`、`pod_name`、`pod_namespace`、`container_name`、`container_id`。
- Gateway 路由：`route_class`、`traffic_type`，在 Pipeline 中提升为低基数 Tag。
- Gateway 来源：`client_ip`、`user_agent`、`referer`，保留为高基数字段；`client_ip` 依次使用 `X-Forwarded-For` 首项、`X-Real-IP` 和连接对端 IP。
- Java 错误：仅 `status=ERROR` 时生成 `error_type`、`error_message`，存在可识别的真实 Throwable 时再生成 `error_stack`；三个字段均保留为 Field。

平台 Pipeline 的规则保存在 `observability/platform-log-pipeline.p`，用于 Workshop 中手工创建并测试中央 Pipeline。规则将业务正文提取到 `log_message`，不会覆盖完整的原始 `message`。

## Java 错误日志与平台 Pipeline

### 采集与字段行为

Kubernetes Annotation 和 Compose 的 `datakit_logs_config` 都使用下面的首行匹配规则：

```text
"^\d{4}-\d{2}-\d{2} "
```

每个以 `yyyy-MM-dd ` 开头的行会开始一条新日志；Java Exception、`at`、`Caused by` 和 MyBatis `###` 等非时间戳续行会合并进上一条 `message`。Pipeline 无法重新拼接已经作为多条数据上报的堆栈，因此必须先部署多行配置，再启用错误 Grok。

Pipeline 的输出规则如下：

| 输入 | 错误字段输出 |
| --- | --- |
| INFO/WARN | 不生成 `error_*` |
| ERROR 且识别到 Java 堆栈 | 实际 `error_type`、`error_message`、完整 `error_stack` |
| ERROR 但堆栈格式未识别 | `logger_name` + 首行 `log_message`，不生成 `error_stack` |
| ERROR 本身没有堆栈 | `logger_name` + 首行 `log_message`，不生成 `error_stack` |

`message` 始终保留采集到的完整原文，`log_message` 只保存时间戳首行中的业务正文。Gateway 和 Order 会把捕获的 Throwable 作为 SLF4J 最后一个参数输出，因此重新部署后的相应 ERROR 可以得到真实堆栈；Inventory 原本就具备这一行为，Payment 暂无对应错误样本。

### 在观测云创建 Pipeline

1. 先重新部署 Demo，并在日志查看器确认一次 Java 异常只形成一条 `source=java_selfheal_demo` 日志，且 `message` 包含 Exception、`at`、`Caused by` 等完整续行。
2. 进入**工作空间管理 > Pipelines > 新建 Pipeline**，选择**中心 Pipeline**、数据类型**日志**。
3. 名称填写 `java_selfheal_demo`，过滤条件精确限定 `source` 为 `java_selfheal_demo`，开启中心 Pipeline 处理转发数据。不要设为其他日志来源的默认 Pipeline。
4. 将 `observability/platform-log-pipeline.p` 的完整内容粘贴到“定义解析规则”。自定义 Pattern 必须位于第一个 `grok()` 之前。
5. 在“样本解析测试”中分批粘贴 `observability/fixtures/logs/` 下五个文件的完整内容。平台每次最多添加三条样本，因此至少测试两轮。
6. 确认 INFO 不含 `error_*`；无堆栈 ERROR 只有 `error_type/error_message`；三个堆栈样本还包含 `error_stack`；所有样本继续包含原有 Trace、业务字段和完整 `message`，然后保存。
7. 只用保存后新产生的日志验收。分别触发 Inventory、Gateway 和 Order 错误，并在**日志 > 错误追踪**按 `source=java_selfheal_demo`、`service` 检查错误类型、消息、格式化堆栈和关联上下文。

中心 Pipeline 在数据上传后处理，属于付费功能。如果工作空间使用本地 Pipeline，应在同一创建页面选择本地类型并保持精确的 Source 绑定；DataKit 默认每分钟拉取一次远程 Pipeline。不要同时为同一 Source 保留两套行为不同的规则。

### 启用错误中心聚合

Pipeline 生成字段后，还需要创建日志错误投递规则：

1. 进入**错误中心**，点击右上角**创建**，进入**管理 > 错误中心 > 新建规则**。
2. 数据类型选择**日志**，选择 Demo 日志所在索引。
3. 添加过滤条件 `source in java_selfheal_demo`；需要进一步降噪时再增加 `status in ERROR` 或限定 `env`。
4. 保存并触发新的错误。在错误列表按日志来源和 `service` 检查聚合结果。

带堆栈日志使用 `error_type + error_message + error_stack` 生成指纹，无堆栈日志使用 `error_type + error_message`；日志 Issue 再由 `service + fingerprint` 区分。因此 `error_*` 字段不能缺失，`service` 也必须保持稳定。

### 新增的平台能力

- ERROR 日志自动进入日志错误追踪，集中按服务、环境、Pod、容器等维度查询。
- 详情页结构化展示异常类型、异常消息和真实 Java 堆栈，同时仍可查看完整原文。
- 相同根因按错误指纹和 `service` 聚合为 Error Issue，展示首次/最近发生时间、累计次数和趋势，并支持认领、状态流转和协作记录。
- 保留的 `trace_id/span_id` 可把日志错误关联到调用链；`service`、主机/Pod/容器字段可继续关联上下文日志、基础设施和 eBPF 网络数据。
- Gateway、Order 与 Inventory 的真实 Throwable 提供代码行级定位；旧的或无法识别的无堆栈 ERROR 仍能以两字段方式进入错误追踪和错误中心，不会虚构堆栈。
- 现有业务、用户、故障和路由字段全部保留，可继续按 `biz_request_id`、`fault_id`、`route_class` 等条件缩小故障范围。

### 上线验收与回退

- 确认下一条正常时间戳日志不会被追加到前一条异常，且超长堆栈没有触发 DataKit 单条日志长度截断。
- 确认 INFO/WARN 不进入错误数据范围，Inventory/Gateway/Order 各至少验证一次真实故障，且 HTTP 状态和正文没有变化。
- Pipeline 解析异常时可单独恢复旧脚本，原始 `message` 不受影响；Throwable 参数可独立回退以降低日志量；多行规则回退后堆栈会重新拆成多条日志，但不影响应用运行。

参考：[Pipelines](https://docs.guance.com/pipeline/)、[日志错误追踪](https://docs.guance.com/logs/log-tracing/)、[创建错误投递规则](https://docs.guance.com/errors/create-error-rule/)、[错误中心](https://docs.guance.com/errors/)。

Gateway Span 同步写入 `route_class`、`traffic_type`、`client_ip`、`user_agent` 和 `referer`。实际 DataKit 的 `inputs.ddtrace.customer_tags` 必须包含这些字段，才能在平台保存为可筛选的自定义 Span 属性。公网扫描告警可在限定 `service=gateway-service` 后追加 `route_class != "unmatched"`；日志监控器使用同名 Tag。

## Web 用户身份字段契约

- `visitor_id`：浏览器生成的 `visitor-<uuid>`，保存 60 天；用于访客 UV，不参与鉴权。
- `userid`：RUM SDK 的账号身份字段，仅在登录后由 `setUser` 写入；不能与 SDK 自动生成的匿名值直接混算账号 UV。
- `user_id`、`user_tier`：Java 服务的已验证账号字段。Gateway 不信任浏览器同名请求头，order-service 根据 HttpOnly 会话覆盖 baggage 后再传播到库存和支付服务。
- `auth_state`：`anonymous` 或 `authenticated`。RUM 事件由 `beforeSend` 补充，Java 日志和 Span 由服务端请求上下文补充。

RUM 使用 `trackViewsManually: true`。会话恢复和用户绑定完成后创建首个 `storefront/<page>` View；商城路由变化、登录、退出和会话失效分别创建新的明确 View。PV 由 View 数量计算，访客 UV 使用 `visitor_id`，登录账号 UV 使用登录 View 上的 `userid`。

`client_ip` 仅用于观测，不参与鉴权或访问控制。只有入口负载均衡覆盖而非追加外部传入的 `X-Forwarded-For` / `X-Real-IP` 时，该字段才能被视为可信客户端地址。

`GET /api/demo/logs` 只接受应用生成的 `biz-...` 和 `ord-...` 格式，防止公开接口被用来用任意字符串扫描命名空间日志。只有 order-service 使用可读取 `pods` 与 `pods/log` 的 ServiceAccount；其他 Java Pod 不挂载 API token。

浏览器使用 `X-Demo-Language` 将当前页面语言沿 Gateway、Order、Inventory 和 Payment 调用链逐级透传。应用只切换日志 `message` 的中英文模板；状态、业务 ID、故障字段和其他结构字段保持稳定，未携带该请求头的健康检查与后台请求默认使用中文。

DataKit 默认开启 `ebpf-net`、`ebpf-conntrack`、HTTP、HTTPS 与 DNS 网络流采集，用于展示主机、Pod 与服务之间的 L4/L7 网络关系。官方 Chart 以 DaemonSet 运行时已提供 eBPF 所需的宿主机网络、PID、特权模式和 `/sys/kernel/debug` 挂载；节点需要使用支持 eBPF 的 Linux 内核。`ebpf-bash` 属于命令日志，`ebpf-trace` 依赖额外的 ELinker，因此不属于本 Demo 的 eBPF 指标采集范围。
