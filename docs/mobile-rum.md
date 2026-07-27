# React Native 移动端 RUM Demo

## 架构与边界

`mobile-app/` 是 React Native 0.86 原生应用，Android/iOS 共用 TypeScript 商城、状态、API、故障分发和观测初始化。它不加载 WebView，也不复刻桌面外层工作台。

数据路径固定为：

```text
Android / iOS App
  → Gateway
    → order / inventory / payment
    → /rum-proxy
      → DataKit
```

移动设备不得直连 DataKit。业务 API、服务端故障开启/恢复和日志查询直接复用；网页故障实现不复用。

## 配置

Android 与 iOS 分别在观测云创建 RUM 应用，再配置 Compose；只构建单个平台时，
允许仅配置该平台的 App ID：

```dotenv
MOBILE_RUM_ENABLED=true
MOBILE_RUM_ANDROID_APPLICATION_ID=android_app_id
MOBILE_RUM_IOS_APPLICATION_ID=ios_app_id
MOBILE_RUM_SESSION_REPLAY_ENABLED=true
```

或配置 Helm：

```bash
helm upgrade --install demo charts/observability-demo \
  --namespace observability-demo \
  --reuse-values \
  --set rum.mobile.enabled=true \
  --set-string rum.mobile.androidApplicationId=android_app_id \
  --set-string rum.mobile.iosApplicationId=ios_app_id
```

`GET /api/demo/mobile-config` 返回平台 App ID、project、service、env、version、采样率、Replay 开关和相对 `datakitPath`。它不返回 client token。移动 RUM 默认关闭，开启时至少需要一个平台 App ID，App 只会在当前平台 App ID 存在时初始化 SDK。

RUM、日志和 Trace 的采样率均为 100%。Android 原生 View、Fragment View、
Resource、Action、UI Block、ANR、Crash、控制台日志、自定义日志、RUM 日志关联、
DDTrace 自动追踪和 RUM Trace 关联全部启用。

故障抽屉中的链路入口使用当前 `/tracing/link/all` 控制台链接。Android 已安装观测云
App 时指定 `com.cloudcare.ft.dataflux.mobile` 直接打开目标 `trace_id`；iOS 优先使用
Universal Link。未安装观测云 App 时回退浏览器。

## 故障抽屉

- 收起时右侧始终显示 `! 故障`；活动故障显示红点和缩短标题。
- 展开宽度为 `min(88vw, 360dp)`。
- 遮罩、收起按钮、Android 返回键和向右滑动手势只关闭抽屉，不恢复故障。
- Native Crash、ANR、Freeze 必须二次确认。
- 白屏清空根视图并隐藏标签，5 秒后恢复。

场景的 `execution=client|server` 和 `platforms` 来自共享 `/api/demo/faults` 目录。Web 工作台会过滤掉不含 `web` 的条目。

## 构建

```bash
cd mobile-app
npm ci
npm run typecheck
npm test -- --runInBand

cd android
./gradlew assembleSafeDebug assembleDemoFaultsDebug
./gradlew assembleSafeRelease assembleDemoFaultsRelease \
  -PMALL_DEMO_GATEWAY_URL=https://demo.example.com

cd ..
npm run verify:android-replay -- \
  android/app/build/outputs/apk/safe/release/app-safe-release.apk \
  android/app/build/outputs/apk/demoFaults/release/app-demoFaults-release.apk
```

Session Replay 0.4.2 会按原始名称反射 React Native 0.86 的背景与文本字段。
`android/app/proguard-rules.pro` 因此保留两个具体渲染类；上述校验会直接检查最终
APK 的 DEX，防止 R8 再次删除或改名这些字段而导致重放丢失颜色、圆角和文本样式。

完整 Xcode/macOS Runner：

```bash
cd mobile-app/ios
bundle install
bundle exec pod install
xcodebuild -workspace MallDemoMobile.xcworkspace \
  -scheme MallDemoMobileSafe \
  -sdk iphonesimulator \
  MALL_DEMO_GATEWAY_URL=https://demo.example.com \
  CODE_SIGNING_ALLOWED=NO build
xcodebuild -workspace MallDemoMobile.xcworkspace \
  -scheme MallDemoMobileDemoFaults \
  -sdk iphonesimulator \
  MALL_DEMO_GATEWAY_URL=https://demo.example.com \
  CODE_SIGNING_ALLOWED=NO build
```

当前本机只有 Xcode Command Line Tools，iOS Pod 与最终构建必须在完整 Xcode 或 macOS Runner 完成。

## 验收

1. 在 360px 与 390px 设备验证首页、详情、空/非空购物袋、两套主题、Toast、加载层和抽屉。
2. Android/iOS 分别确认 View、Action、Resource、Error、Log、Trace 和 Replay。
3. 验证购书 Resource 与 gateway、order、inventory、payment Trace 共享业务 ID 和 DDTrace 上下文。
4. DemoFaults 包触发 Native Crash，重启后确认符号化堆栈指向 `DemoFaultsModule`/`DemoFaults.mm`。
5. Android 验证 ANR，iOS 验证 Freeze；Safe 包应拒绝两类危险调用。
6. 上传 SourceMap、R8 mapping、Native 符号和 dSYM 时保持 `app_id + env + version` 一致。

Native Crash/ANR/Freeze 会退出或阻塞 App，只在隔离设备执行。移动 Session Replay 作为内部 Demo 验收项。
