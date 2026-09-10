# Android 六个业务故障场景：实现与验收

## 版本与范围

2026-09-08 在 GCP `mall-demo-kvm-emulator-poc`（项目 `twt-gcp-integration`，
区域 `asia-east2-a`）部署 Android Safe APK **2.3.10 / versionCode 3**。
入口：<https://35.241.68.75.nip.io/business.html?lang=zh&scene=android-storefront&view=mobile>。

APK SHA-256：
`69c8aa9dec3758b39f9a4c166c24a1f8f29187e7208aa8c4e396a42be077f101`。
远程设备安装包、`/opt/mall-demo-webrtc/app-safe-release.apk` 和下载目录文件一致。
数据库与购物车数据保留；未发布到 `demo.dataflux.cn`，未提交或推送仓库。

本次新增 Android 前端体验、运行时、网络请求六个场景，后端服务、依赖和 JVM
层的目录及行为保留。Native Crash / ANR 的旧有变体限制保持不变。

## 演示操作与恢复

先在 APK 顶部故障入口选择并启用场景，再回到业务页面操作。每轮生成
`fault_run_id`，记录 armed、triggered、recovered；恢复后仍可打开本轮 RUM 视图。

| 场景 | 触发操作 | 实际故障 | 恢复 |
| --- | --- | --- | --- |
| 商品详情渲染失败 | 打开任意图书 | 详情组件处理缺失描述时抛出真实 TypeError，错误边界展示可重试区域 | 重新加载详情，或恢复基线 |
| 加购无反馈 | 点击图书加购，可连续尝试 | 不修改购物车，也不显示成功反馈；记录预期和实际业务状态 | 恢复基线后重新加购 |
| 购物车金额未更新 | 增加已选图书数量 | 数量更新、展示金额保留旧值；单次和批量下单均被阻止 | 重新计算合计，或恢复基线 |
| 结算预览卡顿 | 购物车点击“查看结算明细” | 原生 UI 线程固定阻塞约 1.8 秒，展示普通 View 结算预览 | 阻塞结束自动恢复，15 秒冷却 |
| 图书内容加载慢 | 打开图书 | 真实内容接口延迟 3.5 秒，等待时显示加载反馈 | 请求成功后显示内容，或恢复基线 |
| 请求超时与重试 | 打开图书，等待超时 | 服务器延迟 5 秒，客户端 2 秒截止并真实取消请求 | 点击重新加载，第二次请求改用正常模式 |

内容来自与 Web 相同的受控书目数据。`GET /api/demo/mobile/book-content` 仅允许
固定书目、语言和 `normal|slow|timeout` 模式；未知参数/模式返回 400，未知书目
返回 404，禁止任意延迟、任意目标与写操作。离开详情会取消请求，并丢弃过期响应。

## 自动化验证

- 移动端 81 个测试通过；TypeScript、ESLint 和 canonical storefront 同步检查通过。
- 后端受影响模块共 41 个 Maven 测试通过（order 33，gateway 8）。
- Safe 与 DemoFaults Release 构建成功，Replay 反射及 ABI 产物检查通过。
- 目录保护回归核对原有 13 个 Web、服务端与高级原生场景；末三层没有改变。
- Root flow 测试覆盖详情真实异常/恢复、重复加购、错误金额阻止单次/批量下单、
  原生桥调用、慢加载、超时重试、离开页面取消与旧响应保护。
- `git diff --check` 通过。

## 真实 APK 与 RUM 证据

观测空间：`<workspace-id>`，应用：`mall_app_android`，
环境：`demo`，版本：`2.3.10`。验收使用 GCP 720 × 1600 Android Emulator。
数据通过 Owl 的 `owl.data.query` 查询，DQL 均先由 `owl.data.check_dql` 验证。
原始查询、绝对起止时间及返回值保存于
`owl-reports/android-rum-business-faults-20260908/`，只有内部 `success=true`
且存在目标记录才计为入库成功。

| 场景 | 本轮标识 | 已核对证据 |
| --- | --- | --- |
| 详情渲染失败 | `fault-mts4uzhn-ovb141jr` | 真机显示错误区域；重新加载后恢复；RUM Error 为 `Cannot read property 'trim' of undefined`，带真实 bundle 堆栈及本轮标识 |
| 加购无反馈 | `fault-mts55wpf-b7fthbfc` | 连续两次加购，购物车仍为空；RUM 有两次 `cart_update_missing`；恢复后正常加购成功 |
| 金额未更新 | `fault-mts5gycs-mj7plybn` | 数量 2 册，显示 ¥99；下单禁用；重新计算恢复 ¥198；Action 记录 `expected_amount_cent=19800`、`displayed_amount_cent=9900` |
| 结算预览卡顿 | `fault-mts5kqnp-ayfai7i4` | 实际 Long Task 为 1,800,351,739 ns；出现结算明细并自动恢复；关联触发、完成和恢复 Action |
| 内容加载慢 | `fault-mts5rd8l-yxjngzwn` | SDK Resource 请求 `mode=slow`，HTTP 200，实际总耗时 4.575 秒；Action 有同轮 attempt=1 开始和成功记录 |
| 超时与重试 | `fault-mts5v6yo-s8j4ah9q` | 首次 `mode=timeout` Resource 在 2.010 秒结束、status=0；UI 显示加载失败；重试 `attempt=2 / mode=normal` 返回 200、耗时 24.8 ms，UI 恢复内容 |

上述故障记录包含 `session_has_replay=1`，可按同一 `session_id` 查找回放。
已实际打开并播放结算卡顿视图的会话回放，界面内容、控件、故障抽屉和事件时间线可见。
RUM 视图入口使用控制台真实支持的 `appIds` 参数和
`fault_run_id` 筛选，不用无效的 `app_id` 应用筛选参数。
实测按卡顿轮次筛选返回 15 个相关 View，视图详情的事件瀑布图包含
“查看结算明细”点击、1.80 秒 Long Task、完成和恢复事件。

播放器验收地址：
<https://console.guance.com/rum/sessionReplay?app_id=mall_app_android&view_id=5842f4ef747b4c0d983c670ccb5a468d&session_id=2e09838b3b94461cbd6578fb134d7f7a&ts=1788840716952&w=<workspace-id>&lak=Rum>。

SDK 归属限制：快速从慢加载切换到超时时，一条 `switch_scenario` 恢复 Action
被归入新轮次的全局上下文。这提示 SDK 异步处理与全局上下文切换存在归属窗口
（推断）；分析跨场景切换应对照事件时间、名称及业务属性，不将 View 数量当作
故障次数。六个场景的核心 Error / Resource / Long Task 与对应业务结果已逐项核对。
本次查询接口的 `*` 结果有按字段拆分、共享时间戳的行；原始文件保留这些行，
不能把返回数组长度直接当作事件数。

## SourceMap

本地 `mobile-app/build/releases/2.3.10/safe-sourcemap.zip`（约 2.5 MB）包含
本次 Safe Gradle/Hermes 构建的 `js/index.android.bundle.map` 与
`android/mapping.txt`。SHA-256：
`3970278c8ee10db22cab51ab8473f642ab0f3a7cc6c2bdbbcf0b275ca892f732`。
DemoFaults 对应包单独保存，不能覆盖 Safe 版本的映射。

本地使用 SourceMapConsumer 实证：Error 中 bundle `1:466077` 可定位到
`src/screens/DetailScreen.tsx:41`，`1:716863` 可定位到
`src/components/DetailFaultBoundary.tsx:17`。
`book_detail_render_failed` Action 保留的原始 `js_stack` 中 `1:466204` 则定位到
真正抛出异常的 `DetailScreen.tsx:57`。SDK Error 的 `error_stack` 是 React
组件堆栈，分析时应与该原始 JS 堆栈配合使用。
原生 Long Task 的 `long_task_stack` 当前为 Handler/Runnable 摘要，R8 mapping
将其中 `n2.a` 还原为 `DemoFaultsModule$$ExternalSyntheticLambda0`；不把它宣称为
包含完整调用帧的采样堆栈。

控制台上传待用户明确授权：自动审批审查阻止选择该源码映射包，要求授权这份
包含源码的具体文件向观测云传输。未通过其他路径上传。目标配置已准备为
`mall_app_android / demo / 2.3.10`。

## 部署配置修复与回滚

GCP 原有 RUM 代理指向未运行的本机 DataKit，导致 SDK 上报返回 500。
Compose 原先写死 `DATAKIT_RUM_URL`，`.env` 覆盖不生效。本次使配置可覆盖，
并继续使用旧 APK 已有的 RUM 接收目的地，经 GCP 代理转发；未修改接收端。
修复后已确认新版 RUM View、Error、Action、Resource、Long Task 入库。

回滚备份：`/opt/mall-demo-webrtc/backups/rum-business-20260908T034303Z`；
旧服务镜像标签：`rum-business-rollback-20260908T034303Z`。
Compose 另备份为
`/home/cherry/mall-demo-web/compose.yaml.rum-business-backup-20260908T035653Z`。
回滚时恢复备份 `.env`、受影响源码和 Compose，使用旧 order/gateway 镜像，
将备份 APK 通过 `adb install -r -d` 安装并恢复两个下载文件。启动 Activity 为
`com.malldemomobile.safe/com.malldemomobile.MainActivity`；不清除 App 数据或数据库卷。
初次部署因 Activity 名称校验失败触发过自动完整回滚，随后使用正确 Activity
重新部署成功。

GCP 服务端原有 APM DataKit 未运行，此次没有把后端 Trace 查询成功列为验收结论。
慢/超时场景以真实接口、SDK Resource 与业务 Action 为证据；后端采集配置可单独完善。
