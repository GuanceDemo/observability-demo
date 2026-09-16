# RN 0.86 Replay 切页边框修复

2026-09-15：修复项目 patch-package 的 RN 0.86 适配，未更改原生 jankfix02 补丁。

## 原因与修改

旧代码读取 BorderDrawable.computedBorderColors 和 BackgroundDrawable.computedBorderRadius。
它们由 draw() 更新，首次绘制前分别为黑色和 null。Replay OnDrawListener 的
64ms 去抖上限分支可以在实际绘制前同步采样，使回放得到黑色边框与 0 圆角。

新代码读取 borderColors、borderRadius 和当前 bounds，调用 RN 的颜色/圆角解析器；
保留 RTL、百分比和 DIP 尺寸规则，不强制 draw，不缓存样式值。Kotlin value class
颜色解析入口使用缓存 Method，R8 保留该类并校验最终 APK 的 JVM 方法签名。
既有协议仅支持单一圆角，仍沿用四角平均；这次没有扩展协议。

## 验证

- GCP Android 模拟器上的独立 app_process 离屏测试：19 项断言通过。
- 相同测试替换为修复前 mapper：首个圆角断言失败 `AssertionError: radius 0.0`，期望 17。
- 覆盖首次绘制、绘制后、颜色/圆角修改但缓存未更新、百分比圆角、尺寸变化、清除圆角、RTL 混合边框。
- 18 suites / 87 tests、typecheck、lint、reflection-cache 检查通过。
- 既有 border/clip 回归与最终 Release APK 反射、资源上传 ABI 检查通过。
- patch-package 补丁反向 dry-run、git diff --check 通过。
- Safe Release（x86_64、arm64-v8a，Replay 开启，jankfix02）构建成功。
- APK SHA-256：b94a23e814344d155f19c9a4622fac816d54bc7a253b4fa2067472446c527d50。

修复验证后，用户要求替换 GCP；已安装并更新下载 APK，详见 deployments/android-replay-first-draw-gcp-20260915.md。
新会话的云端播放视觉验收尚未进行。

## 重跑

在 mobile-app，设置 JAVA_HOME、ANDROID_HOME，先构建 Release，再执行：

```sh
python3 scripts/build-replay-first-draw-check.py --output /tmp/replay-first-draw
adb push /tmp/replay-first-draw/classes.dex /data/local/tmp/replay-first-draw.dex
adb shell CLASSPATH=/data/local/tmp/replay-first-draw.dex app_process /system/bin ReplayFirstDrawCheck
bash scripts/verify-android-replay-reflection.sh
python3 scripts/check-replay-visuals.py
```

测试使用真实 RN Drawable/解析器，Context 仅为离屏测试提供 Resources 和默认 RTL 偏好。
