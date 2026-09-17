# 永久 ID 快照遍历优化实验

基于官方 `ft-sdk:1.7.5` 与 `ft-session-replay:0.1.9-alpha03`，保留永久 ID、RUM 和
Replay。第一版的动态 ID 资源查询跳过规则继续保留。第二版新增一次同步快照
内的父路径复用与按控件类统计的兄弟索引；不跨帧保存 View 或路径。

`SnapshotProducer.produce()` 开始时创建独立解析上下文，在 `finally` 中释放。
嵌套快照恢复外层上下文，其他线程不可见。Replay 在作用域内使用该上下文；
作用域外维持原反射调用，普通 RUM 点击仍走原来的即时解析。
包名和 screen/context 回退仍按目标 View 计算；转义、同类兄弟序号和 MD5
输出规则不变。与原 SDK 一样，快照在 UI 线程同步执行；mapper 不应在同次
遍历中修改 View 树的身份或层级。下一次快照重新计算，支持帧间重排、重挂、
ID 和页面名变化。异步 mapper 回调不共享此缓存。

## 构建

要求 Android platform 36、JDK 17+。在 `mobile-app` 下执行：

```bash
export JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home'
export ANDROID_HOME="$HOME/Library/Android/sdk"
python3 scripts/build-ft-sdk-patch.py
python3 scripts/test-ft-sdk-patch.py
cd android
./gradlew -I ../sdk-patches/ft-sdk-1.7.5/use-local.gradle \
  assembleSafeRelease -PMALL_DEMO_PROFILEABLE=true \
  -PreactNativeArchitectures=arm64-v8a
```

沿用原构建的 Gateway/RUM 环境变量，不能用其他网关配置来验收本机 APK。
脚本对官方 AAR 和 sources.jar 做 SHA-256 校验，只编译/替换以下类：

- `FTViewPermanentIdResolver` 与新增嵌套类 `Snapshot`。
- Replay 的 `PermanentIdResolver` 和 `SnapshotProducer`。
- `BytesCompressor` 使用 alpha03 官方实现，不再打本地压缩补丁。

其余类及 AAR 资源内容逐字节保留。Android annotation 和非 final R 字段是
仅编译用的桩，不进入输出 AAR；R 字段保留运行时读取，避免错误内联资源 ID。
这不是全仓源码重建，未修改的 SDK 版本上报仍为 `1.7.5` / `0.1.9-alpha03`。

本地 Maven 产物为 `ft-sdk:1.7.5-jankfix02` 和
`ft-session-replay:0.1.9-alpha03-jankfix01`，必须配套使用；init script 强制两者并
检查产物存在。默认不加 `-I` 的构建仍用官方依赖，不修改共享 Gradle 缓存。
`build/sdk-patch/manifest.json` 记录确切输入/输出哈希及变动类清单。

## GCP 演练发布入口

在 `mobile-app` 下设置 `JAVA_HOME`、`ANDROID_HOME` 和 `MALL_DEMO_GATEWAY_URL`，执行：

```bash
bash scripts/build-android-demo-release.sh
```

入口固定加载配套补丁，并启用演练所需远程控制/结算崩溃开关。最终 APK 必须通过
`bash scripts/verify-android-replay-reflection.sh --patched APK`，检查实际 Replay
版本、压缩调用及两侧遍历补丁，不能仅从源码或发布清单推断生效。
2.3.24/2.3.25 曾因漏传 init script 回退到0.1.8；其清单中的补丁标注不可信。

## 验证与回滚

JVM 测试用官方原始源码作 oracle，对比路径和哈希，验证动态 ID 边界、资源
回退、宽树/深树、混合类型、反向遍历、帧间控件变化、嵌套/线程隔离与清理。
计数断言验证兄弟只扫描一次、祖先资源只解析一次。Android fake 不能替代
真机帧时长与云端回放验收。

第二版 APK、基线第一版 APK 和精确 R8/Hermes 映射存放于
`build/diagnostics/scroll-jank/sdk-fix-v2/`。用 `adb install -r` 安装其中的
`baseline-v1.apk` 可回滚到第一版，或用上一目录 `sdk-fix/baseline.apk`
回滚到官方 SDK 基线；安装后重启进程。应用数据不清除。

## GCP 试用部署

2026-09-10 的 GCP 版本为 2.3.15/code 8，显式启用上述配套 jankfix02
依赖，并保留 RN 边框及滚动裁剪修复。发布物和匹配的 SourceMap 位于
`mobile-app/build/releases/2.3.15/`；验证与备份记录见
`owl-reports/android-sdk-v2-gcp-20260910/report.md`。后续构建须继续显式
传入同一 init script，才能保留当前 GCP 使用的 SDK 补丁。

## Replay 压缩拼接修复（replayfix03）

仅回移官方 [BytesCompressor 修复](https://github.com/GuanceCloud/datakit-android/blob/f2d2cbc1a43d50d4d78cbc3fdd8b68817b3a5d19/ft-session-replay/src/main/java/com/ft/sdk/sessionreplay/internal/net/BytesCompressor.java)，
对应 0.1.9-alpha03 changelog；没有整体升级到 alpha SDK。
原 0.1.8 忽略传入的 flush 标志，finish 后又 reset 并追加第二条空 zlib 流。
单包可解压，但去除分段头尾后拼接，第一段的结束标志仍使解压提前结束。
补丁先 SYNC_FLUSH 对齐 deflate 块，再在同一流 finish，finally 释放资源。
不改 index_in_view、记录内容、时间戳、View 或采样配置。

运行 `python3 scripts/test-replay-compression.py` 验证实际 AAR 类的空数据、
1024 字节边界、大随机数据、高压缩数据、中文 JSONL、多段拼接及无剩余流。
可加 `--capture-dir /path/to/multipart-bodies` 离线验证真实抓包，不上传或改写遥测。
测试同时断言原版出现首段截断，避免只有单包往返测试而漏过回归。

## alpha03 基线升级

当前从官方 Maven `0.1.9-alpha03` AAR、sources.jar 和 POM 构建，三者 SHA 固定。
仅保留 Replay 永久 ID 快照遍历两类补丁，Agent 仍为 `1.7.5-jankfix02`；
RN 样式/裁剪补丁仍由现有 RN 模块构建。上节 replayfix03 为 2.3.22 的历史方案，
压缩补丁文件仅作历史参考，当前构建不应用。压缩回归同时运行官方 alpha03、
当前补丁 AAR 和旧 0.1.8，保证 alpha03/补丁输出一致且旧缺陷确实可复现。
官方 AAR 是发布基线，不以同版本名称的最新 Git HEAD 代替发布内容。
