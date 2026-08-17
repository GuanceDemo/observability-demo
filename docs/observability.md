# 可观测信号与字段

| 信号 | 来源 | 关键关联字段 |
| --- | --- | --- |
| Kubernetes/容器指标 | DataKit container、kubernetesprometheus | `project`、`cluster_name_k8s`、`pod_name`、`container_name` |
| eBPF 网络可观测性 | DataKit ebpf-net、ebpf-conntrack | `project`、`src_*`、`dst_*`、`direction`、`family`、NAT 与 HTTP/DNS 字段 |
| APM Trace | DDTrace Java Agent | `project`、`trace_id`、`span_id`、`service`、`env`、`version`、Gateway 路由与来源字段 |
| 应用日志 | stdout + `datakit/logs` Annotation | Trace 字段、业务字段、故障字段、进程/Pod/容器字段、Gateway 路由与来源字段 |
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

平台 Pipeline 的规则保存在 `observability/platform-log-pipeline.p`，用于 Workshop 中手工创建并测试中央 Pipeline。规则将业务正文提取到 `log_message`，不会覆盖完整的原始 `message`。

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
