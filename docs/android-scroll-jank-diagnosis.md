# Android 真机滑动掉帧归因（2026-09-10）

## 结论

小米 14 上 Safe Release 2.3.12 的正常首页滚动长帧，主要来自 Session Replay
采集时调用基础 SDK `FTViewPermanentIdResolver` 解析控件稳定 ID。方法采样定位到
资源名称查询和 `Resources.NotFoundException` 构造；关闭 Replay 初始化、保留
基础 RUM 的同条件对照消除了本次样本中的周期性长帧。

本轮交付的是可采样诊断构建及归因验证，尚未修改 SDK 热点实现。正式构建默认仍
开启既有 Replay；诊断关闭不能当作保留回放能力的性能修复。

## 构建与安装

- 手机：Xiaomi 14 / 23127PN0CC，Android 16，1200×2670，系统配置最高 120Hz。
- 原 APK：Safe 2.3.12 / versionCode 5，SHA-256
  `94e64ecba02962342de6e9a8f4dcc7fb55b48db8e24a38bfa2d6df413eaafb39`。
- Gradle `MALL_DEMO_PROFILEABLE=true` 开启 manifest shell profiling，仍然
  `debuggable=false`，保留 Hermes、R8、签名、版本及原 GCP Gateway。
- 对照包额外指定 `MALL_DEMO_DISABLE_REPLAY=true`；完全跳过
  `sessionReplayConfig`，未更改 RUM/Log/Trace 配置或错误采样率。
- 两包内 Hermes bundle SHA-256 一致：
  `d44dc344ee29ed9ebbd000ba16f43b4346530ede8cf9e0d8b349683ef5895069`。
- 同次构建的 APK、Hermes map、R8 mapping 和校验值分别保存于
  `mobile-app/build/diagnostics/scroll-jank/replay-on/`、`replay-off/`；
  `original.apk` 为从手机拉取的安装前备份。
- 使用 `adb install -r` 保留应用数据；未下单、清空购物车或替换网站下载文件。

## 无方法采样时的三轮对照

每轮约 30 秒、38 次往返滑动，坐标 (600,900) ↔ (600,2100)，每次 700ms。
录制方法调用和测量帧耗时分开进行，以下数据均来自不运行方法采样的窗口。

| 配置 | 三轮 P95 帧耗时 | 三轮 P99 帧耗时 | GPU P95 |
| --- | --- | --- | --- |
| 原包（上一轮） | 69 / 61 / 69ms | 81 / 77 / 77ms | 3ms |
| 可采样 Release，Replay 开启 | 69 / 65 / 69ms | 77 / 77 / 77ms | 3ms |
| 同配置，Replay 不初始化 | 6 / 6 / 6ms | 7 / 7 / 7ms | 3ms |

`gfxinfo` 现代 jank 和 legacy 计数在此系统存在明显差异，不混用百分比，也不将
1000/P95 当作平均 FPS。独立 Perfetto 12 秒窗口使用 FrameTimeline 复核：

| 配置 | 应用帧数 | App Deadline Missed | 主线程 draw-VRI 最大耗时 |
| --- | ---: | ---: | ---: |
| Replay 开启 | 573 | 68（11.87%） | 82.009ms |
| Replay 不初始化 | 1253 | 0 | 1.557ms |

开启组另有 42 帧 Buffer Stuffing；关闭组均为 None。两组轨迹均保留完整约 12 秒，
未使用之前环形缓冲只保留尾部的窗口混算结果。系统温度状态记录为 0；结论限定于
此设备、版本与首页路径，不能外推所有机型或所有 SDK 功能。

恢复 Replay 开启的采样包后，再测 30 秒：P95 73ms、P99 81ms，长帧再次出现。
已核对手机安装 APK 与保存的 replay-on/app.apk SHA-256 一致；采样已停止，
最终保留 Replay 开启、允许本地采样的版本，页面恢复到首页顶部。

## 方法级热点

Release 的 shell 采样权限已实际生效，`am profile start --sampling 1000`
成功，停止后取得约 2.67MB ART trace。完整主线程调用链包含：

```text
ViewRootImpl.draw
  ViewTreeObserver.dispatchOnDraw
    WindowsOnDrawListener.onDraw
      Debouncer.executeRunnable
        SnapshotProducer.produce / convertViewToNode
          TreeViewTraversal.attachPermanentId
            PermanentIdResolver.resolve
              SessionReplayManager.resolvePermanentId
                FTViewPermanentIdResolver.resolve / resolvePath
                  resolveViewSegment / resolveResourceName
                    Resources.getResourceName
                      ResourcesImpl.getResourceName
                        Resources.NotFoundException.<init>
                          Throwable.fillInStackTrace
```

SDK 字节码确认 `resolveResourceName` 仅先排除 View.NO_ID，其他 ID 会进入
`getResourceName`，找不到时捕获异常返回 null。解析每个控件路径还会访问其祖先，
因而同一批视图资源名称被反复查询。该热点位于 `ft-sdk:1.7.5`，由
`ft-session-replay:0.1.8` 的快照采集高频调用；它与此前 RN 背景字段反射缓存
属于不同路径。

在本方法样本的相对累计权重中，稳定 ID 解析约占 SnapshotProducer.produce 的
88%；资源名称查询约占 70%。这是包含子调用的统计，不可相加，也不使用递归
convertViewToNode 的累计值计算百分比。此设备 ART 文件的时间单位字段与实际
录制时长不一致，因此方法 trace 只用于调用链和相对权重，绝对毫秒以系统
Perfetto/gfxinfo 为准。采样产生的调用段数量不等同于真实调用或异常总数。

## 回归和后续

- 18 suites / 87 tests、TypeScript、ESLint 通过。
- Replay 字段缓存验证、Release APK 反射和资源回调 ABI 检查通过。
- 未传诊断参数时 merged manifest 的 shell=false；只传关闭 Replay 参数时
  Gradle 按预期拒绝，避免误关闭正式采集。
- A/B 覆盖 Android 代理/直连配置、iOS 不受影响、RUM/Log/Trace 保留及初始化幂等。
- 本轮没有改 Replay 视图映射/隐私/SDK 版本；不宣称已验证所有回放场景或解决热点。

后续修复应优先减少动态视图 ID 的无效资源名查询、避免异常作为高频正常分支，
并评估单次快照内的祖先路径复用。不得永久缓存控件路径或实例值而冻结动态界面、
破坏回放关联；需在保持 Replay 开启的条件下再次测量和验证实际回放。

原始证据保存在本地任务目录 `.trellis/tasks/09-10-android-scroll-jank/evidence/`：
`method-replay-on.trace`、`not-found-stack.txt`、`method-hotspot.txt`、
`permanent-id-bytecode.txt`、`profile-on/off-*.txt` 和对应 Perfetto 文件。
ART 停止录制后会异步写盘，应等待文件非空且稳定后拉取，不能立即将空文件当成
“不支持采样”。[Perfetto ART 支持说明](https://perfetto.dev/docs/getting-started/other-formats)
