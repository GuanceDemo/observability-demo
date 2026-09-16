# GCP RN Replay 首次绘制修复发布

2026-09-15 11:36（Asia/Shanghai），按用户要求替换 GCP 版本。

- VM: mall-demo-kvm-emulator-poc / twt-gcp-integration / asia-east2-a。
- Safe Release 2.3.16 (9)，保留 jankfix02 和圆形图标；使用 adb install -r 保留应用数据。
- 备份目录：/opt/mall-demo-webrtc/backups/replay-first-draw-20260915-033618。
- 备份同时包含旧 app-safe-release.apk 和 mall-demo-safe.apk。
- 已更新 /opt/mall-demo-webrtc/app-safe-release.apk 与 /var/www/downloads/mall-demo-safe.apk。
- 本地、模拟器已安装 base.apk、两个远端 APK、公网下载的 SHA-256 均为：
  b94a23e814344d155f19c9a4622fac816d54bc7a253b4fa2067472446c527d50。
- 安装 Success，冷启动 Status: ok，耗时 874ms；进程 PID 19694。
- emulator/app/gateway/latest-video/caddy 五个服务均 active。
- 冷启动检查后回到桌面，保留后台收尾时间再停止测试进程。
- 已有 19 项 Android 离屏回归与 87 项移动端测试通过；未宣称新会话云端视觉播放验收完成。

公网下载：https://35.241.68.75.nip.io/downloads/mall-demo-safe.apk
