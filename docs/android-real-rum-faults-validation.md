> 文档中的 `WORKSPACE_ID` 为占位符，打开回放链接前请替换为当前演示空间 ID。

# Android异常：GCP 实施与验收

首次验证：2026-09-16 11:27–12:02；对齐修复复验：14:47–15:00（Asia/Shanghai，UTC+08:00）。
当前 GCP 版本为 2.3.21/code14；下文保留 2.3.19 的历史证据，最新结论见末节。
环境：`twt-gcp-integration / asia-east2-a / mall-demo-kvm-emulator-poc`。

## 交付

[GCP 演练入口](https://35.241.68.75.nip.io/business.html?lang=zh&scene=android-storefront&view=mobile)
和 [APK 下载](https://35.241.68.75.nip.io/downloads/mall-demo-safe.apk)。

APK `2.3.19` / versionCode `12` / `com.malldemomobile.safe`，覆盖安装保留数据。
App 抽屉及 Android 网页面板均为 **Android异常 / 后端 / 基础设施**。
Android异常下恰有商品详情白屏、结算闪退、请求成功但持续加载三个场景。
英文分类为 Android Errors / Backend / Infrastructure；场景文案跟随 APK 语言。
服务端业务地址和 RUM gateway-proxy 沿用原配置。正式 K8s 未部署。

## 场景与操作

| 场景 | 触发 | 实际缺陷和定位证据 | 恢复 |
| --- | --- | --- | --- |
| 商品详情白屏 | 启用后打开图书 | 详情读取缺失字段并抛出真实 TypeError，ErrorBoundary 留空；结合 Replay 和 JS/component stack | 关闭全部故障，重载详情 |
| 结算闪退 | 启用后登录 Demo 角色，购物车结算并在 App 确认 | 原生主线程结算模型不满足非空约束，真实 IllegalStateException；SDK java_crash | 连接 / 刷新 APK，恢复原 run，不重新崩溃 |
| 请求成功但持续加载 | 启用后打开图书 | 正常 HTTP 200，但事件 content_loaded 与 content_ready 不匹配；3 秒独立就绪检测上报 ContentNotReady | 关闭全部故障，正常事件使内容 ready |

远程注入只置为 armed；真实业务动作才 triggered。结算确认前取消仍为 armed，
不提交订单。普通构建 `CHECKOUT_CRASH_ENABLED=false`，场景不可用，原生方法也拒绝调用。
GCP 显式开启此单独能力，旧 `DEMO_FAULTS_ENABLED` 仍 false。

## 最终 APK 的真实 RUM 数据

工作空间 `WORKSPACE_ID`，应用 `mall_app_android`。
使用 Owl 的 `owl.data.check_dql` / `owl.data.query` 读取 RUM error/resource/action/view/session；
检查返回文件内部 success 和实际记录，并使用已登录 Chrome 播放平台回放。
原始结果保存在忽略目录 `owl-reports/android-real-rum-faults-20260916/`。

| 场景 | fault_run_id | Error 时间（北京时间） | session_id | view_id |
| --- | --- | --- | --- | --- |
| 白屏 | fault-mu3kb8a0-3imwju06 | 11:50:11.070 | ea2373472f4b47669ea71ce57b39b229 | a32a1bc8b50d44fa8cfd8c1f8c693dea |
| 闪退 | fault-mu3k8pcu-oon1j6tq | 11:49:13.477 | efd1b0bdb36a41fcb53e7bd91b720f67 | ed429fa5e78445abbc7c251f6f1e9bd7 |
| 持续加载 | fault-mu3kcc8f-fnhikjjp | 11:51:09.450 | ea2373472f4b47669ea71ce57b39b229 | d682411f27f444ec86976b9504a83df4 |

- 白屏：设备实测内容空白，恢复后正常。RUM 收到 `console_error`：
  `Cannot read property 'trim' of undefined`，附实际 JS 地址和组件堆栈。
- 闪退：Logcat 在上述时间记录 `FATAL EXCEPTION: main`、PID 1350，栈指向
  `DemoFaultsModule.prepareCheckout`。RUM `java_crash` 同 run，消息
  `Checkout token missing while preparing checkout`。重启时 `native_crash_restart_observed`
  和 recovered 沿用原 run；恢复事件不冒充 Crash。
- 持续加载：触发请求 HTTP 200，Resource 耗时 `36.743052 ms`；故障错误含
  `biz_request_id=biz-mobile-mu3kcrau-9wsyci96`、`actual_state=loading`、
  `state_event=content_loaded`、`expected_event=content_ready`、
  `wait_after_response_ms=3000`。恢复请求 HTTP 200 / `33.001484 ms`。

## 回放实测及边界

- [结算崩溃会话](https://console.guance.com/rum/sessionReplay?app_id=mall_app_android&view_id=ed429fa5e78445abbc7c251f6f1e9bd7&session_id=efd1b0bdb36a41fcb53e7bd91b720f67&ts=1789530481206&w=WORKSPACE_ID)：
  已打开并播放，购物车画面可见；时间线包含去结算、取消、再次结算、确认闪退和 java_crash。
  这次记录的画面未完整呈现购物车滚动和确认弹层，不应声称逐帧完整。
- [持续加载及恢复会话](https://console.guance.com/rum/sessionReplay?app_id=mall_app_android&view_id=d682411f27f444ec86976b9504a83df4&session_id=ea2373472f4b47669ea71ce57b39b229&ts=1789530666321&w=WORKSPACE_ID)：
  已播放，明确看到“正在加载图书内容…”及缺失描述，恢复片段显示正常描述。
- 白屏先在 2.3.18 的会话 `9e2b2aaf3f2d4158a31c2fede1d672fd` 播放并看到空白详情；
  最终 2.3.19 的设备白屏、恢复和真实 Error 已验证，同会话回放时间线也包含该错误，
  但在此最终会话定位白屏节点时仍显示前一页面，白屏帧复现不稳定，不能宣称完整画面验收通过。

Replay 用于还原业务操作，根因需结合真实 Error/Crash/Resource 和状态字段。
进程死亡后无法继续由该进程采集 Launcher；不能把退出后的桌面画面作为必要回放内容。
新错误入库可能早于会话汇总；从 View 的平台按钮进入回放，使用其 View 时间参数，
不要随意用错误时间替代。观察到的回放缺帧原因尚未确认，不归因于特定 SDK 缺陷。

## 追加排查：事件与画面对齐（2026-09-16 下午）

此轮未改 APK 或 SDK。使用 GCP 上的定向网络抓包解压实际 Replay 上传分段，
再与 Owl RUM 查询和已登录 Chrome 播放结果比对。解压后的分段及查询证据保存在
忽略目录 `owl-reports/android-replay-alignment-20260916/`；不将含请求头的网络抓包入库。

### 已确认的应用集成问题

`mobileObservabilityConfig.ts` 同时启用原生 Activity/Fragment 自动 View；
`App.tsx` 又在导航后的 `useEffect` 手动 stop/start 业务 View，bootstrap 也启动首页 View。
实际记录出现两个紧邻的 storefront/home，随后 MainActivity 覆盖业务 View。
白屏渲染错误发生在 effect 切换 View 之前，因此 Error 与白屏快照属于不同 View。

用户截图会话 `a8368d343c674b22847ce865b0f479b3`：

- 13:56:50.821 的 TypeError 属于 `MainActivity / 28af089be0174b93a44a1fa401a401a7`。
- 13:56:50.837 才开始 `storefront/detail / c8243182ec2a4591a9f157f25a109241`。
- 13:56:55.849 又切回 `MainActivity / e77e4c15cb734742bdd4b45f2e574983`。
- Chrome 连续播放复现：时间线 00:12 报错，00:16 仍是首页，00:17 末帧才显示空白。
  因此截图反映的是实际对齐失败，不能解释成故障没有触发或只需点播放。

### 原始上传证明白屏可采集，但不能据此断言历史漏帧的 SDK 根因

新复现 run `fault-mu3pmdet-uckanvsn`，session `71e104fc8574440d96bf6a41e65502a2`：

- Error：14:18:37.294，View `MainActivity / 6a990ae634df428bb337f7e15081134d`。
- 业务详情 View：14:18:37.306，`813a29f9114d42bda2cab03a3958c262`。
- Replay 完整快照：14:18:37.396，比 Error 晚 102 ms；含 26 个 wireframe，
  内容区为白色 shape（x=0、y=137、width=393、height=655），只有页头和底栏文字，
  没有首页书单或详情正文。由此排除“SDK 根本不支持记录这种白屏”。
- 该分段在约 14:18:48 发出，上传 HTTP 200。会话汇总晚于 Error/View 入库，
  汇总出现前平台显示“获取会话信息失败”；聚合完成后回放可以播放出白屏末帧。
- 仅定位到末尾时仍可能显示上一帧，继续播放后才应用最后的白屏快照；
  此现象与原会话连续播放时的数秒迟到分别记录，不能混为一谈。

抓包还收到用户原会话 13:57:26.482 的白屏快照，直到 14:18 重新运行 App 才上传。
GCP 现有 idle 策略为最后一次 Android 输入后 30 秒回 Home，再过 15 秒 force-stop。
这能确认存在尾部数据延后补传；尚不能仅凭此证明所有历史白屏缺帧均由该策略造成。
Replay 上传返回成功也不等价于平台已经完成索引、会话聚合和播放。

后续修复应统一业务 View 的管理，避免 Activity 自动 View 覆盖，确保目标 View
在详情渲染/错误前建立，并验证静态故障页的关键帧及会话尾部数据。
当前仍未通过“点击—异常画面—对应 Error—恢复画面”连续回放验收。
尚缺原截图 00:12 对应历史 Replay 分段的完整原始记录，不能把该处数秒画面迟到
直接定性为队列丢帧、上传丢包或平台播放器缺陷。

## 构建、校验和产物

- 移动端 20 suites / 94 tests 全通过；TypeScript、ESLint、storefront 一致性通过。
- Order 32 tests 全通过；受影响的 Web/player 25 tests 全通过。
- 普通 Safe 和 GCP 演练 Safe Release 构建成功，Replay 反射及资源上传 ABI 校验通过。
- 最终 Hermes source map 与 R8 mapping 从同一次演练构建提取，未上传到观测云。
  本地 metro-symbolicate 已将真实白屏堆栈还原到 `src/screens/DetailScreen.tsx:42`
  和 `src/components/DetailFaultBoundary.tsx:16`（组件入口）；R8 map ID 与 native
  Crash 栈一致。平台尚未验证源码行号还原，需上传匹配符号后再验收。
- 本地目录 `mobile-app/build/releases/2.3.19/`（忽略目录）：
  `mall-demo-android-errors-2.3.19.apk`、`android-errors-sourcemap.zip`、`manifest-2.3.19.json`；
  普通禁用崩溃构建位于 `ordinary-safe/app-safe-release.apk`。

APK SHA256（本地、GCP 部署源、已安装 base.apk、公开下载均一致）：

```text
eaa088d908b08bc194f479ae553ccd40045f5fff5682c6ad8fec3a6a38498c70
```

符号包 SHA256：

```text
58689854f1149e2352d09958c4676cd39c01cc0dded4858dd56ced44deaa9201
```

## GCP 发布及回滚

发布目录 `/home/cherry/mall-demo-web/releases/android-errors-20260916`。
Web 基于现有运行 JAR 只修改 Android 分类标签、说明和翻译缓存版本，
镜像 `observability-demo-order-service:android-errors-20260916-final`。
只重建 Order 容器；Gateway/Inventory/Payment/MySQL/Redis 未重建。
Emulator/App/latest-video/Caddy 均 active，应用包名和已有数据保留。

备份目录 `.../android-errors-20260916/backup/` 含原 APK、原 JAR、旧 Compose 和
`rollback-web.sh`。原始 Web 可执行该脚本回滚；APK 降版本需明确执行
`adb install -r -d <备份APK>` 并同步两个发布文件，不能卸载清除数据。
另保留上一版 `2.3.18` 的 APK 和 `compose.2.3.18.json`，可作为中间回滚点。
本次未推送 Git、未打发布 tag、未上传源码映射。


## 对齐修复：2.3.21 / code14

Android 关闭 Activity/Fragment 自动 View，业务导航 await 原生 startView 后再渲染、请求和触发故障；
移除导航后 effect 切换及重复首页 View。真实后台超过 500 ms 才停止 View，回前台恢复当前业务 View，
忽略远程 onNewIntent 导致的短暂 AppState 切换。本轮没有修改 SDK 实现。

GCP 已覆盖安装，保留原数据；安装 APK、服务源 APK、公开下载 APK 与本地产物 SHA256 一致：
`376fe1240f65c854c64d0c28a48d106983e71a99c8cef2fa447d67c7febf6807`。
本地符号包 `mobile-app/build/releases/2.3.21/android-errors-sourcemap.zip`，未上传。
20 suites / 97 tests、TypeScript、lint、Release 构建及最终 Replay ABI 检查通过。

[复验会话](https://console.guance.com/rum/sessionReplay?app_id=mall_app_android&session_id=2d5385238a414f849542fd807ab12b80&ts=1789541248988&w=WORKSPACE_ID&lak=Rum)
包含以下三个真实错误，均归属正确业务 View：

| 场景 | run | View | Error 时间戳 ms |
| --- | --- | --- | --- |
| 白屏 | fault-mu3qntfz-527wegkv | 39cde33b03374fc4994411fef37cc395 | 1789541273883 |
| 持续加载 | fault-mu3qovt1-6xjfjflx | 4e184b76118148f08c0d224a9233d615 | 1789541323366 |
| 闪退 | fault-mu3qq2hk-11jlf1lz | 4aed6a21e040488487032f5c01caa800 | 1789541405442 |

### 通过的证据

- 白屏：同详情 View 的增量画面在 `1789541274015` 删除正文，只保留页头/底栏，
  比真实 TypeError 晚 **132 ms**。云端定位 00:22 错误后播放，立即出现空白详情。
- 持续加载：同详情 View 的 `1789541320410` 增量包含“正在加载图书内容…”，
  检测错误发生于其后约 3 秒；重新加载回放并播放错误节点，00:01:13 可见持续加载画面。
- 闪退：云端收到同 cart View 的真实 `java_crash`，并关联“确认闪退”Action。
  原始 Replay 在 `1789541394932` 已包含“触发结算闪退？”、“确认闪退”、“取消”，
  此后 `1789541395014` 仍有确认画面更新，早于 crash 约 10 秒。
- 三场景设备表现和恢复均已实际操作；GCP 服务运行正常。解压分段与查询在忽略目录
  `owl-reports/android-replay-alignment-20260916/2.3.21/`，原始含请求头抓包不入库。

### 仍未通过的播放器验收

本次平台存在 seek 后显示旧帧、重新加载后播放表现变化的现象。
白屏及持续加载错误节点已实播看到对应画面，但不能据此宣称整段连续回放全部稳定。
购物车确认层虽已采集并上传，云端实际播放仍停在旧购物车，尚未看到确认层；
从 cart View 入口重开仍复现。平台同会话头部还曾分别显示 2.61 min 与 25.07 s。
这些现象尚未定位到 SDK 分段格式、服务端组装或播放器具体实现，不归因于某一组件。
应用侧 View 竞争已修复；闪退确认层及跨分段连续播放仍需继续查，任务不按全面验收完成归档。

### 后续定位：跨批次片段未进入播放结果（2026-09-16）

> 下文为当时的排查记录，归因已由后续 2.3.22 压缩拼接复现和云端实播更新；
> “资源大小匹配首批”不等于服务端只查询了第一批。

关闭“跳过不活跃”后仍复现旧购物车，不能用该开关解释确认层缺失。
查询同一会话 `session_replay`，购物车 View 有五个独立文档及附件：

| 分段起点 ms（查询 time） | 终点 ms | 原始字节数 | 内容 |
| --- | --- | --- | --- |
| 1789541358512 | 1789541358714 | 71916 | 首次进入购物车 |
| 1789541365022 | 1789541368764 | 87238 | 配置故障后的画面 |
| 1789541379936 | 1789541380308 | 65047 | 购物车滚动 |
| 1789541394798 | 1789541395014 | 34259 | 含确认层增量 1789541394932 |
| 1789541405407 | 1789541405409 | 530 | 闪退确认触摸尾段 |

Chrome Network 观察到 `/api/v1/session/replay/get` 对首页、白屏详情、第二次首页、
持续加载详情均返回 200；资源大小依次为 50.8、53.8、83.6、72.7 kB，分别与上传的
第一批 50812、53812、83637、72689 字节相符，没有覆盖对应 View 的后续批次。
这支持“分段下载/组装缺失”的方向；尚未导出完整响应体，不能据此断言具体去重算法。
购物车画面已复现，但此次 Network 列表未取得其独立下载响应，不把其他 View 的
响应大小写成购物车响应的直接证据。

所有索引文档的 `index_in_view` 都是字符串 `0`，但 `__docid` 和 `attachment` 各不相同。
核对 hash-pinned 官方 `ft-session-replay-0.1.8-sources.jar`，上传器确实将该字段固定为 0，
并注释移动端暂未使用。尚未证明重复 index 是云端丢段的原因；不能未经协议核实改成
任意时间戳，也不能通过重写历史遥测或人工切 View 掩盖缺段。

当前 Demo 仓库不包含观测云播放器及该下载 API 的服务端实现。
后续需要对照云端返回 JSONL 的全部分段、附件检索与去重条件，以及播放器流解析，
再确定修复位置。已向用户请求对应代码目录；本轮未修改或重新部署 APK，当前仍为 2.3.21。
验收仍要求原始会话在确认 Action 前后显示确认层，且滚动、恢复等后续批次正常播放。

## 分段压缩修复：2.3.22 / code15

### 根因与修复

官方 0.1.8 `BytesCompressor` 忽略 flush 参数，第一次 `finish()` 后 `reset()`，
追加第二条空 zlib 流。单个上传包能解压，200 也正常；但按 Replay 协议去除
每段 2 字节头、6 字节尾拼接时，第一段已有的终止标志使解压器提前结束。
这解释了首批大小的响应及后续确认层、滚动/恢复画面缺失，不能直接归为云端漏查附件。

回移官方 [压缩实现修复](https://github.com/GuanceCloud/datakit-android/blob/f2d2cbc1a43d50d4d78cbc3fdd8b68817b3a5d19/ft-session-replay/src/main/java/com/ft/sdk/sessionreplay/internal/net/BytesCompressor.java)
（0.1.9-alpha03 changelog），保持原 0.1.8 其余实现及现有性能补丁。
本地坐标 `ft-session-replay:0.1.8-replayfix03`，配对 `ft-sdk:1.7.5-jankfix02`。
SYNC_FLUSH 后在同一条流 finish，finally 释放 deflater；不改 index_in_view、View、
时间戳、故障行为或数据内容。Demo Web 和观测云播放器代码都未更改。

### 验证结果

- 对实际原版/补丁 AAR 类执行回归：29 个数据样本，包括上轮 19 个真实上传分段、
  空数据、1024 字节边界、大随机/高压缩数据、中文 JSONL。原版首段截断可复现，
  补丁单段和拼接均完整且无额外流。
- 新版真实购物车六批分段合并后完整解压 **318088 字节**，含确认层；旧版无法完整拼接。
- 97 个应用测试、类型检查、lint、11178 项 resolver 断言、Release 构建和 Replay ABI 通过。
- GCP 真机 15:43:53.809（UTC+08）发生结算 `IllegalStateException`；重启后 RUM 收到同一 run 的
  `java_crash`，不是空闲退出。确认层在设备上真实显示，重启恢复正常。
- [新版闪退回放](https://console.guance.com/rum/sessionReplay?app_id=mall_app_android&session_id=b06ec3260caf4d4ea7a46f168462fc73&ts=1789544490109&w=WORKSPACE_ID&lak=Rum)：
  **00:02:05 已实播看到“触发结算闪退？”、“确认闪退”和“取消”**，底层购物车也是滚动后的画面。
  00:01:58 为结算操作，00:02:21 为确认与真实 Crash；确认后弹层关闭，结束帧回到购物车属于实际行为。
  run `fault-mu3sl3jx-8n5jo4ah`，View `25511ab986fb472aa2d25b45dd4dfdf6`。
- 同版本另录白屏与持续加载，设备触发/恢复正常，RUM 分别收到真实 TypeError 和 ContentNotReady。
  对应 session `b78fbf5324214cf3b3f3b7d72620cef7`，起点 `1789544660096`。
  云端实播 00:01:00 为白屏；暂停定位 00:01:31 已恢复完整商品详情。
  00:02:27 显示“正在加载图书内容…”并对应 00:02:25 ContentNotReady；
  00:02:58 加载提示消失、完整详情恢复且出现“已恢复基线”。
  白屏 run `fault-mu3sph33-wzo91iow`，View `ec4c8fc463964161bed3b14f6867fc47`；
  持续加载 run `fault-mu3sr7gm-l0ag1d54`，View `5d60534fdfea4b9a810bbfb023959db5`。

### 发布与历史数据边界

发布目录 `/home/cherry/mall-demo-web/releases/android-replay-compression-20260916`，
backup 保留 2.3.21 APK、旧 compose overlay 路径。覆盖安装保留应用数据；Web 镜像未变，
仅更新 APK 版本元数据并重建 Order 容器。视频、模拟器、App 启动服务和其他容器健康。
本地、已安装、服务源和公开下载 APK SHA256 一致：
`cc29ba4e9e64cfd632f8a474c04250b61874c2e7f55e256e583b2628ed4a71e5`。
匹配符号包 SHA256：`107a106c3e87a0e5466cd411adb50766d09884622511ca2a6f6b1e0b88a9c5b6`，未上传。

修复作用于 **2.3.22 新采集的会话**；旧会话已上传的错误压缩数据不会因更新 APK 自动修复。
本轮证据位于忽略目录 `owl-reports/android-replay-alignment-20260916/2.3.22/`；
含敏感请求头的原始抓包仅留在临时目录，不入库。

## 官方 alpha03 基线升级：2.3.23 / code16

按用户要求采用官方 Maven `ft-session-replay:0.1.9-alpha03` 加本地永久 ID
遍历优化，坐标 `0.1.9-alpha03-jankfix01`。Agent 保持 `1.7.5-jankfix02`，
现有 RN 样式/裁剪与业务 View 生命周期修复保留。压缩类不再替换，
本轮未修改 Web 代码。发布输入 AAR/source/POM 均固定 SHA，构建白名单
只允许 Replay PermanentIdResolver 与 SnapshotProducer 两类变化。

- 29 个压缩样本（含19个真实旧上传包）通过；官方 alpha03 与本地补丁输出逐字节一致。
- 11178 resolver断言、97应用测试、类型检查、lint、Release 和 Replay ABI通过。
- GCP安装/服务源/公开下载APK SHA一致：`90f7817ca3fde2fbeca000432e97f47aa88b193a27ccd06f9f0a9e6ea097c1f6`。
- 匹配Hermes/R8符号包：`99b805bde89c1ca49520c04f499b727a45be30cbac7ea3172af6faddad025739`，仅本地保存。
- 发布目录 `/home/cherry/mall-demo-web/releases/android-replay-alpha-20260916`，备份2.3.22 APK和旧overlay；服务健康。
- 16:09–16:13（UTC+08）设备白屏、持续加载、恢复和闪退确认层均实际可见；确认后退出，重启回报recovered。
- 新会话 `57c528ec5d5149f594497a915131092a`；白屏run `fault-mu3tl9cr-mnktalkm`、持续加载run `fault-mu3tmg6i-haokspcd`、闪退run `fault-mu3todzf-304hd82l`。
- 原始查询证据保存在忽略目录 `owl-reports/android-replay-alpha-20260916/`；会话聚合及云端播放验收继续补充。

### alpha03 云端复核与第二轮抓包

首轮云端暂停定位验证：00:00:22白屏，00:00:43恢复完整详情；
00:01:54持续加载，00:02:10恢复详情。16:13:16.713的SDK java_crash
与设备原生Fatal/prepareCheckout一致。但首轮查询的Replay只到购物车滚动，
确认层尚未查到，不将该轮尾帧列为通过，也未凭此断言alpha03回归。

第二轮run `fault-mu3txq12-2nhdsz8g`，session `f15e19698d114a7ebd869f8a785f7923`，
cart View `5e0782d59be64d53afc53d7761b8e44a`。抓包确认
`1789546802842–1789546803064`分段含“触发结算闪退？”，
`1789546822450–1789546822458`为确认触摸尾段，两段均在云端session_replay查到。
16:20:22.495真实java_crash已入库。

第二轮云端最终实播通过：**00:01:00 清晰显示“触发结算闪退？”、确认闪退、取消**，
00:00:53为结算，00:01:13为确认与真实Crash。
[2.3.23 alpha03 确认层回放](https://console.guance.com/rum/sessionReplay?app_id=mall_app_android&session_id=f15e19698d114a7ebd869f8a785f7923&ts=1789546746345&w=WORKSPACE_ID&lak=Rum)。

首轮后续查询也已查到1789546379825确认层批次与1789546396667触摸尾段，
因此此前17条分段的查询结果不是最终数据。首轮提前打开的播放器仍有旧画面，
未进一步确定索引、附件或缓存的具体延迟来源；第二轮在全部分段与会话就绪后打开，
实际播放完整，不把“已上传”直接作为验收依据。

### 2.3.24 居中加载蒙版发布
- GCP 覆盖安装 2.3.24/code17，沿用当前 Web 镜像与配置，仅更新 APK 版本元数据；保留应用数据。
- 本地 APK /服务源/公网下载 SHA256 均为 453c3e36bd01bfaceb5e185df07ec3a49a91cd4fc54ae988f56a5a766121610a。安装版本核实为 2.3.24/code17。
- Release 和 Replay reflection/resource ABI 检查通过；此前 97 测试、TS/lint 通过，本轮仅递增版本。
- 18:23–18:24 浏览器实际设备验证：run fault-mu3ydk1y-rjm99mx0，详情中心蒙版/转圈/文字可见，关闭故障后蒙版消失、描述恢复，状态 recovered。
- 发布及旧 APK/配置备份：/home/cherry/mall-demo-web/releases/android-loading-overlay-20260916。服务正常。
- 对应符号包保存在 mobile-app/build/releases/2.3.24，未上传；不要复用 2.3.23 符号。此次未复验云端 Replay 播放，设备实况验证不等同云端回放验收。

### 2.3.25 ContentNotReady 堆栈发布（2026-09-17）
- 构建并部署 GCP APK 2.3.25/code18，保留数据、现有 Web 镜像和 SDK 补丁，仅同步 APK 版本元数据。
- Release、Replay reflection/resource ABI、版本和 diff 检查通过；代码变更已通过上一轮 97 测试及 TS/lint。
- 本地/部署源/公网下载 SHA256 一致：17dfdd0189100da5776632a71f560a8a4b3beb4a8d3c5de3c05ba2045d12d0ab；安装版本核实为 2.3.25/code18，相关服务正常。
- 精确同构建完整符号包 mobile-app/build/releases/2.3.25/mall-app-android-demo-2.3.25-sourcemap.zip，含 js/index.android.bundle.map + android/mapping.txt，ZIP 和 sourcesContent 已核对。SHA256 8a329980e1e43ff67a3c2274ef08e43bb97554fe34762e387b07f2515a4b4b80。按官方 React Native 格式由用户上传，环境 demo、版本 2.3.25。
- 发布备份 /home/cherry/mall-demo-web/releases/android-content-stack-20260917/backup。平台新错误堆栈与符号化仍待上传后验收，不宣称旧错误恢复或云端已还原。


## 2.3.26 发布：恢复补丁构建并增加 APK 门禁（2026-09-17）
- 纠正 2.3.24/2.3.25 的发布描述：两版实际退回默认 Replay0.1.8；清单中的 alpha03 不代表最终二进制。已通过 APK 字节码及旧会话 HAR 确认回归。
- 新入口 `mobile-app/scripts/build-android-demo-release.sh` 固定配套 init script，最终 APK 检查要求 alpha03、正确压缩调用和遍历补丁引用。2.3.23 正向通过、2.3.25 负向拒绝；2.3.26 最终构建通过。
- APK 2.3.26/code19 含普通 View 圆点加载指示器及此前 ContentNotReady 堆栈修复；Agent1.7.5-jankfix02 / Replay0.1.9-alpha03-jankfix01。
- 98 应用测试、类型检查、lint、14 压缩样本（含4真实分段）、Release/最终 APK gate通过。
- 本地、GCP宿主、安装base.apk、公网下载 SHA256：`b1528393bb5c7af3e30e91b3079a813a6601cfc2d3248bf446baf33e6681b0ea`。
- 同构建符号ZIP：`mobile-app/build/releases/2.3.26/mall-app-android-demo-2.3.26-sourcemap.zip`，SHA256 `9f742c8b36d052eb84aab2cc9cf72342ae2a1903fe27da0707819e5096c30ec3`，含 android/mapping.txt 与 js/index.android.bundle.map；未上传。
- GCP发布/备份目录：`/home/cherry/mall-demo-web/releases/android-replay-2326-20260917`。保留现有Web镜像，仅更新APK和版本元数据；服务正常，应用数据保留。

### 2.3.26 云端实播验收
- 新会话 `c513bf241d1348de98232a5488c39ed2`，run `fault-mu4z7u9c-25jk5q21`，详情 View `f4cf8d22cbfd46279cd784829a536fd8`。
- 实际设备触发持续加载后关闭故障；云端关闭“跳过不活跃”连续播放并独立定位：00:30 加载蒙版及粉色圆点可见，00:41 恢复事件，00:42 同一详情页蒙版消失并出现“已恢复基线”。恢复不再依赖切换 View。
- RUM 恢复时间 1789616123138，ready 时间 1789616123234；该详情的后续 Replay 批次覆盖至 1789616126854，实际播放器已呈现恢复画面。
- [验收会话](https://console.guance.com/rum/sessionReplay?app_id=mall_app_android&session_id=c513bf241d1348de98232a5488c39ed2&ts=1789616079300&w=WORKSPACE_ID&lak=Rum)。查询证据保存在 `owl-reports/replay-2326/`。
- 本次实播验收覆盖持续加载及恢复；没有重新完整验收白屏和崩溃。新版不会修复旧 APK 已录制的数据；符号包尚未上传，未宣称云端符号化通过。


## Native ANR and freeze demonstrations (implementation, pending runtime acceptance)

The Android catalog now retains blank details, checkout Java crash and content
loading, and adds `android_detail_anr` and `android_detail_freeze`. The Web
workbench reads these entries from the connected APK; no copied Web catalog is
needed. A new APK must be installed before these entries appear.

Build with `-PMALL_DEMO_NATIVE_PERFORMANCE=true` (included in the demo build
wrapper). Ordinary builds disable both entries and reject native calls. After
arming, open a book: the native UI thread blocks for 20 seconds (ANR) or 2 seconds
(freeze), following a 500 ms rendering opportunity. Tap during the ANR stall;
choose Wait if Android offers an ANR dialog. System ANR presentation is device
and OS dependent. The operation is bounded, rejects overlapping native calls,
and supports cancellation when restoring baseline or switching scenarios.

The SDK already enables native crash, ANR and freeze collection, with a 1000 ms
freeze threshold. The demo records only trigger/completion Actions, never a
synthetic standard Error or LongTask. Completion duration proves the injected
stall, not SDK collection. Inspect real Error `anr_error`/`anr_crash` or LongTask
`long_task`, matching View/session and fault_run_id, before marking acceptance.
ANR may also generate LongTask. Replay can pause during main-thread blocking.

Acceptance still required on a newly installed APK: actual SDK event type,
blocking stack, duration, device/OS/version filters, and preceding/recovered
Replay frames. Existing checkout crash demonstrates `java_crash`; C/C++ and JS
fatal crash types are not newly implemented here. Dynamic sampling live changes,
carrier availability and server-side symbolication remain separate unverified
requirements. No runtime deployment or cloud acceptance is implied by tests.


### 2.3.27 GCP deployment (2026-09-18)
- APK 2.3.27/code20 built through the patched release wrapper with native
  performance, checkout crash and remote control enabled. Final APK Replay
  compression/traversal and reflection/resource checks passed.
- Installed using adb install -r, preserving application data. Existing Web
  image retained, APK version metadata updated. Emulator, gateway, video, Caddy
  and order-service checked running.
- Local, host source and public download SHA256:
  `401a35a0eff2fa20ec12110e74f1d826aa274ad0b249430a3cafe06b245b276e`.
- Backup/release: `/home/cherry/mall-demo-web/releases/android-performance-2327-20260918`.
- Browser confirms five Android scenarios, including ANR and native freeze.
  Native freeze run `fault-mu6or4oh-vuiowl9s` armed on injection, triggered by
  opening a book, then reported recovered with normal detail content displayed.
- Same-build symbols: `mobile-app/build/releases/2.3.27/mall-app-android-demo-2.3.27-sourcemap.zip`,
  SHA256 `88aa41f4a63110f51be60dfb9e29f11d9a6d91df106bdcae85279d27f2270d0f`.
  Symbols not uploaded. This deployment smoke test does not prove cloud ANR or
  LongTask ingestion, symbolication or Replay alignment for the new scenarios.
