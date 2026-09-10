# Mall Demo Mobile

React Native 0.86 原生商城与 RUM 故障演示，Android/iOS 共享 TypeScript UI 与业务逻辑，不使用 WebView。

## 能力

- 以网站当前移动端商城为数据与视觉基准，提供单一绚彩外观；不使用 WebView。
- 原生首页、六本书目录、阅读路径、全量商品详情与 Tab、多商品购物车。
- 搜索、主题筛选、排序、数量/选择/删除、中文/英文和固定人物登录。
- 使用真实会话调用 `POST /api/orders`，并保留批量流量、加载层、Toast、Safe Area、系统返回和边缘侧滑返回。
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
npm run check:storefront
npm run check:replay-cache # JDK 17：反射缓存复用及实时字段值校验
npm run typecheck
npm test -- --runInBand
npm run lint
```

商城商品、阅读路径、中英文文案以及首本书/人物图片从网站基准生成。网站数据变更后运行
`npm run sync:storefront` 并提交生成文件与资源；CI/验收使用
`npm run check:storefront` 检查是否漂移。

Android：

```bash
cd android
./gradlew installSafeDebug
./gradlew installDemoFaultsDebug
```

Linux KVM Android Emulator 的发布包：

```bash
cd android
./gradlew assembleSafeRelease assembleDemoFaultsRelease
adb install -r app/build/outputs/apk/safe/release/app-safe-release.apk
```

- 网站公开演示默认安装 `safe` 包；它包含完整商城、RUM、Replay 与安全故障。
- 隔离的内部演示设备才安装 `demoFaults` 包；它额外允许 Native Crash 与 ANR。
- Release APK 同时包含 x86/x86_64 Emulator ABI 和 ARM ABI。
- Android APK 显示真实系统状态栏和手势导航条，统一使用白色背景与深色系统图标；商城品牌行、搜索框和系统栏采用一致的 16dp 水平栅格，顶部工具按钮统一为 32dp 圆形控件。商城顶部和底部控件分别通过 Safe Area 避让系统区域，故障控制入口位于顶部工具栏，不遮挡商城内容。
- 演示 Emulator 推荐使用 API 36 的 `medium_phone` 硬件配置，避免 Pixel 5 左侧打孔把系统时间强制推离应用栅格。设备启动后运行 `ADB_BIN=/path/to/adb npm run demo:android-ui -- 390`，即可保留真实系统栏并固定时间、电量、网络和通知状态；需要恢复日常系统栏时传入 `off`。
- 浏览器不能直接“打开 APK”；网站 HTML 应嵌入该 Emulator 的实时视频/音频与输入控制流，APK 仍在 Linux KVM 虚拟设备内真实运行。浏览器流媒体、会话分配和访问控制属于独立部署层，不应把商城改成 iframe/WebView。
- 商城可点击控件会在 `onPress` 操作被接受后通过 `DemoFaults.acknowledgeInteraction` 写入结构化 `MallDemoInteraction` 标记，供 Emulator Gateway 测量“点击→APK 操作确认”。动作名只允许 `[a-z0-9_.:-]` 且最长 80 字符；该确认不代表异步业务请求已经完成。

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

Android 也支持公网 DataWay 构建覆盖。`ft-plugin 1.3.8` 会在 React Native SDK
之外补齐 App 启动、OkHttp、Activity/Fragment 与原生点击自动采集；底层依赖固定为
`ft-sdk 1.7.5`、`ft-native 1.1.3` 和 `ft-session-replay 0.1.8`。这三个版本
必须成套升级，Replay 资源上传回调 ABI 不一致会让图片退化为灰色资源 ID 框。
client token 只通过 Gradle 属性或环境变量注入，不得写入仓库：

```bash
./gradlew assembleSafeRelease \
  -PMALL_DEMO_RUM_DATAWAY_URL=https://rum-openway.guance.com \
  -PMALL_DEMO_RUM_CLIENT_TOKEN="$MALL_DEMO_RUM_CLIENT_TOKEN" \
  -PMALL_DEMO_RUM_ANDROID_APP_ID=mall_app_android \
  -PMALL_DEMO_RUM_SERVICE=mall-app-android \
  -PMALL_DEMO_RUM_ENV=prod
```

三项 `DataWay URL + client token + Android App ID` 同时存在时，APK 会在
`MainApplication.onCreate()` 中、React Native 加载前安装核心 SDK，再由 JS 桥初始化
RUM/Log/Trace/Replay；client token 不会通过原生常量桥暴露给 JS。否则继续使用 Gateway
`/rum-proxy` 配置，不会重复安装 SDK。

链路入口使用 `/tracing/link/all`。Android 已安装观测云 App 时会指定观测云包名
直接打开目标 `trace_id`，iOS 使用 Universal Link；未安装时回退浏览器。

## SourceMap 与符号

开发时可生成独立 JS bundle 和 SourceMap：

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

Android Release 必须使用**同一次 Gradle 构建**的 Hermes 组合映射：
`android/app/build/generated/sourcemaps/react/<variant>Release/index.android.bundle.map`。
独立 `bundle:android` 产物不能替代它。观测云上传 ZIP 内使用
`js/index.android.bundle.map` 和 `android/mapping.txt`（后者来自同变体 R8 mapping）；
C/C++ 符号按需另加 `android/<ABI>/*.so`。每次重新构建 APK 后须重新打包映射。

上传时必须保持 `app_id + env + version` 与实际 RUM 数据一致：代理模式的
`app_id`、`env` 来自 mobile-config，`version` / `app_version` 使用原生 APK 版本，
避免被后端服务版本覆盖。SDK 0.4.2 在 RN 0.86/Gradle 9 上所需的仓库与背景绘制兼容改动保存在 `patches/`，`npm ci` 会通过 `patch-package` 自动应用。

## Android 业务故障场景

顶部故障入口先“启用场景”，再回到书店执行对应操作。前端体验包括详情渲染失败、
加购无反馈、购物车金额未更新；运行时新增结算预览卡顿；网络请求包括内容加载慢、
请求超时与重试。原有后端服务、依赖、JVM 场景保留。

每轮具有独立 `fault_run_id`，关联 RUM Action、Error、Resource、日志和视图。
抽屉提供 RUM / 回放入口，恢复后仍保留本轮查询链接。详情错误支持重新加载；
购物车金额异常支持重新计算，并阻止错误金额进入下单；超时后的重试使用正常接口。

内容接口为 `GET /api/demo/mobile/book-content`，仅接受固定的 `bookId`、`lang`、
`mode=normal|slow|timeout`，内容与 Web 书目同步。慢响应固定延迟 3.5 秒；超时模式
服务端延迟 5 秒，客户端在 2 秒截止并取消请求。结算预览在原生主线程固定阻塞约
1.8 秒，15 秒冷却；Safe APK 允许此有界演示，不改变 Crash/ANR 的变体限制。

Compose 可通过 `DATAKIT_RUM_URL` 指定现有接收入口；未设置时仍使用
`http://${DATAKIT_HOST:-host.docker.internal}:9529`。同时支持 `MOBILE_RUM_SERVICE`。
部署必须验证配置实际生效及 RUM 入库，不能只以 HTTP 业务健康检查代替。

本次 GCP 部署和实测证据见 `docs/android-rum-business-faults-validation.md`（仓库根目录）。

后续交互优化版本为 2.3.12，GCP Safe APK 和精确 Hermes/R8 符号包位于
`build/releases/2.3.12/`。首页减少无关重绘并恢复返回位置，主要操作提供 48 dp
触控区域，故障抽屉仅标题区处理拖动。Replay 持续开启，反射层只缓存字段元数据，
每次仍读取实时值。测试、模拟器回归及 RUM/Replay 实测见
[Android 交互优化与验证](../docs/android-interaction-optimization-validation.md)。

## 真实故障风险

- Native Crash 会直接退出 App，重启后 SDK 才可能完成历史数据上传。
- ANR/Freeze 会阻塞主线程约 8 秒。
- 白屏会隐藏整个商城根视图和故障标签，5 秒后自动恢复。
- 这些能力只用于隔离的内部 Demo 环境；Session Replay 为演示验收能力。

Session Replay 对当前隔离 Demo 使用全局 `SessionReplayPrivacy.ALLOW`：页面文字、
普通输入、触点、封面、品牌图和测试头像都参与重放，避免演示时被误解为采集缺失。
当前页面只使用合成身份与随 APK 发布的公开受控素材；接入真实用户、密码字段、远程
图片、用户头像或上传内容前，必须恢复与数据分类匹配的遮蔽策略。

完整部署、验收和故障目录见仓库的 `docs/mobile-rum.md`。

## Android Release 性能诊断

Release 可通过 `-PMALL_DEMO_PROFILEABLE=true` 允许已授权 adb 的本地方法采样，
保持 `debuggable=false`、Hermes 和 R8。默认关闭此权限；开启权限本身不会启动录制。

在相同构建配置上追加 `-PMALL_DEMO_DISABLE_REPLAY=true`，可完全跳过 Android
Replay 初始化进行对照，RUM/Log/Trace 配置仍保留。该开关要求同时开启
`MALL_DEMO_PROFILEABLE`，默认不影响正式回放。切换 APK 后必须重新启动进程。
保存每组 APK 与同次构建的 Hermes/R8 映射，测试后恢复 Replay 开启的版本；
不能将诊断包覆盖网站公开下载产物。
