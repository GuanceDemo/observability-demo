# Mall Demo Mobile

React Native 0.86 原生商城与 RUM 故障演示，Android/iOS 共享 TypeScript UI 与业务逻辑，不使用 WebView。

## 能力

- 复刻网站移动端的绚彩/黑白主题、品牌栏、首页/本书/购物袋。
- 原生购物、批量流量、加载层、Toast、Safe Area、系统返回和边缘侧滑返回。
- 右侧故障抽屉与常驻 `! 故障` 标签。
- 观测云 React Native RUM、Logs、DDTrace 和 Session Replay。
- 白屏、JS Error、Native Crash、Android ANR、iOS Freeze、慢网络及现有服务端故障。
- `safe`/`demoFaults` Android flavor 和 Safe/DemoFaults iOS scheme。

## 本地运行

默认连接 `observability-demo` 集群的公网 Gateway：

- Android/iOS：`http://120.79.13.13:31080`

本地开发仍可通过 `MALL_DEMO_GATEWAY_URL` 覆盖，例如 Android Emulator
使用 `http://10.0.2.2:8080`，iOS Simulator 使用
`http://127.0.0.1:8080`。

安装与校验：

```bash
npm ci
npm run typecheck
npm test -- --runInBand
npm run lint
```

Android：

```bash
cd android
./gradlew installSafeDebug
./gradlew installDemoFaultsDebug
```

真机或其他 Gateway 通过构建属性覆盖：

```bash
./gradlew assembleDemoFaultsRelease \
  -PMALL_DEMO_GATEWAY_URL=https://demo.example.com
```

iOS 需要完整 Xcode：

```bash
cd ios
bundle install
bundle exec pod install
xcodebuild \
  -workspace MallDemoMobile.xcworkspace \
  -scheme MallDemoMobileSafe \
  -sdk iphonesimulator \
  MALL_DEMO_GATEWAY_URL=http://127.0.0.1:8080 \
  CODE_SIGNING_ALLOWED=NO \
  build
```

危险能力只在 `MallDemoMobileDemoFaults` scheme 和 Android `demoFaults` flavor 中编译启用。Safe 构建保留 JS 接口，但原生调用会返回 `DEMO_FAULTS_DISABLED`。

## RUM 配置

Gateway 的 `GET /api/demo/mobile-config` 是唯一移动配置入口。Android/iOS 必须先分别创建 RUM 应用：

```dotenv
MOBILE_RUM_ENABLED=true
MOBILE_RUM_ANDROID_APPLICATION_ID=android_app_id
MOBILE_RUM_IOS_APPLICATION_ID=ios_app_id
MOBILE_RUM_SESSION_REPLAY_ENABLED=true
```

App 只访问 Gateway；`datakitPath=/rum-proxy` 会解析到 Gateway origin。配置响应不包含 client token。只构建单个平台时可以只配置该平台 App ID；App 会按当前平台判断是否初始化。所有购书、故障和慢资源请求携带 `X-Key-Request`、`X-Business-Request-Id`、`baggage` 和 DDTrace 传播头。

链路入口使用 `/tracing/link/all`。Android 已安装观测云 App 时会指定观测云包名
直接打开目标 `trace_id`，iOS 使用 Universal Link；未安装时回退浏览器。

## SourceMap 与符号

生成独立 JS bundle 和 SourceMap：

```bash
npm run bundle:android
npm run bundle:ios
```

构建相关产物：

- Android JS SourceMap：`build/sourcemaps/index.android.bundle.map`
- Android R8 mapping：`android/app/build/outputs/mapping/`
- Android Native 符号：Release 构建的 `native-debug-symbols`/未剥离库产物
- iOS JS SourceMap：`build/sourcemaps/main.jsbundle.map`
- iOS dSYM：Release Archive 的 `.xcarchive/dSYMs/`

上传时必须保持 `app_id + env + version` 与 `/api/demo/mobile-config` 返回值一致。SDK 0.4.2 在 RN 0.86/Gradle 9 上所需的仓库与背景绘制兼容改动保存在 `patches/`，`npm ci` 会通过 `patch-package` 自动应用。

## 真实故障风险

- Native Crash 会直接退出 App，重启后 SDK 才可能完成历史数据上传。
- ANR/Freeze 会阻塞主线程约 8 秒。
- 白屏会隐藏整个商城根视图和故障标签，5 秒后自动恢复。
- 这些能力只用于隔离的内部 Demo 环境；Session Replay 为演示验收能力。

完整部署、验收和故障目录见仓库的 `docs/mobile-rum.md`。
