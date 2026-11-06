# GCP 车机演示运行说明

本地接入现有 Demo 工作台、真实车机画面、报表与故障控制，使用 [本地工作台启动说明](local/README.md)。该入口复用本节所述远端资源，不运行下面的安装/部署步骤。

部署目标是已存在的 `twt-gcp-integration / asia-east2-a / mall-demo-kvm-emulator-poc`，8 vCPU / 16 GiB。新增 AVD 和车机页面，不创建或扩容 VM。EMQX 已于 2026-10-27 迁到现有 ACK；GCP 原容器、专用卷、镜像和网络已清理，迁移备份保留。

| 组件 | 隔离配置 |
|---|---|
| 车机 AVD | `VehicleDemo_API36`，`emulator-5556`，1280×720，4 vCPU（宿主上限 4 CPU） |
| 车机 App | `com.guance.vehicledemo`，0.1.3，API 24+ |
| 原生输入 / 最新帧桥接 | loopback 8082 / 8092，gRPC 8556 |
| EMQX | ACK 单副本 6.3.2，镜像按 digest 固定，1 GiB / 1 CPU |
| MQTT / WebSocket / 管理 API | GCP loopback 1883 / 8083 / 18083，经受限 SSH 转发到 ACK |
| 外部入口 | 现有 TLS 443，视频/输入路由、`/vehicle-mqtt` 和 `/vehicle-demo/api/report`；车机前端在本地工作台 |
| APK 下载 | `/downloads/vehicle-demo.apk` |

车机页面使用现有 TURN 中继。核心功能与故障演练之外，完整 24 小时稳定性验收仍须单独完成。

Android 36 默认会把请求的 2048 MiB 自动提高到 **2560 MiB**。当前车机显式使用 `-lowram -memory 2048`，客体实际约 1972 MiB，保留 1280×720 / 15 FPS。保留默认 SwiftShader 图形能力，仍须计入 QEMU、渲染和缓存开销，不能把 guest RAM 当作服务总内存。当前服务内存硬上限为 4096 MiB；客体 4 vCPU、宿主 `CPUQuota=400%`，最多使用原 8 核主机的一半 CPU。2 vCPU 与 200%/300% 配额试验持续出现启动 ANR；最终配置通过冷启动验证。主机可用内存连续 30 秒低于 2048 MiB，或新增组件发生 OOM 时，看门狗停止新增组件并写入 `capacity-stopped`，不停止商城。清除该文件前应重新评估容量。

EMQX 随附 Community License，当前单节点内部演示适用；集群、对外商业托管等用途需要另行核对授权。当前数据使用 ACK retained local PV，旧 GCP 仅保留受保护的迁移备份。迁移后的运行安装器检测 pipeline.json 中的 broker_ip，不再启动本地 Compose broker。

必须启用 `durable_sessions.enable=true`，订阅器使用固定 client ID、`clean_start=false` 和 86400 秒 Session Expiry。普通持久连接的会话仍可能仅存在内存，Broker 重启后会丢失订阅，发布端 PUBACK 不能证明订阅端收到。磁盘会话使用单分片、单副本，消息保留 7 天；应通过管理 API 检查订阅器 `durable=true`，并做实际重启验收。参见 [EMQX Durable Sessions](https://docs.emqx.com/en/emqx/latest/guides/durability/durability_introduction.html)。

## 部署

1. 本地构建签名 APK。播放器在本地工作台提供，构建与连接配置见 [本地说明](local/README.md)。
2. 通过已授权的 GCP SSH 连接，将本目录文件复制到 `/opt/vehicle-demo`，将 `scripts/android-webrtc/latest-video` 复制到 `/opt/vehicle-demo/latest-video`。不覆盖 `/opt/mall-demo-webrtc`。
3. 在目标主机执行 `sudo python3 /opt/vehicle-demo/install-runtime.py`。脚本依赖现有 `/home/cherry/android-sdk` 的 Android 36 Google APIs x86_64 镜像、现有视频 venv、原生 gateway、Caddy、coturn 和运行用户 cherry。遇到未知主机布局应停止检查。
4. 仅将签名 APK 复制到 `/var/www/downloads/vehicle-demo.apk`。不要再向 GCP 发布车机播放器、验证首页或旧报表页面。
5. 等待 `adb -s emulator-5556 shell getprop sys.boot_completed` 为 `1`，并确认 `cmd package resolve-activity --brief com.guance.vehicledemo` 可解析 MainActivity（首次安装则先完成 package manager 初始化）。执行 `sudo python3 /opt/vehicle-demo/prepare-device.py` 禁用专用镜像中不需要的 Google 搜索、相册、日历等 8 个应用，再执行 `adb -s emulator-5556 install -r /var/www/downloads/vehicle-demo.apk`。
6. 执行 `sudo python3 /opt/vehicle-demo/install-web.py`。脚本维护视频/输入、MQTT、APK 路由，保留历史报表和实时接收 GET；旧车机前端路由返回 410。保留其他 Caddy 路由、备份配置，先校验再 reload。不开新的 GCP 防火墙端口。
7. 通过车机界面填写发布凭据并开始模拟。凭据保存在主机 `/etc/vehicle-demo/credentials.json`（root-only）及 App 私有加密存储中，不放入页面、APK、Git、日志或报告。

部署脚本保留已有 credentials 和 volumes。如果存在持久化 broker 数据而凭据文件丢失，会拒绝生成替代密码，需从受保护备份恢复。首次安装前保持至少 5500 MiB 可用内存；部署中不修改商城 AVD、APK、空闲策略或服务。

## 验收与观察

```bash
sudo /opt/vehicle-demo/observer-venv/bin/python /opt/vehicle-demo/check-acl.py
sudo /opt/vehicle-demo/observer-venv/bin/python /opt/vehicle-demo/observer.py --summary
systemctl is-active vehicle-demo-emulator vehicle-demo-gateway vehicle-demo-video vehicle-demo-observer vehicle-demo-watchdog
```

独立订阅器以 observer 账号连接 broker，校验真实消息后先提交 SQLite，再确认 QoS 1。收据在 `/var/lib/vehicle-demo/receipts.sqlite`，保留 7 天；同 ID 不同内容单独记为冲突。`--since <epoch毫秒>` 可限定验收窗口，p95 使用窗口内最新 600 条消息。重连补传的延迟应与恢复后的稳定延迟分开分析。

看门狗每 10 秒记录 `/var/lib/vehicle-demo/runtime.sqlite` 的主机可用内存和 OOM 标记。Activity 恢复最多 5 次 / 5 分钟。采样日志每 10 秒产生一次；读取时先按 tag 过滤，再取最后记录，不能用 `logcat -t 8`，因为 `-t` 会先截断全局日志而漏掉心跳。

专用 AVD 每 15 分钟通过 Android 网络时间服务刷新 NTP，并将时间源优先级设为 `network,telephony`。本次 Android 16 镜像默认优先电话时间，NTP 默认间隔 18 小时，15 小时后曾实测落后宿主约 4.56 秒。看门狗在 `clock_health` 表保存校时前后偏差和测量往返时间，失败时一分钟后重试，不中断容量保护。该设置只作用于 `emulator-5556`。参见 [Android 网络时间检测](https://source.android.com/docs/core/connect/time/network-time-detection) 与 [时间源优先级](https://source.android.com/docs/core/connect/time)。

独立订阅器保留原始 UTC 延迟；0.1.1 消息的采样间隔改用同一 `producerRunId` 内的 `sampleMonotonicMs`，另行报告 `wallClockGapsOver2500Ms`。旧消息没有单调时钟字段时仍使用 UTC 间隔，不将不同进程的单调时钟直接相减。

执行受控重启或 instrumentation 测试前，创建 `/var/lib/vehicle-demo/maintenance`。它暂停 Activity 和视频恢复，容量保护仍运行。操作结束须删除该文件。App 的暂停状态由 Room 保存，看门狗绝不替用户点击“开始模拟”。

第一阶段验收必须覆盖：签名 APK 实际收发、场景一致性、2 分钟断网补传、App/AVD/broker 重启、匿名和越权拒绝、商城回归，以及 **连续真实 24 小时** 无人值守运行。开始稳定性窗口前记录采样序号、收据数量、时间、组件重启计数与资源状态；故障注入和调试时间不计入稳定窗口。尚未到期不能宣称通过。

恢复稳定至少一分钟后执行 `sudo /opt/vehicle-demo/observer-venv/bin/python /opt/vehicle-demo/acceptance.py begin`；之后用同一命令的 `status` 子命令检查。基线保存在 `/var/lib/vehicle-demo/soak.json`，开始命令不会覆盖已有窗口。状态同时核对真实经过时间、连续收据、采样间隔、延迟、App/服务进程、可用内存及容量采样覆盖；任何失败都保留原证据，不能通过重置计数伪装通过。

## 回滚

```bash
sudo systemctl disable --now vehicle-demo-watchdog vehicle-demo-video vehicle-demo-gateway vehicle-demo-emulator vehicle-demo-observer
sudo docker compose -f /opt/vehicle-demo/compose.yaml stop
```

从 Caddyfile 中仅移除 `BEGIN VEHICLE DEMO` 到 `END VEHICLE DEMO` 的区块，执行 `caddy validate --config /etc/caddy/Caddyfile` 后 reload。部署备份在 `/etc/vehicle-demo/Caddyfile.before-*`，若部署后还有其他路由修改，不要直接用旧备份覆盖整份文件。

保留 AVD、Room、ACK EMQX PVC、GCP 迁移备份、收据和签名密钥，方便恢复和审计。旧 GCP broker 活动文件已移到受保护备份；不再直接执行上面的本地 Compose 命令。不要清理商城组件。

## 部署边界

EMQX、Kafka、Flink、对象存储和 Spark 使用 ACK 独立命名空间，见 [数据链路说明](../../vehicle-pipeline/README.md)。GCP 保留安卓配套、转发和轻量观察器；车机工作台可保持本地运行，也可作为独立后端部署到 ACK，经主站 Gateway 访问；镜像、Helm、ServiceAccount 和发布流程见 [ACK 工作台部署](../../docs/vehicle-demo/ack-workbench.md)。

## 车机镜像精简与恢复

`prepare-device.py` 固定使用 serial 5556，并校验 AVD 名为 `VehicleDemo_API36`，才允许修改。它仅禁用 8 个可选预装应用，不卸载、不清理数据，不修改 GMS、SystemUI、键盘、网络服务或商城设备。首次启用状态保存在 `/var/lib/vehicle-demo/device-apps-before.json`；执行 `sudo python3 /opt/vehicle-demo/prepare-device.py --restore` 可重新启用本次禁用的应用。该调整用于降低冷启动竞争和常驻内存，不能替代主机容量保护。

数据服务部署与回滚见 [运维说明](../../docs/vehicle-demo/pipeline-operations.md)。


GCP 不再提供车机验证前端；播放器和报表入口由工作台（本地或 ACK）提供。
