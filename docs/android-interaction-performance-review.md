# Android 交互性能检查（2026-09-08）

检查对象为 Safe Release 2.3.10（versionCode 3）、React Native 0.86、RN RUM/Replay 0.4.2、原生 ft-sdk 1.7.5 / ft-session-replay 0.1.8。结论：应用代码存在明确的交互优化空间；持续滚动卡顿的主要耗时尚未完成归因，不能仅凭源码把它归咎于 React 重渲染或 Replay。

本轮完成源码审查、实际模拟器操作和 React 组件诊断，没有修改应用源码或替换 APK。

## 已确认的问题

### 1. 无关状态变化会重渲染整个书单

`App.tsx:158` 的 products、购物车派生数据都依赖整个 `state`。HomeScreen、ProductCard 没有 memo 边界，传给页面和书卡的回调又在每次 render 时重新创建。`useBookContent`、`useBusinessFaults` 返回对象也没有稳定引用，被多个 useCallback 当作依赖，进一步使这些回调失效。

一次性诊断使用实际 App、HomeScreen、ProductCard，隔离 SDK、网络和弹层，记录组件调用次数：

| 操作 | ProductCard 重新渲染数量 |
| --- | ---: |
| 打开故障抽屉 | 6 / 6 |
| 关闭故障抽屉 | 6 / 6 |
| 加入一本书 | 6 / 6 |
| Toast 消失 | 6 / 6 |

这是重复工作的实测证据，不是手机耗时或 FPS 测试。它会增加点击、弹层、购物车变化时的 JS 工作；首页没有每帧 setState 的 onScroll，因此不能用它单独解释稳定滚动时的全部卡顿。

建议缩小派生数据依赖、稳定 hook 方法及页面回调，为书卡和静态页面区块设置 memo 边界，让一次购物车变化主要更新对应书卡与角标。应先处理引用稳定性，再加 memo。

### 2. 页面切换重建首页，返回后丢失滚动位置

`App.tsx:839` 通过条件渲染切换页面。打开详情时 HomeScreen 被卸载，返回后创建新实例；HomeScreen 没有保存和恢复滚动偏移。组件诊断确认详情期间首页实例不存在、返回后实例不同。

用户浏览到书单下方，查看一本书再返回，需要重新滚动；同时触发整个首页的重新挂载。建议保存列表位置及必要页面状态，或采用保留页面实例的导航方式。避免为了保留状态让多个不可见页面继续参与 Replay 采集。

### 3. 多个触控区域过小

`Commerce.tsx:214` 的加购按钮为 26×26dp，数量步进按钮宽 28dp；`DetailScreen.tsx:275` 的返回按钮高 28dp；`AppButton.tsx:84` 的 compact 按钮最低 30dp。这些控件没有统一的触控区域扩展。

手机上漏点会被感知为“不响应”，需要和真正的线程卡顿区分。建议在布局容得下的位置提供至少 48×48dp 的触控区域，并保留清楚的按下反馈。不能只增加 hitSlop 而让邻近按钮触控范围重叠。[Android 官方触控目标建议](https://developer.android.com/guide/topics/ui/accessibility/apps)

## 需要进一步量化的路径

### Replay 在 UI 线程采集视图

`observability.ts:133` 开启 Replay；当前演示配置为全量会话。核对本机实际 0.1.8 AAR 字节码，Debouncer 使用主线程 Handler，阈值与延迟均为 64ms。官方实现的 `WindowsOnDrawListener` 触发 `SnapshotProducer`，在 UI 线程遍历、映射视图，然后再交给后续队列处理。

RN 适配层 `ReflectionUtils.java:30` 每次查询都枚举 declared fields，必要时递归父类，没有字段缓存。项目 RN 0.86 补丁还会通过这条路径读取背景色、圆角。它是具体的优化候选，但本轮没有取得有效方法耗时分布，也没有完成 Replay 开关对照，不能宣称 Replay 已被证实为首要根因。

下一步应使用相同 Release 配置做“保留 RUM、完全不初始化 Replay”的诊断对照，再测正常配置；如果只把 replay sampleRate 改为 0，同时保留 on-error 采样，仍可能有错误前缓冲采集，不能当作关闭 Replay 的对照。正式演示仍需验收 Replay、Error、Resource、LongTask 的完整性。

[官方 SDK 源码（本轮读取的提交）](https://github.com/GuanceCloud/datakit-android/tree/0c33d1c9c92b22f295ea44c1086d6543359f0bc3/ft-session-replay/src/main/java/com/ft/sdk/sessionreplay/internal/recorder)、[Replay 配置文档](https://docs.guance.com/en/real-user-monitoring/session-replay/mobile/android/)

### 首页视图数量、绘制与手势

`HomeScreen.tsx:73` 的 ScrollView 一次挂载全部六本书，书卡、文字与装饰封面形成多个原生节点。可以精简装饰节点、评估裁剪或虚拟列表；当前只有六本书，换 FlatList 的收益需要测量，不能预设它能解决主要卡顿。[React Native ScrollView 文档](https://reactnative.dev/docs/scrollview)

抽屉 `FaultDrawer.tsx:293` 的拖动使用 JS PanResponder，onMove 调用 Animated.Value.setValue；原生驱动只用于松手后的 spring/timing。处理器挂在整个抽屉上，同时内部有横向层级栏，存在手势竞争的可能。建议限制拖动区域并验收横向层级切换，或采用在 UI 线程运行且有明确竞争规则的手势处理。

普通页面之间目前直接替换内容，没有连贯的页面过渡。优先解决挂载成本与状态保留，再补充转场，避免用动画掩盖卡顿。

## 模拟器验证与边界

在 GCP 真实 APK 场景实际执行了故障恢复、抽屉关闭、首页向上及向下拖动，画面确认了书单位置变化。期间 WebRTC 两次断开，已剔除断开期间操作；浏览器回显延迟不作为原生帧耗时。

早期累计数据混有之前的故障与操作，不能作为正常滚动基准。关闭本轮分析器并重置统计后，一个有效短窗口采到 9 帧：p50 27ms、p90/p95 57ms，8 帧未赶上系统帧截止时间，8 次 slow issue draw commands。样本过少，不能据此报告稳定卡顿率或推断实体手机同样的分位数。模拟器的软件图形路径也与手机 GPU 不同。

60Hz 的帧预算约为 16.67ms；ScrollView 的滚动本身运行在原生主线程，所以仍需检查 UI/RenderThread，不能只优化 JS。[React Native 性能说明](https://reactnative.dev/docs/performance)

方法采样尝试产生了空文件，未形成可用调用栈证据；采样已停止。日志中出现 Invalid resource ID，但系统 view tracing 本身也可能触发动态 RN ID 查询，因此本轮不把该日志归因于 Replay 或当作根因。

本机未取得实体手机的性能采样。本轮没有完成“优化前后”对比，也没有发布新版本。

## 建议实施顺序

1. 减少无关重渲染；保留首页滚动位置；修正触控目标与抽屉手势范围。
2. 在相同设备、相同手势、相同 Release 配置下做 Replay 开关诊断，量化 UI 线程、RenderThread 与采集开销，决定是否缓存反射或调整视图结构。
3. 检查详情加载过程的布局跳动、页面转场与快速连续操作，再交付 APK 和对应版本的 SourceMap。

验收同时覆盖正常首页滚动、分类切换、详情返回、购物车加减、抽屉拖动，以及既有六个 RUM 故障场景。每组应采集足量帧并重复测量，分别记录原生帧耗时和 WebRTC 端到端延迟。
