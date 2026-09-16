# GCP 安卓模拟器空闲退出发布

目标：`twt-gcp-integration / asia-east2-a / mall-demo-kvm-emulator-poc`。

更新内容：Web 播放器、latest-video bridge/idle.py、Caddy activity 路由、Gateway 后台刷新保护、启动后 HOME 脚本。未重装 APK、未清除应用数据、未重启模拟器；网关及视频服务重启，Caddy reload。

发布前比对远程 bridge.py / frames.py 与本地基线哈希一致。回滚备份：
`/opt/mall-demo-webrtc/backups/idle-20260915-021353/before.tgz`（root 限制访问，包含原 Caddy 配置）。

公网播放器 HTML SHA-256：
`4c0e28f14322134433dac1dfee12e9392097022e07eacb353cd0fe00d90b84f6`。
播放器资源：`assets/index-b128fcee.js`。保留旧哈希资源供已打开页面过渡，刷新页面后加载新播放器。

服务 active：mall-demo-gateway、mall-demo-latest-video、mall-demo-emulator、caddy。

验证方式：实际模拟器通过 ADB 启动 APP；经公网受保护 activity 接口上报操作，在无 WebRTC 连接时观察后台计时。验证 Launcher、进程是否存在与重新进入后的状态。该验证覆盖实际服务端计时与 HTTP 回退路径，未新建浏览器 WebRTC 连接操作验收。

15 秒缓冲为尽力上传，不保证队列已清空或云端回放可播放。

## 实机结果

- 发布后为 Nexus Launcher，后台 refresh-frame 请求后仍为 Launcher。
- 启动 APP 并上报操作，31 秒后为 Launcher，APP 进程仍存在。
- 缓冲期重新打开并上报操作，16 秒后仍在 APP，证明原关闭已取消。
- 新一轮无操作 31 秒后再次返回 Launcher；再等 16 秒，pidof 确认 APP 进程停止。
- 最终保留桌面，验收脚本成功退出。无 WebRTC peers 时完成，说明浏览器断连不阻塞服务端计时。
