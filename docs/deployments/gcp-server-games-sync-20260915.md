# GCP 服务端同步验收（2026-09-15）

用户本轮授权将最新本地服务端同步到现有 GCP，供远程 Android 测试使用；此授权仅扩展原任务的服务端部署范围。未修改正式 K8s、Android APK、模拟器和 WebRTC 播放器。

## 部署

- 项目 `twt-gcp-integration`，区域 `asia-east2-a`，VM `mall-demo-kvm-emulator-poc`。
- 入口：https://35.241.68.75.nip.io/business.html?lang=zh&scene=android-storefront&view=mobile
- 原 Compose 项目 `/home/cherry/mall-demo-web` / `observability-demo`。
- 仅重建 Gateway、Order 容器，Java 版本从 2.3.11 更新至 `2.3.13-pvz-source`。Inventory、Payment、MySQL、Redis 容器 ID 保持不变。
- 发布目录 `/home/cherry/mall-demo-web/releases/games-20260915/`，包含两个 JAR、服务端源码归档及校验清单。源码归档作为本次构建来源保留，未覆盖远端旧源码 checkout。
- 两个镜像分别为 `observability-demo-{order-service,gateway-service}:games-20260915`。
- `compose.override.yaml` 链接至 `releases/games-20260915/compose.sync.json`，默认 Compose 操作保留本次镜像和配置。
- 保留原环境，恢复 Web RUM 配置；商城 `observability_demo`、游戏 `observability_game_demo`，环境 `demo`，采集目标为观测云演示 Demo。

## 验证

- 本地 Maven 打包成功；当前相同代码已通过 44 项 Order/Gateway 测试、16 项 Node 测试。
- 公网 config、rum-config、auth/session 正常；工作台、大厅、植物关 HTML 和三个游戏脚本、CSS 与本地逐字节匹配。
- 公网登录首次遇到请求超时，留在弹窗；重试后成功进入 Demo Reader A 会话。
- 植物关资源完整加载，实际开局、僵尸生成、暂停、返回大厅成功。
- Android 入口确实连接真机播放器，已点击桌面图标打开原生商城；视频 720×1600 VP8，观察到约 29–32 FPS。连接曾断开，刷新重连成功；这是功能验收，不代表公网链路无抖动。
- Caddy、emulator、gateway、latest-video systemd 服务均 active。
- Owl 云端查询已收到本次 GCP 的 `games/home` View，版本正确；云端证据保存在 `owl-reports/gcp-server-sync-20260915/`。本次部署不重复宣称已验收云端完整游戏胜负回放。

## Android 与符号包

- 当前 APK 仍为 `2.3.16`，保留此前首绘修复，SHA256 `b94a23e814344d155f19c9a4622fac816d54bc7a253b4fa2067472446c527d50`，部署前后不变。
- APK 业务后端仍是正式 K8s `http://120.79.13.13:31080`；本次没有将 APK 业务请求重指向 GCP。后续 Android 功能修改需单独构建、部署并验收。
- Web SourceMap：`dist/observability-demo-rum-sourcemap-2.3.13-pvz-source.zip`，对应当前静态代码，按约定由用户上传。

## 维护与回滚

备份位于发布目录 `backup/`，包括原 Compose、完整运行配置、MySQL 一致性备份及旧镜像标签。备份含敏感配置，目录使用受限权限，勿公开分发。

日常按已发布镜像启动：

```sh
cd /home/cherry/mall-demo-web
sudo docker compose -p observability-demo up -d --no-build --no-deps order-service gateway-service
```

回滚仅两个服务：

```sh
sudo /home/cherry/mall-demo-web/releases/games-20260915/backup/rollback.sh
```

回滚后若需让默认 Compose 也持续使用旧配置，将 `compose.override.yaml` 链接改为该发布目录的 `backup/compose.rollback.json`。不要从旧源码 checkout 直接重新 build 本次已发布服务。

## 构建校验

- `order.jar`: `c92c280a0c29342f322de0861b36c1e93c0748578dd77687715333098818e1df`
- `server-source.tar.gz`: `d3c4088ccbaa68942022e1b0ae36c41889e1ae71e8123338b800c26736bf1335`
- `gateway.jar`: `2d00b360cb81a9fe4a6c7b939517288080d43220eade66d6d3ccc3d1e3618261`
