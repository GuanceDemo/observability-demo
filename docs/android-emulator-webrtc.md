# 真实 Android Emulator 网页接入

商城工作台把响应式 HTML 移动端预览和 Linux KVM 中运行的真实 Android APK
拆成两个独立场景。真实 APK 场景展示 Emulator 输出的 720×1600 WebRTC 视频，
并通过 WebRTC DataChannel 把鼠标、触摸和键盘事件送回 Android；网页没有重新
绘制 APK 界面，因此这不是设备外观模拟或响应式预览。

## 链路

```text
business.html iframe
  -> HTTPS Player
  -> WSS Gateway
  -> Android Emulator gRPC（仅 loopback）
  -> WebRTC video/audio + input（必要时经 coturn）
```

Caddy 是唯一 HTTP 公网入口。ADB、Emulator console、gRPC 和 Python Gateway
只监听本机，其中 Gateway 显式绑定 `127.0.0.1:8080`；公网只需要 TCP 80/443、
TCP/UDP 3478 和受限 TURN UDP relay 端口段。

播放器每秒通过 `RTCPeerConnection.getStats()` 采集网络 RTT、SCTP RTT（浏览器
支持时）、丢包、采样区间内抖动缓冲、单帧解码、冻结次数/总时长和解码 FPS；指针
按下后分别记录到下一张浏览器显示帧、首张达到差异阈值的画面、以及 APK
`onPress` 操作确认的耗时。画面变化使用点击前 72x160 亮度缩略图与后续帧比较，
只代表第一处可见变化，不保证变化来自目标控件；APK 确认代表命名处理器已执行，
不代表异步业务请求完成。Gateway 每 10 秒执行一次固定的
`adb shell dumpsys gfxinfo com.malldemomobile.safe`，只返回 p50/p90/p95 等聚合值，
不接受网页传入 serial、包名或命令，也不返回原始 ADB 输出。

播放器把“ICE 已连接”和“画面可用”分开判断：只有连接建立、输入 DataChannel
已打开且浏览器采样到非黑首帧后才显示就绪。连接后 600 ms 仍没有可用首帧时，
播放器会调用固定的 `/api/v1/emulator/refresh-frame`；再等待 3000 ms 仍无画面时，
只重建一次信令和 PeerConnection，重连后最多再重绘一次便进入等待态；首帧重绘
总数不超过两次，不循环请求。恢复请求执行期间会加锁，避免每秒采样器重复启动同一
轮恢复。

播放器加载 600 ms 后仍未拿到可用视频帧时，还会通过固定的
`/api/v1/emulator/frame.png` 获取 Emulator gRPC 的真实 360×800 PNG，覆盖黑色视频
作为临时画面。该画面来自正在运行 APK 的真实 display，不是 HTML 模拟图；空闲时
约每秒同步一次，输入发出后以 80/220 ms 的短突发同步三次。当 WebRTC 出现非黑有效
帧后，截图层立即删除并恢复纯视频链路。调试台会明确显示“真实截图 · 视频恢复中”，
避免把降级链路误报为视频就绪。

`refresh-frame` 接口不接收命令或目标参数，Gateway 仅向固定 APK 发送
`REFRESH_FRAME` Activity action，APK 只执行一次布局/重绘，不跳页、不清
状态。为确保应用窗口真的提交新缓冲区，重绘包含两次肉眼不可见的单帧半透明
Overlay 脉冲。请求在 750 ms 内合并，避免恢复风暴。

首次点击发生在 DataChannel 尚未打开时不再静默丢弃。播放器最多按顺序暂存 16 条
输入、最长 1.5 秒，并在通道打开时发送；调试台显示实际排队时间。点击延迟从真实
发送确认后开始武装，同时仍包含用户从按下到发送的等待。一个测量未完成时，后续
点击可以正常控制 APK，但不会覆盖第一个样本。点击后 250 ms 若仍在等待视频帧
或可见画面变化，会请求无副作用重绘，随后每隔 1 秒重试，最多 3 次。收到未变化的
视频帧不会提前取消恢复；整个样本仍以 5 秒为上限。

APK 确认经 `MallDemoInteraction` 的结构化 Logcat 标记传递。Gateway 使用单个持续
读取器校验、去重并编号，通过
`/api/v1/emulator/interaction-ack?after=<sequence>&waitMs=<0..5000>` 返回动作名；
原始 Logcat 不会暴露给网页。每次被纳入测量的按下事件并行请求 `?cursor=1`，
得到 `{version:2, sequence, epoch}`，再使用 `after` 和 `epoch` 等待此游标之后第一条
确认。该 HTTP 请求不会阻塞 DataChannel 输入。Gateway 保留最近 64 条结构化记录；
进程重启、游标超前或记录溢出返回 409。再次点击、按键或取消指针会使等待中的 ACK
标记为“未归因”，不会计入成功延迟。游标请求和长轮询共用从按下起算的 5 秒截止时间。

ACK 是单用户操作下的保守关联：没有把浏览器输入 ID 贯穿到原生处理器，其他客户端
并发操作或延迟到达的 Logcat 仍可能影响归因；它不是严格的端到端事务 ID。处理器若在
游标建立前已执行，该样本可能超时，不能为了显示数值而复用旧回执。按下到 ACK 包含
按住时长及回程，新增“松开→APK 确认”单独展示松开后的等待。

播放器的截图请求使用代次和 AbortController 管理，旧 HTTP 响应或图片解码即使晚到，
也不能覆盖恢复后的视频。每次实际发送的输入独立触发刷新，不受统计样本占用影响。
`frame.png?fresh=1` 跳过已完成截图的 250 ms 缓存，仍合并正在进行的捕获；连续移动
不会无限推迟已安排的刷新。重连时替换旧视频轨道，避免旧轨道留在流的首位。

缓冲和解码耗时取相邻统计的增量；更换 PeerConnection、SSRC 或计数器重置时丢弃
上个区间，首个样本和不支持的字段显示 `-`。设备 HTTP 轮询不再阻塞 WebRTC 统计，
同一连接的 `getStats` 也不会重叠。浏览器支持时另显示 captureTime 到显示时刻的帧龄。
最近 100 次纳入测量的点击按 video / snapshot / waiting / mixed 分组，统计成功样本的
p50/p95，并单独计超时及排除样本；网页分开展示视频和截图回显。超时率分母仅包括
成功与超时，不能把未归因、不可用或等待中的样本当作零延迟。少量样本只用于排障，
不代表稳定的生产分位数。

## 网页配置

order-service 通过运行时变量接收完整的 HTTPS 播放器 URL：

```bash
export MOBILE_DEVICE_PLAYER_URL='https://device.example/android-emulator-webrtc/?url=https%3A%2F%2Fdevice.example%2Fandroid-random-path&embedded=1'
```

配置后，`GET /api/demo/config` 返回：

```json
{
  "mobileDeviceEnabled": true,
  "mobileDevicePlayerUrl": "https://device.example/..."
}
```

`business.html` 暴露两个独立的商城入口：

- `bookstore`：继续在原有 Web/移动端模拟分辨率内运行响应式 `shop.html`；
- `android-storefront`：仅支持移动端，加载真实设备播放器，并隐藏工作台原有
  的假状态栏、摄像头装饰和 Android 导航条。

真实设备入口为 `business.html?scene=android-storefront&view=mobile`。移动故障仍
由 APK 内的故障控制台触发；切回商城场景时恢复原有 iframe 和 `postMessage`
协议。配置为空或 URL 非法时，仅真实 APK 场景回退到 `shop.html`，不会改变商城
Demo 的 Web 或移动端预览。

真实 Android 场景的标题栏提供“获取 APK”入口。展开后可直接下载或使用手机扫描
二维码。安装包不放入 order-service 的 JAR 或容器镜像，而是由 Emulator 主机的
Caddy 从 `/var/www/downloads/mall-demo-safe.apk` 提供；二维码位于同目录的
`mall-demo-safe.svg`，由部署脚本根据最终 HTTPS 下载地址生成。网页从已校验的
Player origin 推导这两个固定路径，因此不会把随机 Gateway 路径或凭据写入页面。

Docker Compose 会把同名变量传给 order-service：

```bash
MOBILE_DEVICE_PLAYER_URL="$MOBILE_DEVICE_PLAYER_URL" \
  DEMO_PORT=18080 \
  docker compose up --build -d
```

本 POC 的 Caddy 会把根路径反代到 loopback `18080`，播放器静态路径和随机
Gateway 路径优先匹配。因此工作台、播放器和 WSS 共用同一 HTTPS 域名，网页
无需 CORS 放行。

Helm 部署使用：

```bash
helm upgrade --install demo charts/observability-demo \
  --namespace observability-demo \
  --set-string mobileDevice.playerUrl="$MOBILE_DEVICE_PLAYER_URL"
```

播放器 URL 是部署级入口，不包含 RUM token、Emulator gRPC token 或 TURN
凭据。TURN 凭据由 Gateway 在信令阶段发送，日志会脱敏。

## 构建与部署

播放器基于 Google `android-emulator-container-scripts` 的固定提交构建。构建机需
安装 Git、Node.js/npm、Protocol Buffers 编译器（`protoc`）和 `rsync`。仓库中的
脚本会应用嵌入布局、TURN、重复 `start`、Offer 冲突、新旧输入 DataChannel
兼容、启动输入队列和首帧恢复修复：

```bash
scripts/android-webrtc/build-player.sh
cp mobile-app/android/app/build/outputs/apk/safe/release/app-safe-release.apk \
  scripts/android-webrtc/app-safe-release.apk
```

把 `scripts/android-webrtc` 上传到已安装 API 36 x86_64 AVD 和 Android SDK 的
Linux KVM 实例，执行：

```bash
scripts/android-webrtc/provision-poc.sh \
  device.example \
  203.0.113.10 \
  10.0.0.10 \
  0654f694b46794fae4b178f1e1a17cb60c5d2d34
```

脚本会安装 Caddy、coturn、固定版本 Gateway，生成随机访问路径和凭据，安装
systemd 服务，并确保 Emulator 只安装最新 safe APK。它还会把 APK 发布到独立
下载目录并生成对应二维码。最终网页 URL 保存在 VM 的
`/var/lib/mall-demo-webrtc/player-url`。

真实设备外框使用 9:20 的内容比例直接承载 720x1600 视频，描边覆盖在内容盒之上，
不会挤压 iframe；播放器嵌入模式保留亚像素尺寸，避免取整造成单侧缝隙。

## 从 POC 到会话池

当前实现是一台 AVD 的单会话 POC，适合内部演示。多人或公网生产使用时，应在
它前面增加 Session Broker：完成用户认证、空闲 AVD 租约、短时签名 URL、并发
限制、超时回收和每次释放后的快照重置。每个活跃 AVD 独占一个 Emulator/
Gateway 组合，TURN 可以共享；网页播放器和本次协议层无需重写。

按量实例即使没有访问也会持续计费。不演示时停止实例；确定不再使用时再删除
实例、磁盘、静态 IP（如有）和专用防火墙规则。

## 前台验证与链路对照

工作台 URL 可临时追加 `&rtcTransport=relay` 强制本次连接走 TURN，去掉参数即可
恢复自动选择。这个开关不修改服务端、TURN 凭据或其他用户的连接策略。验证时需保持
演示页在前台；先核对“呈帧 / 解码帧”“播放时间 / 页面”和媒体就绪，再比较视频回显。
后台样本与截图回显都不能冒充前台视频延迟。只看到解码分辨率不等于视频已实际呈现。

## 2026-09-10 视频更新链路

GCP 工作台默认选择 latest-frame WebRTC 服务：共享最新截图、稳定出帧、发送端播放延迟提示和原生链路回退。APK 2.3.15 / jankfix02 与屏幕参数保持不变。新链路不再要求 APK 补帧。最终七次操作回显约 249–348 ms，补帧为 0；当时网络 RTT 也比早前基准低，不能将全部差异归因于代码。

实现、回滚和测量边界见 [验收报告](../owl-reports/android-video-update-20260910/report.md)。


## Android 独立版本配置

播放器和 APK 的发布版本独立于 Java 的 `image.tag`、`DD_VERSION` 和 Web RUM 版本：

```yaml
mobileDevice:
  playerUrl: "https://device.example.com/android-emulator-webrtc/"
  playerVersion: "20260910-latest-video-v1"
  apkVersion: "2.3.15"
  apkMinAndroidVersion: "7.0"
```

首次需要部署包含运行时版本配置功能的 order-service 镜像；旧镜像不会读取新增字段。
后续发布先更新 Emulator 主机上的播放器或 APK/二维码文件，需要更新模拟器内应用时
另行安装 APK，再把对应版本写入该环境的 Helm values，按原有升级流程应用。
保留现有环境的 image.tag、其他 values 和 Secret。此操作可能滚动重启 order-service，
但无需重新构建 Java 镜像，也无需同步修改 Java 或 Web RUM 版本。

Compose 对应环境变量为 `MOBILE_DEVICE_PLAYER_VERSION`、`MOBILE_DEVICE_APK_VERSION`
和 `MOBILE_DEVICE_APK_MIN_ANDROID_VERSION`，修改后重新创建 order-service 容器即可。

`playerVersion` 仅覆盖标准 `/android-emulator-webrtc/` 入口的 `v` 缓存参数；
空值保留 playerUrl 自带的版本参数，自定义播放器路径保持原有参数。
`apkVersion` 用于下载文案和 APK/二维码的 `v` 参数，必须与实际发布包的 versionName
一致；它不负责选择历史文件、构建、上传或安装 APK。最低 Android 版本需与包的 minSdk
对应。版本字段为空时显示通用 Android 版本说明，不显示假定的 APK 版本。
通过 `/api/demo/config` 检查三个运行时字段，并在 Android 场景核对播放器 URL 和下载文案。
