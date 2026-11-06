# 车机工作台

本页介绍本地运行；ACK 独立后端的镜像、入口和集群身份配置见 [ACK 部署](../../../docs/vehicle-demo/ack-workbench.md)。ACK 模式不增加登录。

使用当前仓库的工作台源码，使用本地播放器接入远端真实 Android、报表和车机链路故障控制。当前链路为：

`浏览器 → 本地 Docker 后端 → HTTPS Kubernetes API → vehicle-pipeline 专用执行作业`

车机场景按预览采用直接面板：标题旁切换车机画面和数据报表，下方展示真实内容及数据流向；不显示模拟浏览器地址栏或额外外框。该页面不接入 RUM。

日常运行不依赖 SSH；kubeconfig 只挂载到后端，不进入网页、镜像或集群执行作业。本机不需要运行 Kafka、Flink、Spark。

## 准备集群访问

使用明确的目标 context。导入已有配置（不会改动默认 kubeconfig）：

```sh
python3 scripts/vehicle-demo/configure-local-kube.py --kubeconfig /path/to/config --context TARGET_CONTEXT
```

当前 Demo 使用 **30 天的 Kubernetes 客户端证书**，通过集群 CSR 签发，保留原用户名、权限组与 RBAC。续期需重新签发再导入；重新导入旧文件不会延长有效期。具体流程见 [30 天凭证续期](../../../docs/vehicle-demo/kubeconfig-30-days.md)。

ACK 的临时凭据接口只支持 15～4320 分钟，不能用于签发 30 天证书。如明确要改回短期凭据，可通过已有阿里云 CLI 登录执行：

```sh
python3 scripts/vehicle-demo/configure-local-kube.py \
  --ack-cluster c0eba4a54613c4adfb108e850e1c7c7d5 --region cn-shenzhen \
  --temporary-duration-minutes 1440
```

文件保存在 Git 忽略的 `.local-work/vehicle-demo/kube/`，目录权限 0700、文件 0600；包括可移植 kubeconfig、Compose context 和到期元信息。必须启用 HTTPS 证书校验。导入工具拒绝容器中不可用的 exec/auth-provider 插件。Docker 挂载整个凭据目录，每次控制请求重新加载配置；同 context 原子刷新后无需重启。改变 context 需要重新创建本地容器。

导入工具从实际签名证书读取到期时间并拒绝过期证书。省略 `--temporary-duration-minutes` 的旧 ACK 刷新命令仍请求 1440 分钟，但若会缩短当前证书有效期，则拒绝覆盖配置。到期后页面显示认证错误，需续期；已经启动的集群恢复作业使用独立 ServiceAccount，不受笔记本证书过期影响。

观测云跳转使用 `GUANCE_WORKSPACE_ID`。Docker 启动前将它设置到环境变量或上述 `compose.env`；重新导入集群配置后需检查该设置。直接运行 Python 时使用环境变量。不配置时沿用浏览器当前空间，不强制选择内置演示空间。

## 一次性命名空间初始化

由有授权的管理员把本目录下 `bootstrap-access.py`、`kubernetes-access.yaml`、`initial-state.json` 放在同一目录，确认 kubectl 指向目标集群，再执行：

```sh
python3 bootstrap-access.py --username AUTHENTICATED_KUBERNETES_USERNAME
```

用户名是 API 认证身份，不是 context 别名。初始化先校验现有 `vehicle-control` 与 `vehicle-summary` 的 Helm 所有权，拒绝接管同名外部资源，再创建专用 ServiceAccount、两个 Role/RoleBinding 和状态 ConfigMap。已有状态只保留，绝不重置。初始化前后比较全部 Deployment/CronJob 配置。

客户端角色可读取指定车机资源、更新固定状态 ConfigMap、创建和查询本命名空间 Job；执行器可修改指定 Kafka/TaskManager 的副本和汇总 CronJob、创建汇总 Job、查询作业日志。不授予 ClusterRole、Secret 读取或 Pod exec。Kubernetes RBAC 无法按名称限定 Job 的 create 权限；固定作业模板、命名、目标和 source allowlist 由后端约束。因此 kubeconfig 仍是有本命名空间作业创建能力的凭据，不能交给浏览器。

## 本地播放器

GCP 的车机验证首页、旧报表页面和播放器静态文件已下线。工作台直接提供本地播放器文件，连接既有 GCP 视频/输入服务，不再读取远端 HTML。

播放器构建产物放在 Git 忽略的 `.local-work/vehicle-demo/player/web/`。需要重新构建时：

```sh
umask 077
mkdir -p .local-work/vehicle-demo/player/web
PLAYER_DEVICE_PROFILE=vehicle scripts/android-webrtc/build-player.sh .local-work/vehicle-demo/player/web
```

同级 `config.json` 保存 `{"endpoint":"https://35.241.68.75.nip.io/<existing-vehicle-route>"}`。实际 route 取已有 GCP `/etc/vehicle-demo/credentials.json` 的 `route`，不要生成新值，也不要放在 `web/`、Git 或日志里。该目录权限 0700，配置权限 0600。后端仅接受与 `VEHICLE_REMOTE_ORIGIN` 完全相同的 HTTPS origin；配置文件不通过静态服务公开。浏览器只取得实际播放需要的端点，不取得 MQTT 或 Kubernetes 凭据。

Docker 将整个 player 目录只读挂载到 `/run/vehicle-player`；构建产物和连接配置均不进入镜像。本地静态路径为 `/vehicle-demo/player/`，报表仍代理固定远端 `/vehicle-demo/api/report`。GCP `/vehicle-demo/` 下除历史报表 `/api/report` 和实时接收 `/api/live` 两个 GET API 外均返回 410。

## Docker 启动

```sh
sh scripts/vehicle-demo/run-local-docker.sh
```

该命令先检查集群配置和本地播放器文件，然后启动本机原有 Demo 的 MySQL、Redis、Inventory、Payment、Order、Game、Gateway 容器，再构建并启动 `vehicle-local-workbench-1`。Java 容器保留原有镜像、配置和卷；只构建 `observability-demo-vehicle-workbench:local`。需要已有容器和 `observability-demo_default` 网络，缺失时明确报错。

打开 [本地车机场景](http://127.0.0.1:8767/business.html?scene=vehicle-telemetry&view=web)。端口只发布到 `127.0.0.1:8767`，后端通过 Docker 网络访问 `gateway-service:8080`。可仅重建/停止工作台：

```sh
docker compose --env-file .local-work/vehicle-demo/kube/compose.env -f compose.local-vehicle.yaml up -d --build workbench
docker compose --env-file .local-work/vehicle-demo/kube/compose.env -f compose.local-vehicle.yaml stop workbench
```

Python 直接启动需要 Python 3.9+ 和 SDK：

```sh
python3 -m venv .local-work/vehicle-demo/venv
.local-work/vehicle-demo/venv/bin/pip install -r scripts/vehicle-demo/local/requirements.txt
sh scripts/vehicle-demo/run-local.sh
```

| 参数 | 环境变量 | 默认值 |
| --- | --- | --- |
| `--port` | — | `8767` |
| `--vehicle-origin` | `VEHICLE_REMOTE_ORIGIN` | `https://35.241.68.75.nip.io` |
| `--mall-origin` | `VEHICLE_MALL_ORIGIN` | Python: `http://127.0.0.1:18080`；Docker: 容器网络 |
| `--player-config` | `VEHICLE_PLAYER_CONFIG` | `.local-work/vehicle-demo/player/config.json` |
| 静态资源目录 | `VEHICLE_PLAYER_ASSETS` | `.local-work/vehicle-demo/player/web` |
| `--kubeconfig` | `VEHICLE_KUBECONFIG` | 启动脚本加载本地独立配置；直接调用 server.py 默认 `~/.kube/config` |
| `--kube-context` | `VEHICLE_KUBE_CONTEXT` | 必须明确指定；启动脚本读取准备结果 |

页面和静态资源来自仓库 Order、Game 模块；车机/报表使用 `web/prototype.css`，通过固定 `/vehicle-demo/prototype.css` 路由提供；中间保留上报概览/明细、独立历史统计和链路节点。顶栏、左侧导航和右侧控制区保持与其他业务场景一致的样式；右侧独立使用 `controls.css`。真实数据适配放在 `workbench.js`/`report-model.mjs`。不加载原型的示例数据或模拟故障脚本。车机播放器从本地独立静态目录加载，通过 HTTPS/WebRTC 接收远端画面和实际状态。报表代理只访问固定远端，历史统计展示同一成功批次、源时间和 Run ID。实时概览与明细单独读取 `/vehicle-demo/api/live`，每 5 秒刷新，展示实际接收记录。

## 实时上报口径

实时接口由现有 MQTT 观察器提供，只读查询它已校验、去重、提交的 SQLite 收据。当前范围与车机配置一致，仅为 `demo-vehicle-001`。

- 今日有数据车辆：北京时间当天实际收到遥测的车辆数。
- 近 1 分钟上报/未上报：按观察器接收时间判断；不等同于车辆在线/离线。
- 近 1 分钟样本：最近 60 秒内收到并去重的记录，实际网络抖动下可能为 59、60 或 61，不能固定写成 60。
- 场景、电量、温度：最高消息序号的采样值，避免补传的旧消息覆盖新状态。场景分布仅统计近 60 秒内采样且收到上报的车辆。
- 观察器连接断开、API 失败或快照超过 15 秒未刷新时，指标显示不可用，明细保留最近已知值并标记状态待确认。

汇总只展示北京时间今天，保留五分钟趋势；读取旧版七天报表时也仅显示今日记录。搜索和状态筛选不改变实时概览总数。今日汇总样本仍来自已发布 Spark 批次。顶部历史提示同时显示汇总时间与数据覆盖时间，不能把批次延迟当作实时接收中断。

GCP HTTP 线程仅监听 `127.0.0.1:8093`，经现有 Caddy TLS 暴露精确 GET 路由；没有新增外网端口。更新时将 `observer.py`、`live_report.py` 和 `install-web.py` 同步到 `/opt/vehicle-demo`，只重启 `vehicle-demo-observer` 并执行安装器。保存现有源文件和 Caddy 备份，不改变 MQTT client ID、持久会话、凭据或 ACK 顺序。

## 故障与恢复

启动服务或读取状态不会创建作业或修改运行状态。用户点击后，后端校验 Host、Origin、会话 token、固定场景和实际前置状态，保存操作，再创建专用控制 Job。

- **Spark 失败**：可在汇总运行中提交；先记录排队状态、暂停后续调度，等待当前批次结束并重新验证新鲜报表和上游状态，再按现有模板创建 `schema-mismatch` 作业；本次内存视图把 `batterySocPct` 改为 `batterySocPercent`，由未改动的汇总 SQL 实际产生 `UNRESOLVED_COLUMN.WITH_SUGGESTION`，记录 FAIL 和 Run ID；恢复创建新的正常作业，保留原失败记录。
- **Flink 执行失败与恢复**：临时将专用 TaskManager 缩至零，真实引擎异常结束当前执行 Run（FAIL）；恢复原副本数，子任务恢复并完成新检查点后创建新 Run（RUNNING）。保留 HA/checkpoint 和引擎自动重启；这里的 Run 表示实际执行尝试，不代表整个 Flink Job 进入最终 FAILED。
- **EMQX 内部积压**：只关闭专用 Kafka producer 的发送窗口，MQTT 接收和原磁盘队列继续运行，Kafka/Flink 不停止。原生 `queuing` 增长后记录实际积压证据，恢复打开窗口并补发；未观测到积压不会宣称演练成功。

操作和原值保存在 `vehicle-demo-fault-state` ConfigMap；资源版本 CAS 与 worker lease 限制并发，恢复请求不会被旧 worker 状态覆盖。Spark/Flink 及旧操作沿用控制镜像；新 EMQX 操作使用固定 digest 的 `vehicle-fault-worker` 镜像，携带受控 Python/RPC 代码和专用 ServiceAccount。镜像拉取及节点调度配置保留，无笔记本或管理员凭据。

Spark 排队最多 660 秒，可点击“取消等待”；排队结束前不会创建故障作业，取消或等待超时只还原调度。实际进入注入阶段才开始 Spark 300 秒保护计时。Flink 120 秒、EMQX 60 秒。EMQX 内部还预先启动独立恢复计时器，即使控制 Job 中断，发送窗口也会自动打开；手动恢复不会重建 action/connector。期限到达开始恢复；关闭浏览器、停止本地 Docker 或笔记本断网不会停止已经启动的集群作业。Pod 重启从已保存状态继续；集群本身不可用时等待恢复连接后重试。未开始执行就已超时的操作不会再注入故障。不要删除仍在恢复的控制 Job 或状态 ConfigMap。

“已恢复原配置”与“数据已恢复”分别记录。后者必须满足真实组件健康、恢复后检查点、新成功汇总 Run ID 一致、源时间推进、元数据发件箱排空。外部资源替换、配置冲突、丢弃增加、恢复作业失败都保留错误；失败记录不会被改写。发件箱排空不等于已人工核验观测云详情。

## 本地检查

```sh
python3 -m unittest discover -s scripts/vehicle-demo/local/tests -v
node --test scripts/vehicle-demo/local/tests/*.mjs
```

离线测试不代替真实演练。演练时核对失败与恢复的实际 Run ID、旧报表保留、源时间推进和原配置还原；EMQX 还需核对原生积压增长及补发清零。完整 24 小时稳定性验收尚未完成。

失败与恢复 Run ID 均提供观测云直达链接，通过 `GUANCE_WORKSPACE_ID` 指定工作空间、对应 Job 和运行详情；保留复制入口。失败详情只在观测云展示。Spark 通过标准 errorMessage Facet 上报真实异常类型、安全摘要和有长度限制的实际堆栈，以及 failureStage/retryCount/errorCode 扩展字段。当前观测云页面可读取 errorType；失败阶段/重试栏仍固定为空，因此也把阶段及未重试说明写入错误摘要。历史事件不回写。

### EMQX 专用执行权限

在现有 ACK 管理员环境执行（仅更新两项专用 RBAC，不修改业务工作负载）：

```sh
python3 scripts/vehicle-demo/local/bootstrap-access.py --emqx-executor
```

只允许 `vehicle-demo-fault-worker` 对当前 `vehicle-emqx` Pod 名称执行固定命令；本地用户不获得 exec 权限。EMQX Pod 被重新创建后需重新运行此初始化。执行时还检查 Pod UID、镜像 digest、EMQX/Wolff 版本和 producer BEAM MD5，版本不匹配时拒绝注入，不能直接放开版本校验。

该机制是专用于演示的内部故障插桩：临时将运行中 producer 的 `max_send_ahead` 从 0 改为 -1，保留完整 replayq、计数和原连接；不是公开配置项。切勿通过 action/connector 的 PUT 重建转发器来替代此流程。恢复沿用操作中记录的原值；历史 `target=vehicle-kafka` 操作继续使用其原副本还原逻辑。


### 车机画面自动恢复

进入或刷新页面会自动连接。播放器文档加载单独等待最多 30 秒；加载完成但约 10 秒仍无画面时，工作台会自动重新加载播放器；最多重试 3 次，后续等待 15/30 秒，最后一次再等待 30 秒后提示手动重试。正常播放时不刷新，持续正常 30 秒后恢复重试额度。切到报表或浏览器后台时暂停自动重试，回到画面后继续检查。此操作只恢复浏览器播放器，不重启车机 APK、模拟器或数据链路。

更新时同时构建 `PLAYER_DEVICE_PROFILE=vehicle` 播放器和本地工作台；播放器的 `playerSession` 状态回报须与工作台匹配。保留旧哈希静态资源供已打开的页面使用。

## ACK 部署边界

此 Dockerfile 可构建本地工作台镜像，但现有 Compose 和 HTTP 服务只允许 loopback Host/Origin。播放器产物和连接配置、独立 kubeconfig 仍通过本机目录挂载；主站 Gateway、Helm Chart 和发布流水线未接入该工作台。只发布现有商城镜像不会启用车机场景。

ACK 数据处理组件使用独立的 [vehicle-pipeline Chart](../../../vehicle-pipeline/README.md)。将完整车机页面部署到 ACK 前，还需补齐工作台 Deployment/Service/Ingress、浏览器身份鉴权、受限的集群执行身份，以及播放器资源和配置的部署方式；不能直接取消本地来源校验。

连续刷新/场景切换的浏览器验收仍存在播放器文档挂起的未决问题；自动恢复逻辑的离线测试通过不代表所有实际导航路径已稳定。
