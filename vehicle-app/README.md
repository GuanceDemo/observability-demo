# 车机遥测 App

独立 Android 原生应用，包名 `com.guance.vehicledemo`，版本 `0.1.3`（code 4），最低 Android 7.0 / API 24，目标 API 36。与商城 APK、Helm Chart、Web RUM 独立发布。

数据流：**Android → MQTT 5 / WSS / QoS 1 → EMQX → Kafka → Flink → Parquet → Spark → 报表数据库**，同时保留独立 MQTT 订阅验收器。EMQX/Kafka/Flink/Spark 部署在 ACK；GCP 承载车机、视频/输入服务及独立订阅验收器。详见 [数据链路说明](../vehicle-pipeline/README.md)。

## 运行方式

在专用横屏 Android AVD 内保持 Activity 前台和屏幕常亮。Application 内的协程持续采样，不依赖浏览器连接。主机看门狗会恢复退出的 Activity，但不会修改 App 持久化的“暂停”和“模拟断网”状态。这不是通用 Android 手机的无限后台服务方案。

初次安装处于暂停、未配置状态。在“连接配置”中填写 WSS 地址、发布用户名和密码，然后点击“开始模拟”。默认地址为演示 GCP 主机的 `/vehicle-mqtt`。用户名与密码须由部署管理员提供，APK 不含凭据。密码通过 Android Keystore AES-GCM 加密后存入私有目录；改变地址或用户名时必须重新输入密码，旧密码不会自动发送给新地址。

场景支持行驶、停车、充电、高温、模拟断网和暂停。运行中电量耗尽会自动转入充电，充满后自动开始新行程；手动停车和暂停会保持。30%–80% 快充约 20 分钟，80% 后分段减速，使用真实时间。速度、里程、电量与温度按同一状态模型演进。恢复进程不会补造停机期间的行驶数据。暂时断开 MQTT 时仍继续采样。参数来源、官方值与仿真假设见[模型说明](../docs/vehicle-demo/vehicle-physics.md)；Demo 界面不显示品牌或车型。

## 消息与持久化

- 遥测主题：`vehicle/v1/demo-vehicle-001/telemetry`，QoS 1、非 retained。
- 状态主题：`vehicle/v1/demo-vehicle-001/status`，QoS 1、retained，带离线遗嘱。
- [消息结构](telemetry.schema.json)：毫秒时间戳、事件 ID、车辆 ID、行程 ID、持久化递增序号、速度 km/h、里程 km、SOC %、电池温度 °C、场景。
- 车辆状态与 Outbox 插入在同一 Room 事务中完成。收到成功 PUBACK 才删除 Outbox。重发沿用原 `eventId`，订阅端按 ID 去重。
- 采样调度和车辆状态变化使用单调时钟。0.1.1 起增加可选的 `sampleMonotonicMs` 与 `producerRunId`，仅在同一进程标识内比较采样间隔；`eventTime` 仍是真实 UTC 时间。校时不会改变消息 ID，也不改写已有收据。
- 队列保留最多 24 小时、100 MiB，超限从最早事件开始淘汰，并累加可见、持久化的丢弃计数。
- 演示只配置一辆车。不要把同一发布凭据同时用于多个安装实例；扩展车队时需为车辆分配独立 ID、账号与 ACL。

## 构建与测试

依赖 JDK 17、Android SDK 36。本目录使用 Gradle Wrapper，构建不需要在 GCP 运行主机安装 Android build-tools。

```bash
./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest
```

调试包后缀为 `.debug`，不会覆盖签名发布包的数据。Room instrumentation 测试在真实 AVD 上运行：

```bash
adb -s emulator-5556 install -r app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5556 install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s emulator-5556 shell am instrument -w com.guance.vehicledemo.debug.test/androidx.test.runner.AndroidJUnitRunner
```

签名密钥必须位于仓库外。设置 `VEHICLE_KEYSTORE`、`VEHICLE_STORE_PASSWORD`、`VEHICLE_KEY_PASSWORD`，别名固定 `vehicle-demo`，然后执行 `bash build-release.sh`。产物为 `app/build/outputs/apk/release/app-release.apk` 和 SHA256 文件。保留密钥以支持后续覆盖升级。

HiveMQ 的 WebSocket 是显式可选依赖；R8 保留 Netty 泛型处理器的运行时签名。仅调试包编译或单元测试通过不足以证明发布版可连接，必须对签名 APK 做真实 WSS 收发验收。

部署、回滚及持续验收见 [运行说明](../scripts/vehicle-demo/README.md)。

0.1.2 起，遥测数据库使用单连接 TRUNCATE journal 和 `synchronous=FULL`。采样事务完成落盘后才允许 MQTT 读取待发事件，避免 AVD 断电式停止后复用已发送序号；状态与 outbox 仍在同一事务中。
