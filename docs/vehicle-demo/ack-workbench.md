# 车机工作台部署到 ACK

工作台是独立 Python 后端，同时提供车机页面和已构建的播放器。主站仍由 Gateway、Order 提供，车机请求按固定路由转发到工作台。

```text
浏览器 → 现有 HTTPS 入口 → Gateway → vehicle-workbench（ClusterIP）
                                      ├─ vehicle-control /api/report（集群内）
                                      ├─ GCP 实时接收 / 视频 / 输入服务
                                      └─ Kubernetes API → 专用故障执行 Job
```

不增加登录。能访问 Demo 页面的人可直接使用既有故障按钮；操作仍受场景白名单、同源与 CSRF 校验约束。`gateway-token` 只校验 Gateway 到工作台的内部请求，不是用户账号，不能放在前端或 URL 中。

## 前提

- `vehicle-pipeline` 命名空间内已有同名 Helm release，处理链路正常，`processingEnabled=true`。本次配置不创建 Android VM，不迁移数据卷，不替换已有恢复状态。
- GCP 的 Android、视频/输入服务及只读实时接收 API 仍需运行。播放器页面改为 ACK 镜像提供，视频流仍连接现有 GCP endpoint；沿用已有 HTTPS/WebRTC Origin 配置。
- 已有 `vehicle-demo-fault-worker` ServiceAccount、worker Role/RoleBinding 和 `vehicle-demo-fault-state` ConfigMap。已有环境不重复初始化。新环境按[工作台初始化说明](../../scripts/vehicle-demo/local/README.md#一次性命名空间初始化)操作；EMQX 故障还需要对当前 EMQX Pod 的专用 exec 授权，Pod 更换后重新运行 `bootstrap-access.py --emqx-executor`。
- 主站必须有 HTTPS 入口，工作台 `publicOrigin` 与浏览器地址的协议、域名和端口完全一致，不带尾部 `/`。复用现有 Ingress/LB，不单独暴露 workbench 的 8767 端口。

工作台使用专用 ServiceAccount 和自动轮换的 projected token，每次调用重新读取，不需要挂载或续期笔记本的 kubeconfig。Chart 只创建工作台自己的 Role/RoleBinding，权限包括读取固定资源、更新固定状态 ConfigMap，以及在专用命名空间创建/读取 Job；不授予 ClusterRole、读取 Secret 或执行 Pod 命令的权限。Kubernetes RBAC 不能按名称限制 Job 的 create，固定 Job 模板和目标由后端校验。

## 构建与版本

仅发布旧主站镜像不足以启用车机场景。Gateway、Order 和 workbench 都需要包含本次改动的新镜像。

```sh
docker build -f scripts/vehicle-demo/local/Dockerfile.ack \
  -t observability-demo-vehicle-workbench:local .
```

该 Dockerfile 使用固定提交的播放器源码及仓库补丁，在构建阶段生成车机横屏播放器；运行镜像内置页面、播放器和控制代码，不依赖本地目录挂载。构建需要访问 Docker、Debian、GitHub 和 npm 源。

发布流程 `.github/workflows/release-images.yml` 在已有五个服务之外增加 `observability-demo-vehicle-workbench`，发布同一版本的 amd64/arm64 镜像。仍只有个人发布仓库执行推送。正式发布前选择新版本，统一主站 Chart `version/appVersion`、镜像 tag、DD_VERSION、RUM/SourceMap 版本，保留已发布 tag。车机 APK 版本独立，不随 Web tag 变更。车辆处理链路 Chart 的版本也独立管理。

## 准备配置和 Secret

复制两个 example overlay 到 Git 忽略的私有目录并填好域名、空间 ID：

```sh
umask 077
mkdir -p .local-work/vehicle-demo/ack
cp vehicle-pipeline/deploy/values-workbench.example.yaml .local-work/vehicle-demo/ack/pipeline.yaml
cp charts/observability-demo/values-vehicle-workbench.example.yaml .local-work/vehicle-demo/ack/main.yaml
```

主站示例默认为 `observability-demo` 命名空间、`demo` release。若不同，需要同步调整 pipeline overlay 的 `gatewayNamespace/gatewayRelease`，用于 NetworkPolicy 匹配；工作台自身的 namespace/release 固定为 `vehicle-pipeline`。

在两个命名空间准备相同的 Gateway token。播放器 `config.json` 继续使用已有有效的车机 endpoint，格式为 `{"endpoint":"https://设备域名/已有连接路径"}`，来源必须与 `remoteOrigin` 一致。不要将实际连接路径写进 Git。

```sh
# kubectl 必须已选择正确 ACK context；以下命令会创建/更新两个 Secret。
openssl rand -hex 32 | tr -d '\n' > .local-work/vehicle-demo/ack/gateway-token
kubectl -n vehicle-pipeline create secret generic vehicle-workbench \
  --from-file=gateway-token=.local-work/vehicle-demo/ack/gateway-token \
  --from-file=player-config.json=.local-work/vehicle-demo/player/config.json \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n observability-demo create secret generic vehicle-workbench-gateway \
  --from-file=gateway-token=.local-work/vehicle-demo/ack/gateway-token \
  --dry-run=client -o yaml | kubectl apply -f -
```

两个 Secret 不由 Chart 生成，values 仅引用名称。更新 token 后需同步重启 Gateway 和 workbench；播放器配置以目录方式挂载，下次读取连接配置时生效。不要只轮换一侧 token。

若已有 NGINX Ingress，确认 `nginx.ingress.kubernetes.io/proxy-read-timeout` 至少为 `"95"`；其他入口设置等效超时。Gateway 的车机专用上游超时为 90 秒，商城仍为 15 秒。新建入口时通过主站已有 `ingress.enabled/className/hosts/tls` 配置域名与 TLS Secret。

## 发布顺序

先确认当前无未恢复的故障，再保留两个 release 的现有 values；其中可能包含私有配置，只存于上述受保护目录。使用原部署 overlay 也可以，不能仅用 example 文件覆盖现有链路配置。

```sh
helm get values vehicle-pipeline -n vehicle-pipeline -o yaml > .local-work/vehicle-demo/ack/pipeline-current.yaml
helm get values demo -n observability-demo -o yaml > .local-work/vehicle-demo/ack/main-current.yaml
```

将 `RELEASE_VERSION` 设置为已发布的新版本，`WORKBENCH_IMAGE` 设置为该版本的镜像完整地址（推荐追加真实 digest），再执行：

```sh
: "${RELEASE_VERSION:?Set the newly published version}"
: "${WORKBENCH_IMAGE:?Set the published workbench image}"
helm upgrade vehicle-pipeline vehicle-pipeline/deploy/chart -n vehicle-pipeline \
  -f .local-work/vehicle-demo/ack/pipeline-current.yaml \
  -f .local-work/vehicle-demo/ack/pipeline.yaml \
  --set-string workbench.image="$WORKBENCH_IMAGE" --wait --timeout 5m
helm upgrade demo charts/observability-demo -n observability-demo \
  -f .local-work/vehicle-demo/ack/main-current.yaml \
  -f .local-work/vehicle-demo/ack/main.yaml \
  --set-string image.tag="$RELEASE_VERSION" --wait --timeout 5m
```

先用相同参数运行 `helm template` 审查差异。主站 Chart 的镜像目前由全局 registry、owner、tag 组合；发布前确认 Gateway/Order 均已推送到对应位置。

工作台固定为单副本 `Recreate`，不要自行扩成多副本；页面 token 和缓存属于进程，故障状态和恢复 Job 独立保存在集群。重启后按钮会先获取新的 CSRF token，已启动的恢复 Job 不依赖工作台存活。

## 部署后验证与回退

1. 核对两个 release 的 Helm revision、Chart/App Version、实际镜像和 Pod readiness；工作台启动不应创建故障 Job。
2. 从主站 `GET /api/demo/config` 确认 `vehicleEnabled=true`，打开 `/business.html?scene=vehicle-telemetry&view=web`，确认车机画面、报表和右侧状态正常，无登录步骤。
3. `GET /api/vehicle/config` 应返回 `mode=cluster`。该响应包含浏览器 CSRF token，但不得包含 Gateway token、kubeconfig 或 ServiceAccount token。
4. 核对报表批次和源时间；经过授权的故障演示需确认真实引擎状态、保护恢复和新批次。镜像构建、离线测试通过不等于这一步已完成。

如需回退，先通过页面完成恢复并确认操作已结束，再将主站 `vehicleWorkbench.enabled=false` 隐藏入口和关闭代理，随后将 pipeline `workbench.enabled=false`。不要卸载整个 pipeline release，也不要删除原状态 ConfigMap、worker 或数据卷。保留本地模式可继续排查。
