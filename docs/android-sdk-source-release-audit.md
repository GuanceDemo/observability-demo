# Android SDK 开源代码与官方发布包核对

核对日期：2026-09-10。范围为本次掉帧排查涉及的 Android 基础 SDK `ft-sdk` 和回放 SDK `ft-session-replay`。

## 结论

当前 APP 使用的 `ft-sdk:1.7.5`、`ft-session-replay:0.1.8` 与官方 Maven 同版本 AAR 逐字节一致；对应 sources.jar 内的 525 个 Java/Kotlin 源文件与 GitHub 发布标签完全一致。因此，本次使用开源代码解释真机采样调用链有对应版本依据。

官方 Maven 的最新预发布版本已前进到 `1.7.6-alpha02`、`0.1.9-alpha02`，与当前公开仓库 master 有差异，核对时未发现对应发布标签。不能将“当前 APP 版本一致”扩展成“官网所有最新版本都与 GitHub 同步”。这些预发布包也提供 sources.jar，可直接检查其发布源码。

## 当前 APP 与官方包

| 模块 | APP 版本 | APP 缓存 AAR 与官方 AAR | 官方 sources.jar 与 GitHub 标签 |
| --- | --- | --- | --- |
| ft-sdk | 1.7.5 | 逐字节一致 | agent_1.7.5，221 个源码文件一致 |
| ft-session-replay | 0.1.8 | 逐字节一致 | replay_0.1.8，304 个源码文件一致 |

两个标签均指向 `cf6bce33e156faedf7f8fd0597c6fc22e7d133a4`，核对时 master 也指向该提交。GitHub 默认分支 dev 较旧，不能直接用默认分支页面判断发布版本是否一致。

AAR SHA-256：

```text
ft-sdk-1.7.5.aar
9a15ed97e6ca9c0b0b5934964540a73ab58535b399a27cbe90af3204c959de3f

ft-session-replay-0.1.8.aar
0f8ca91382b2006bbbaf02c3d481adae76d89769513f757b078f7e9227c7faa7
```

## 官网当前版本与公开仓库

Android 接入文档指向官方 Maven 仓库 `mvnrepo.guance.com/repository/maven-releases`。项目配置仍使用旧域名 `mvnrepo.jiagouyun.com`，本次已直接验证缓存包内容一致。

| 模块 | 官网版本徽标 | Maven latest / release | 当前最高稳定版 |
| --- | --- | --- | --- |
| ft-sdk | 1.7.5，2026-08-19 | 1.7.6-alpha02 | 1.7.5 |
| ft-session-replay | 0.1.9-alpha02，2026-09-07 | 0.1.9-alpha02 | 0.1.8 |

Maven 元数据的 release 字段也可能指向 alpha，不能据此将预发布版本当作稳定版。

将最新预发布 sources.jar 与上述稳定版比较：基础 SDK 修改 4 个源码文件；回放 SDK 修改 11 个、新增 1 个源码文件。变更涉及外部录制器协调、RUM View 生命周期、跨进程前后台判断及图片压缩等。未发现对应 `agent_1.7.6*`、`replay_0.1.9*` 公开标签；这说明本次检查未找到可直接一一对应的标签，不代表发布源码不可获取。

## 对掉帧结论的影响

除源文件比较外，已提取稳定版与最新 alpha AAR 中的 classes.jar，比较以下热点类的完整 class 字节，全部一致：

- `FTViewPermanentIdResolver`
- `PermanentIdResolver`
- `SnapshotProducer`
- `TreeViewTraversal` 及其两个内部类
- `WindowsOnDrawListener` 及其内部类

因此最新 alpha 中没有直接修改本次发现的资源名称查询热点。预发布版本增加了外部录制器暂停/恢复原生录制的能力，但本次没有升级 APP 做真机测试，不能据此断言升级后的整体性能不变，也没有证据表明直接升级即可解决当前 React Native 页面掉帧。

## 方法与边界

本次核对包括：官方文档与版本徽标、Maven 元数据、下载 AAR/sources.jar、APP 本地 Gradle 缓存包比较、Git 远端分支与标签、逐源文件内容比较及热点 class 比较。

未从 GitHub 源码完整重建 SDK，因此不声称已证明源码到 AAR 的可复现构建。项目 React Native 桥接层已有本地兼容性/反射缓存补丁，本结论限于上述两个原生 AAR，不代表所有桥接层依赖都未修改。本轮仅做核对，未升级依赖或重新安装 APP。

原始下载、版本元数据、源码差异和热点 class 比较结果保存在 `.trellis/tasks/09-10-android-scroll-jank/evidence/sdk-audit/`。其中 `source-comparison.json` 记录同版本源码比较，`hotspot-class-comparison.json` 记录稳定版与 alpha 的热点类比较。

## Datadog 上游对照（2026-09-10）

对照 Datadog 最新 GitHub Release `3.14.0`（2026-09-09 发布）及 develop 提交 `7132403c4d4dea63c7dc740987b238b8e6a32ccb`。下述六个关键文件在发布标签与开发分支中逐字节一致：HeatmapIdentifierResolver、SnapshotProducer、TreeViewTraversal、DefaultViewIdentifierResolver、SessionReplayConfiguration、DefaultRecorderProvider。下载证据在 `evidence/sdk-audit/datadog/`。

结论：不是同一实现，但存在同类资源查询失败后重复抛异常的潜在问题。Datadog 对应功能名为 `HeatmapIdentifierResolver`；不能只因没有 FT 前缀类就认为上游没有永久 ID 功能。

| 行为 | 观测云 ft-sdk 1.7.5 / Replay 0.1.8 | Datadog 3.14.0 |
| --- | --- | --- |
| 永久 ID 启用 | TreeViewTraversal 对映射出非空 wireframes 的节点调用 attachPermanentId | Heatmaps 开关控制，默认 false；普通 Replay 不启用该路径 |
| 层级路径 | 每个节点重新向上遍历祖先 | 随快照树遍历传递父路径 |
| 同类兄弟序号 | 每次沿父节点子列表扫描 | 每个父节点遍历时一次计算各子节点序号 |
| 资源名查询 | 无缓存 | resourceNameCache 缓存成功结果 |
| 查询失败 | catch NotFoundException，返回 null，不缓存 | catch NotFoundException，返回 null，不缓存 |
| 永久 ID 复用 | 每次重新生成路径并 MD5 | 屏幕和路径匹配时复用上一轮标识 |

Datadog 中，资源名查询发生在标识复用判断之前，且只有 `resolved != null` 才写入资源名缓存。因此启用 Heatmaps 后，同一个无效动态 ID 仍可能反复查询和构造异常。这是源码层面的风险判断；没有运行 Datadog 真机 A/B，不能断言其掉帧程度与当前 APP 相同。

普通回放节点 ID 与 permanentId 是两个概念：两边的 DefaultViewIdentifierResolver 都使用 `System.identityHashCode(view)` 生成普通节点 ID；本次热点是额外的路径型 permanentId 计算，不是该 identityHashCode 调用。

本次对照证明当前实现差异，未追溯观测云最初移植的确切 Datadog 提交，因此不据此判定每段代码的历史来源。针对已验证热点，SDK 可优先评估：查询失败缓存（结合动态 ID 增长控制缓存大小）、按遍历复用父路径和兄弟序号、按实际功能需要控制永久 ID 计算。缓存与开关需保持路径变更及后端关联语义正确，不能未经验证直接删掉 permanentId。

上游源码：

- [Datadog 3.14.0 HeatmapIdentifierResolver](https://github.com/DataDog/dd-sdk-android/blob/3.14.0/features/dd-sdk-android-session-replay/src/main/kotlin/com/datadog/android/sessionreplay/internal/recorder/HeatmapIdentifierResolver.kt)
- [Datadog 3.14.0 SnapshotProducer](https://github.com/DataDog/dd-sdk-android/blob/3.14.0/features/dd-sdk-android-session-replay/src/main/kotlin/com/datadog/android/sessionreplay/internal/recorder/SnapshotProducer.kt)
- [Datadog 3.14.0 SessionReplayConfiguration](https://github.com/DataDog/dd-sdk-android/blob/3.14.0/features/dd-sdk-android-session-replay/src/main/kotlin/com/datadog/android/sessionreplay/SessionReplayConfiguration.kt)
- [Datadog 3.14.0 DefaultViewIdentifierResolver](https://github.com/DataDog/dd-sdk-android/blob/3.14.0/features/dd-sdk-android-session-replay/src/main/kotlin/com/datadog/android/sessionreplay/utils/DefaultViewIdentifierResolver.kt)

## 官方来源

- [Android SDK 接入文档](https://docs.guance.com/real-user-monitoring/android/app-access/)
- [Android Session Replay 文档](https://docs.guance.com/real-user-monitoring/session-replay/mobile/android/)
- [基础 SDK 发布标签 agent_1.7.5](https://github.com/GuanceCloud/datakit-android/tree/agent_1.7.5)
- [回放 SDK 发布标签 replay_0.1.8](https://github.com/GuanceCloud/datakit-android/tree/replay_0.1.8)
- [基础 SDK Maven 版本元数据](https://mvnrepo.guance.com/repository/maven-releases/com/cloudcare/ft/mobile/sdk/tracker/agent/ft-sdk/maven-metadata.xml)
- [回放 SDK Maven 版本元数据](https://mvnrepo.guance.com/repository/maven-releases/com/cloudcare/ft/mobile/sdk/tracker/agent/ft-session-replay/maven-metadata.xml)
