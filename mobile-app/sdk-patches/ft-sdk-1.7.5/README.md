# 永久 ID 快照遍历优化实验

基于官方 `ft-sdk:1.7.5` 与 `ft-session-replay:0.1.8`，保留永久 ID、RUM 和
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

其余类及 AAR 资源内容逐字节保留。Android annotation 和非 final R 字段是
仅编译用的桩，不进入输出 AAR；R 字段保留运行时读取，避免错误内联资源 ID。
这不是全仓源码重建，未修改的 SDK 版本上报仍为 `1.7.5` / `0.1.8`。

本地 Maven 产物为 `ft-sdk:1.7.5-jankfix02` 和
`ft-session-replay:0.1.8-jankfix02`，必须配套使用；init script 强制两者并
检查产物存在。默认不加 `-I` 的构建仍用官方依赖，不修改共享 Gradle 缓存。
`build/sdk-patch/manifest.json` 记录确切输入/输出哈希及变动类清单。

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
