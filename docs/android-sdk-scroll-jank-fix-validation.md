# Android SDK 滑动掉帧修复实验

2026-09-10，约 10:34–10:44（Asia/Shanghai），小米 14 / Android 16。

## 结果

保持 RUM/Session Replay 开启，基础 SDK 应用最小补丁后，正常首页滑动的三轮
P95 从 73/73/69ms 降到 20/20/19ms，按三轮均值约下降 72.6%；P99 从
85/93/77ms 降到 22/21/20ms。业务 JS bundle 与原版逐字节一致。

这版消除了本次测试的严重长帧，但没有消除全部掉帧。约 20ms 的慢帧仍超过
120Hz 的约 8.3ms 预算，也高于 60Hz 的 16.7ms。当前手机保留修复实验包，
已停止方法采样、回到首页，应用数据保留。

## 修复内容

基于已核对的官方 `ft-sdk:1.7.5`，只替换
`com.ft.sdk.FTViewPermanentIdResolver.class`。官方 Replay `0.1.8` 不变。

`resolveResourceName` 在查询前检查 View ID：`NO_ID` 或资源包高字节为零，
直接返回 null，继续原有类名路径回退。Android 动态 View ID 不属于资源表，
无需先查询、抛出 NotFoundException 再回退。React Native 会将运行时 reactTag
设置为 View ID；这与本次重复资源异常热点吻合。

保留有效资源 ID 查询、非零资源包未知 ID 的异常回退、父子路径、兄弟索引、
页面命名和 MD5 规则。未缓存完整路径、未删除 permanentId、未降低采样率。
这是第一版定点修复，尚未优化父路径重复遍历、字符串/哈希及其他 Replay 开销。

补丁及复现方式：`mobile-app/sdk-patches/ft-sdk-1.7.5/README.md`。
实验使用本地坐标 `ft-sdk:1.7.5-jankfix01`；仅显式加载 init script 时生效。
已用 dependencyInsight 确认默认构建仍选择官方 `1.7.5`，实验构建选择本地版本。
SDK 内原有上报版本字符串未改变，应以 AAR/APK 哈希区分实验包。

## 同设备 A/B

相同 Safe Release 2.3.12 / versionCode 5、Hermes、R8、arm64、profileable 配置，
相同 Gateway 配置和业务 bundle。原版 APK 从手机备份，哈希与前轮恢复包一致。
每组重启进程，约 6 秒预热后做三轮约 30 秒的首页往返滑动：
`(600,900) ↔ (600,2100)`，单次 700ms，每轮 37–38 次。
未改变系统刷新率；测试前后 Thermal Status 都为 0。
这不排除其他系统负载或厂商调度影响。

| 组别 / 轮次 | P50 | P95 | P99 | GPU P95 | legacy jank |
| --- | ---: | ---: | ---: | ---: | ---: |
| 原版 1 | 6ms | 73ms | 85ms | 3ms | 17.56% |
| 原版 2 | 6ms | 73ms | 93ms | 3ms | 17.31% |
| 原版 3 | 6ms | 69ms | 77ms | 4ms | 17.56% |
| 修复 1 | 5ms | 20ms | 22ms | 4ms | 13.56% |
| 修复 2 | 5ms | 20ms | 21ms | 4ms | 13.37% |
| 修复 3 | 5ms | 19ms | 20ms | 3ms | 13.02% |

表格取进程级 gfxinfo histogram，现代 jank 计数均为零，不能据此宣称零掉帧。
累计 rendered frames 与 FPS 不等价，也不将 `1000/P95` 当作平均 FPS。

## 独立 Perfetto

每组另外录制约 12 秒，完整有效区间分别为 11.926 和 11.915 秒，使用 128MiB
缓冲。录制与 ART 方法采样分开。

| 指标 | 原版 | 修复版 |
| --- | ---: | ---: |
| 应用 FrameTimeline 帧 | 632 | 1157 |
| 含 App Deadline Missed | 79（12.50%） | 138（11.93%） |
| 主线程 draw-VRI 次数 | 633 | 1159 |
| draw-VRI 超过 32ms | 78 | 0 |
| draw-VRI 最大耗时 | 98.397ms | 21.621ms |
| draw-VRI 平均耗时 | 8.835ms | 2.398ms |

主要收益是严重长帧显著缩短；错过截止时间的比例只小幅下降。上述比例只代表
各自的独立 trace 窗口。两组帧数、系统 jank 类型也不同，不能只比较超时帧绝对数量。

## 方法与采集功能检查

修复版另做 12 秒、1000µs 间隔 ART 采样，得到 2,526,765 字节有效文件：

- 仍采到 WindowsOnDrawListener、SnapshotProducer、FTViewPermanentIdResolver。
- 仍采到有效资源名称查询，未采到 NotFoundException；这不是关闭整个资源解析。
- 仍采到 RecordedDataProcessor、SessionReplayRecordWriter、FTRUMInnerManager
  和 SessionReplayDataUploadRunnable，支持本地回放处理/写入和上传任务仍在运行。

ART 时间字段与墙钟长度不一致，本报告只用其证明调用链和样本存在性，不把其
`total_ms` 当作墙钟耗时。未采到某方法也不等于数学上证明调用次数为零。

首页、详情打开/返回、故障抽屉打开/收起正常，抽屉显示“未注入异常”。未下单，
未改变购物车。移动端 18 suites / 87 tests、typecheck、lint、原有 Replay
反射缓存检查及 APK 反射/资源上传 ABI 检查通过。

JVM 回归测试编译官方原版和修复版 resolver，2,040 项断言通过；覆盖有效/无效
资源 ID、动态 ID 边界、节点改 ID、兄弟重排、重挂父节点、页面名变化和 null。
路径/哈希输出相同，10,000 次动态 ID 解析不再调用 Resources。Android fake
测试的边界已写在脚本中，不将其替代真机证据。

服务端验收尚有缺口，且最初查询范围有误（11:02 更正）：最初查的是 Demo
工作空间和另一网关的公开配置，不能代表本次 APK。实际构建网关为
`https://35.241.68.75.nip.io`，运行配置为 `app_id=mall_app_android`、
`service=mall-app-android`，数据进入「观测云演示Demo」
`<workspace-id>`。

在正确工作空间已查到修复版会话 `61c030dfd4ed438c9bea745eba1be2bf`
（10:38:20 开始）的首页、详情及返回记录，部分 view 带 `session_has_replay=1`。
浏览器仍复现“获取会话重放数据异常”；修复前 10:35:19 的
`8d13115bdb8d44bcb2b7b4d6adcb6630` 能加载回放画面和时间轴。
这说明 RUM 已入库、播放失败确实存在，但尚未定位分片上传、存储、读取或解析
的具体失败点，也未证明失败由补丁引起。

源码中 SessionReplayRecordWriter 在本地写入后更新 has-replay 状态，并不等待
上传成功，所以标记不能当作云端分片可用的证明。GCP order-service 日志能看到
Replay POST 到达，但没有对应的上游响应码，仍不足以验收上传成功。
新启动的 10:58 会话 `5e58ffa09d6740999b58cdd75ae4aee1` 已有 view 数据，
首次打开显示“获取会话信息失败，暂不能确定回放类型”；此结果不能用于判断
永久 ID 补丁是否影响回放协议。查询及范围纠正见
`owl-reports/android-sdk-fix-2026-09-10.md`。

## 产物与回滚

修复 APK 与精确 R8/Hermes 映射：
`mobile-app/build/diagnostics/scroll-jank/sdk-fix/`。

```text
修复 app.apk SHA-256
b93936d0db9c290f598462d68993b55c0d9411a78653bcf3e536bf9026d21bf5

原版 baseline.apk SHA-256
397b96cd14113a70249dec29b8523346a48b05f05c27e49017c739699560ae1a

本地修复 AAR SHA-256
c98a8dacfac8e4aba1c83d0a16ebd2c2ef7ee2b57f5346ebb2698866e272b1df
```

可用 `adb install -r mobile-app/build/diagnostics/scroll-jank/sdk-fix/baseline.apk`
回滚到本次原版基线；回滚后重启进程。补丁未发布到官方仓库或 Maven。

原始证据：`.trellis/tasks/09-10-android-scroll-jank/evidence/sdk-baseline*`、
`sdk-fixed*`；构建与检查日志：`mobile-app/build/sdk-patch/`。
