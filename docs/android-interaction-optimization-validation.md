# Android 交互优化与验证（2026-09-08）

本轮依据 `android-interaction-performance-review.md` 实施交互优化。最终发布版本
为 Safe / DemoFaults 2.3.12（versionCode 5），Safe 已更新到 GCP 演示。RUM 和 Session Replay 保持开启，
SDK 版本及采样配置沿用原有演示配置。

## 实施内容

- 缩小书单和购物车派生数据的状态依赖，稳定页面回调及业务 hook 返回值，
  给首页与书卡增加 memo 边界。回调仍读取最新的购物车和故障状态。
- 保存首页拖动结束和惯性滚动结束时的位置；从详情返回后恢复。搜索、分类、
  排序或语言改变时重置位置。非当前页面仍卸载，不保留隐藏的 Replay 视图树。
- 加购、数量步进、返回、通用按钮、顶部操作、清除搜索和底部导航使用至少
  48 dp 的布局触控区域，避免用重叠的 hitSlop 扩大点击范围。
- 抽屉拖动限制在标题区，并在标题区按下时取得手势；正文和横向层级列表各自
  处理滚动。原有动画中断、关闭来源和减少动态效果行为保留。
- Replay RN 适配层按具体 Class 和字段名称缓存反射 Field 元数据及查找失败结果。
  每次采集仍执行 Field.get，读取当前实例的实时颜色、文字等值。

## 已完成的本地验证

实际 App/HomeScreen/ProductCard 的组件调用诊断结果：

| 操作 | 2.3.10 书卡重绘数 | 优化后书卡重绘数 |
| --- | ---: | ---: |
| 打开故障抽屉 | 6 | 0 |
| 关闭故障抽屉 | 6 | 0 |
| 加入一本书 | 6 | 1 |
| Toast 消失 | 6 | 0 |

这项测试隔离了 SDK、网络和弹层，衡量重复渲染工作，不等同于手机 FPS。
回归还覆盖已缓存回调读取当前购物车、启用故障后点击旧书卡、详情返回的位置
恢复及搜索后位置重置。

- 17 个测试套件、83 项移动端测试通过；六个业务故障的触发、恢复、取消、重试
  和结算保护仍通过。
- TypeScript、ESLint、规范数据同步检查通过。
- JDK 17 执行真实 ReflectionUtils 的验证：字段值修改、继承私有字段、不同
  实例、不同类、缺失字段，以及重复查找的元数据复用均通过。
- SDK 补丁可反向校验；发布 APK 的反射字段和 Replay 上传 ABI 检查通过。

## 模拟器验证记录

环境为既有 GCP Android Emulator，720 × 1600。2.3.11 中间构建已确认：
购物车数据保留，首页下滑后打开《实施服务级别目标》再返回，保持原书单位置；
横向滑动故障层级时抽屉位置不变；正常详情加载无 Native/JS 致命错误。
短拖动收起问题在该轮发现并纳入 2.3.12 修正；最终版本的标题区右拖及关闭按钮
均已复测，可正常收起。
最终 2.3.12 还复测了书单中段打开《实施服务级别目标》再返回，SLO/SRE 两排
图书保留在相同位置；图书内容正常加载。

2.3.12 的业务回归已确认详情真实报错后重试恢复、加购故障连续点击不增加数量且
恢复后可正常添加。购物车故障中，数量由 3 本增加到 4 本，行金额更新而合计仍为
¥247；点击重新计算后恢复为 ¥346，结算按钮恢复可用。结算预览阻塞后能正常
显示明细并返回购物车；原生耗时以 RUM 入库记录为准。

播放器出现视频恢复/截图回退及断连，相关浏览器回显延迟不作为原生性能结果。
优化前的短滚动窗口仅 30 帧，p50 44ms、p90/p95 150ms，样本不足且为软件图形
模拟器。当前没有足量、稳定的同条件帧数据支持“已达到 60 FPS”或真机提速百分比。
本轮确认减少了重复渲染和改善了具体交互；持续滚动的主要线程耗时仍需真机采样。

## 发布和符号包

2.3.12 的 Safe/DemoFaults 分别使用同一次 Gradle 构建生成的 Hermes SourceMap
及各自的 R8 mapping。ZIP 内路径为 `js/index.android.bundle.map` 和
`android/mapping.txt`。具体校验值见 `mobile-app/build/releases/2.3.12/manifest.json`。
SourceMap 按用户要求由用户上传；应用/环境/版本为
`mall_app_android / demo / 2.3.12`。

GCP 于 2026-09-08 08:01 UTC 使用 `adb install -r` 更新到 versionCode 5，保留
应用数据。安装源、运行目录和下载目录 APK 校验值一致，Safe APK SHA-256 为
`94e64ecba02962342de6e9a8f4dcc7fb55b48db8e24a38bfa2d6df413eaafb39`。
更新前 APK 备份位于主机 `/opt/mall-demo-webrtc/backups/interaction-20260908T080135Z`；
原始优化前 2.3.10 另保留在 `interaction-20260908T075011Z`。下载地址
`https://35.241.68.75.nip.io/downloads/mall-demo-safe.apk` 返回 200、53,004,213 字节。
同时修正 Caddy 下载文件名不随旧版本滞留的问题，配置校验与平滑 reload 通过。

后续修正“获取 APK”面板遗留的 2.3.9 文案：HTML 默认值及中英文翻译均更新为
`v2.3.12 · Android 7.0+`，并更新翻译资源缓存标识。GCP 仅重建 order-service，
页面和镜像备份保存在 `apk-download-version-20260908T084614Z`；浏览器中英文
面板已实际打开核对，下载链接仍指向同一 2.3.12 APK。33 项 order-service 测试
及内联脚本解析通过。APK 与对应 SourceMap 未重新构建。

## 六场景 RUM 验证

按 `app_id=mall_app_android`、`version=2.3.12` 查询并校验 DQL，原始结果及汇总保留在
`owl-reports/android-interaction-2.3.12-20260908/`。同一事件的分片字段按时间合并后
检查；下列六个 run 均有 armed、triggered、recovered 事件，以及
`session_has_replay=1` 的关联事件。

| 场景 | fault_run_id | 实测证据 |
| --- | --- | --- |
| 详情渲染失败 | `fault-mtsdv2pn-d8gbz8pu` | 真实 `trim` 异常；重试恢复。精确 Hermes map 将 bundle 地址还原到 DetailScreen 第 42 行和 DetailFaultBoundary 第 17 行。 |
| 加购无反馈 | `fault-mtse2jlh-njxrgv4b` | `cart_update_missing`；恢复后 `cart_update_succeeded`，购物车数量增加。 |
| 购物车金额未更新 | `fault-mtsecz4d-osgam9dm` | `cart_total_mismatch`；重新计算后 ¥247 恢复到 ¥346。 |
| 结算预览卡顿 | `fault-mtsegq1w-c6oey57o` | 原生 Long Task 1,800,363,419 ns，带 SDK 实际 Handler 记录；自动恢复并能关闭预览。 |
| 图书内容加载慢 | `fault-mtsej6gb-xavf2fd6` | slow 请求 200、4,793,161,707 ns；恢复后的 normal 请求 200、15,481,866 ns。 |
| 请求超时与重试 | `fault-mtsenyw4-j5nl4ajl` | timeout 请求 2,004,126,529 ns 后取消（status 0），真实 `IOException: Canceled` 和 `BookContentDeadlineError`；重试 normal 返回 200、26,047,171 ns。 |

超时页面显示重新加载入口，重试后错误提示消失、完整内容恢复。验证结束时已恢复
原购物车两本《可观测性工程》、总额 ¥198；没有下单或清空应用数据。最终
`AndroidRuntime:E` 日志查询无输出。

## 实际 Replay 检查

打开会话 `215f3273160847bab57544750cfbd82c` 的真实回放，刷新获取本轮新增片段。
播放并定位到 00:17:34 可见 4 本、合计 ¥247；恢复后的片段显示 ¥346。
00:19:45 能看到结算明细弹层，其中两种图书分别为 3 本/¥297 和 1 本/¥49，
合计 ¥346，返回按钮、图书图标及背景颜色均可见。数据与实际操作一致，验证了
反射元数据缓存没有把本轮金额、文字和视图变化冻结。此检查不代表 SDK 所有
视图类型的兼容性已穷尽验证。

测试标签页已关闭，并恢复用户原浏览器页面。代码和文档保留在当前工作区，
按任务范围没有提交或推送 Git，也没有上传 SourceMap。

## 2.3.13 加购通知书名修正（2026-09-10）

加购成功通知使用的 `added` 文案含 `{title}` 占位符，调用时漏传该参数，导致
中文标题显示为 `《》已加入购物车`。现传入当前语言的图书标题；现有 App 流程
回归覆盖中文 `《分布式系统可观测性》已加入购物车` 及对应英文标题，同时保留
购物车、故障和渲染次数断言。18 个测试套件共 87 项移动端测试、TypeScript、
ESLint、规范数据同步检查、33 项 order-service 测试和两段内联脚本解析均通过。

Safe/DemoFaults 2.3.13（versionCode 6）已构建，两种 APK 均通过 Replay 反射和
上传 ABI 检查。发布包及同次构建的 Hermes/R8 符号位于
`mobile-app/build/releases/2.3.13/`，校验值记录于该目录的 `manifest.json`。
Safe APK SHA-256：`7133b0ae26b0b12e6af248f3820671c86d7708222073a77ff41a083321794b08`。
Safe SourceMap ZIP SHA-256：`36d9ae1b05c50fd4dc8c50966226dd8ef784700162bc854553285c7bda597f32`。
符号包仍由用户上传，应用/环境/版本为 `mall_app_android / demo / 2.3.13`。

GCP 于 04:05 UTC 保留数据安装新版；安装目录和下载目录 APK 校验值一致。
旧 APK 备份位于 `/opt/mall-demo-webrtc/backups/add-cart-title-20260910T040553Z`。
下载面板的 HTML 默认值、中英文文案及资源缓存标识同步更新，仅重建
order-service；源文件和镜像备份位于
`/opt/mall-demo-webrtc/backups/apk-download-title-version-20260910T040611Z`。
公开下载返回 200、53,004,393 字节，中英文面板均实际打开确认 `v2.3.13`。

在前台浏览器的实际 Android 画面中点击已加入的图书，捕获到包含完整书名的
成功通知，副标题显示共 1 册，原购物车仍为 1 本。播放器曾断连；重新连接并
切到前台后完成此次视觉验证，不把视频回显延迟用于评估原生性能。验证页已
关闭并恢复原会话重放标签页。本次未更改正式 SDK 依赖、提交 Git 或上传符号包。
