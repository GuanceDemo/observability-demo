# Web 右侧控制 Android 故障：GCP 验收

2026-09-15 17:20–17:34（Asia/Shanghai）。用户授权将 APK 故障操作及关联链接同步到 Web 右侧，并沿用 GCP 远程验收环境。

## 交付与边界

- 入口：https://35.241.68.75.nip.io/business.html?lang=zh&scene=android-storefront&view=mobile
- Web / Java：`2.3.14-android-control`；APK：`2.3.17` / code 10；播放器缓存版本：`20260915-apk-control-v1`。
- GCP：`mall-demo-kvm-emulator-poc`，项目 `twt-gcp-integration`，区域 `asia-east2-a`。
- 右侧展示 APK 实际提供的 13 项目录，支持注入、恢复、连接/刷新，以及最近一次 RUM、Replay、Trace 链接。
- Web 发起固定命令，由 APK 调用既有业务故障与服务端故障接口。故障的 armed/triggered/recovered、真实运行 ID 和失败结果均由 APK 返回。
- Safe 版继续禁止 Native Crash/ANR；这两项需要在支持它们的 APK 中沿用原生确认，Web 不绕过。
- APP 内业务流继续指向正式 K8s `http://120.79.13.13:31080`，没有发布或改动正式 K8s。共享模拟器并非每位浏览器用户独享。
- 保留 SDK jankfix02、RN 首绘/边框修复、应用数据、分辨率、数据库及现有视频传输行为。更新控制桥时只重启其进程。

## 实际验证

- 首次联调发现 APK 被既有 30 秒空闲策略关闭后，注入先于目录加载执行。已增加最多 10 秒的目录等待；远程命令同时重置空闲计时。
- 最终 APK 通过 `am force-stop` 停止后，从 Web 注入成功冷启动并进入 armed：`fault-mu2gzxfd-im56xg9n`。
- 最终正式验收运行：`fault-mu2h1fv2-qcoky784`。Web 注入详情故障；原生点击图书后真实错误边界出现，状态变为 triggered；Web 恢复后 activeId 为空且 phase=recovered。
- Owl 实查观测云演示 Demo / `mall_app_android`，已收到 2.3.17 的 `mobile_fault_armed`、`mobile_fault_triggered`、`book_detail_render_failed`、`mobile_fault_recovered`，均关联上述实际 run ID。详见 `owl-reports/android-web-control-20260915/final-actions.json`。
- 实际点击 Web RUM 链接，在电脑浏览器打开观测云演示 Demo、mall-app-android、带正确 fault_run_id 的 View 查看器。新 View 可能晚于 Action 到达；首次打开该查询显示 0 条，稍后刷新已显示 4 条关联 View（MainActivity、storefront/detail），session_id 为 `146406ea90f44f2d9fba607478535a96`；不能把关联 View 可见等同于回放已播放。
- Replay 入口沿用 APK 的 run 过滤 View 查看器，再打开具体会话回放。本次没有重做云端整段视频播放验收。
- 无实际订单 traceId 时不显示 Trace，不伪造链路。原有 buildTraceUrl 回归测试通过；本轮未创建新的购买订单以验证 Trace 页面。
- 最近一次观测链接在恢复和设备状态过期后保留；过期时禁用注入/恢复，刷新按钮可重新连接。
- 公网 business.html、selfheal-i18n.js 与最终本地文件逐字节一致，运行配置版本正确。Caddy、gateway、latest-video、emulator 服务 active。

## 检查

- 91 项移动端测试、TypeScript、ESLint、商城规范数据同步检查通过。
- 44 项 Gateway/Order 测试通过，Java 打包成功。
- 25 项 Web/播放器测试通过，含来源校验、真实完成响应、过期状态和观测链接保留。
- GCP 已安装的固定 Python 运行时：2 项控制协议、6 项视频生命周期、5 项空闲策略测试通过。
- Safe / DemoFaults Release 均构建成功；符号取自各自最终 Hermes 和 R8 构建产物。
- APK Replay 反射/资源 ABI 检查通过。未提交、推送或上传符号。

## 部署产物及备份

远端目录 `/home/cherry/mall-demo-web/releases/android-control-20260915/`。

- `backup/`：数据库、旧 Java 镜像/环境/Compose 备份。
- `backup/runtime-components/`：旧 APK、下载 APK、播放器、视频桥源码、Caddyfile、原 Compose 链接。
- `compose.override.yaml` 指向此发布目录的 `compose.sync.json`；Order 使用 `android-control-20260915-final` 镜像，Gateway 使用 `android-control-20260915`。
- Java 回滚：`sudo /home/cherry/mall-demo-web/releases/android-control-20260915/backup/rollback.sh`。此脚本只回滚 Java；若要持续保持旧配置，需要同时恢复默认 Compose 链接。
- 完整回滚还需恢复 runtime-components 中对应文件及 APK。APK 降级需确认 Android 安装器是否允许；禁止通过卸载清空数据绕过。未执行完整回滚演练。
- 本地发布元数据：`mobile-app/build/releases/2.3.17/manifest.json`。
- Safe APK SHA256：`f5bb38a2d7d60ddc0f803f5ca5ad35647770856af3c7b3c3e1f3542ea696a04c`，两个公网宿主机文件一致。

用户上传的符号包：

- `mobile-app/build/releases/2.3.17/safe-sourcemap.zip`
- `mobile-app/build/releases/2.3.17/demoFaults-sourcemap.zip`
- `dist/observability-demo-rum-sourcemap-2.3.14-android-control.zip`
