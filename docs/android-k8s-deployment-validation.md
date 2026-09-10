# 正式 K8s Android 场景部署验证

2026-09-10，北京时间 16:53–17:19 验证。

正式入口：<http://120.79.13.13:31080/business.html?lang=zh&scene=android-storefront&view=mobile>。

| 项目 | 实际发布值 |
| --- | --- |
| 命名空间 / Helm release | observability-demo / demo |
| Helm revision / Chart / appVersion | 29 / 2.3.12 / 2.3.12 |
| 四个 Java 服务镜像 | pubrepo.jiagouyun.com/demo/observability-demo-{gateway,order,inventory,payment}-service:2.3.12 |
| Java 镜像源码 | b3a32df，发布 tag v2.3.12 |
| Android APK | 2.3.16 / versionCode 9 / Android 7.0+ |
| APK Gateway | http://120.79.13.13:31080 |
| 播放器版本 | 20260910-latest-video-v1 |
| Android RUM | mall_app_android / mall-mobile / demo，使用正式 Gateway 的 /rum-proxy |
| SDK | ft-sdk:1.7.5-jankfix02 + ft-session-replay:0.1.8-jankfix02 |

GCP Emulator、latest-frame 视频服务、TURN 与下载服务继续使用原主机。
APK 的业务请求和 RUM/Replay 上传已切到正式 K8s。采用覆盖安装，购物车数据保留。

## 配置修正与验收

正式环境原来的 Android applicationId 为 observability_demo_android，未与工作空间内已接入的商城应用匹配。核对观测云应用列表后，对齐为 mall_app_android。服务名保持 mall-mobile，Replay 保持开启。

- 四个 Java 镜像均验证存在 linux/amd64 和 linux/arm64 清单，所有 Deployment 最终 Ready。
- Helm 升级前比较数据库/Redis Deployment spec、Service spec、Secret data，保持一致；升级后再次确认凭据不变。MySQL 和 Redis 原 Pod 保持运行。
- Safe / DemoFaults Release 构建成功，APK 版本和 Gateway 构建配置正确；配套 jankfix02 AAR 哈希与此前验证版本一致。
- 两个 APK 的 Replay 反射与资源上传 ABI 验证通过；最终 DEX 含快照 begin/end 清理及缓存类。
- 两个符号包采用同次构建生成的 Hermes SourceMap 和各自 R8 mapping，ZIP 解包后与原文件逐字节一致。
- GCP 安装包、公开下载文件与本地产物 SHA-256 一致：3382d9889446eface4e2d0ff3914299e3dada74543d1376c1513c7f2e6208c9d。
- 正式工作台显示真实 Android 视频和 v2.3.16 下载说明；原生商品详情请求由正式 Gateway 接收并返回 200。
- Android 原生 RUM、Replay 和 Replay assets 请求在正式 Gateway 返回 200。Owl 查询确认云端收到 2.3.16 的 ApplicationLaunch、storefront/home、storefront/detail 记录；CUA 实际播放新会话回放成功。

云端数据并非接口成功后立即可查询；验收同时核对 SDK 请求中的版本/应用标识、云端记录与实际回放。未进行新的性能基准，也未触发订单、故障或清空应用数据。

## 产物与恢复

APK、SourceMap 和 manifest 位于 `mobile-app/build/releases/2.3.16/`，SourceMap 由用户自行上传。

正式服务器上的 `/root/demo-release-2.3.12/` 保存升级前 values、manifest、资源与 Secret 备份，以及最终 values 和部署记录。备份含敏感配置，不提交仓库。

需要整体恢复旧 K8s 服务时，在正式服务器执行：

```bash
helm rollback demo 26 -n observability-demo --wait --timeout 10m
```

APK 备份位于 GCP 的 `/opt/mall-demo-webrtc/backups/k8s-apk-2.3.16-20260910T085951Z/`。APK 与 Helm 独立回滚；恢复旧 APK 前先确认 Android 版本降级限制，不通过卸载清空应用数据。仅调整 Android 元数据时保留 image.tag=2.3.12。
