# React Native 移动端 RUM Demo

## 架构与边界

`mobile-app/` 是 React Native 0.86 原生应用，Android/iOS 共用 TypeScript 商城、状态、API、故障分发和观测初始化。它不加载 WebView，也不复刻桌面外层工作台。

商城 UI 与 `shop.html` 当前移动断点保持同一产品结构：单一绚彩外观、首页六本书目录、
阅读路径、全量详情与 Tab、多商品购物车、人物登录和中英文切换。商品、主题、阅读路径、
商城文案、首本书封面和人物头像由 `npm run sync:storefront` 从网站基准生成或复制，
`npm run check:storefront` 用于阻止原生数据静默落后于 Web。

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

Android 公网演示包可以在构建期同时传入
`MALL_DEMO_RUM_DATAWAY_URL`、`MALL_DEMO_RUM_CLIENT_TOKEN` 与
`MALL_DEMO_RUM_ANDROID_APP_ID`，并可用 `MALL_DEMO_RUM_SERVICE`、
`MALL_DEMO_RUM_ENV` 覆盖服务和环境。完整三元组存在时优先走公网 DataWay，缺少任意
一项则回退到上述 Gateway 配置。client token 只允许通过未提交的 Gradle 属性或环境变量
注入，并只在 Android 原生 `BuildConfig` 中消费，不通过 React Native 常量桥暴露给 JS。
Android 构建使用 `ft-plugin 1.3.8`、`ft-sdk 1.7.5`、`ft-native 1.1.3` 和
`ft-session-replay 0.1.8`，
并在 `MainApplication.onCreate()` 中、`loadReactNative()` 之前安装核心 SDK；JS 桥随后
初始化 RUM/Log/Trace/Replay，从而捕获冷启动并避免 React Native 的 OkHttp 先于 SDK 构建。
Replay 版本不能沿用桥包旧的 `0.1.5` 传递依赖：它的资源上传回调仍是两参数，和
`ft-sdk 1.7.5` 的三参数调用方不兼容，会导致 Replay 布局成功但图片资源不上传。

Android SDK 1.7.2 及以上版本会通过
`GET /rum-proxy/v1/datakit/pull?filters=true` 拉取 DataKit 缓存的 RUM 与日志过滤规则。
该只读端点与 RUM、日志和 Replay 写入端点一样通过 Gateway 和 order-service 的双层
精确白名单转发；其他未知 `/rum-proxy` 路径仍返回 404。

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
npm run check:storefront
npm run typecheck
npm test -- --runInBand
npm run lint

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
APK 的 DEX，防止 R8 再次删除或改名这些字段而导致重放丢失颜色、圆角和文本样式；
同时校验 Replay 版本与资源上传回调 ABI，避免图片只显示资源 ID。

当前商城只包含合成身份和 APK 内公开、受控的演示素材，因此 Replay 使用全局
`SessionReplayPrivacy.ALLOW`：页面文字、普通输入、触点、商品封面和品牌图片都按真实
内容重放，避免演示时被误解为采集缺失。新增真实用户、密码字段、远程图片、用户头像
或上传内容前必须重新评估隐私并恢复遮蔽策略。隐私策略变化仅影响新 APK 产生的新会话，
历史回放不会被重新生成。

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

## Linux KVM 与网站访问边界

真实移动端演示由四层组成：

```text
网站 HTML 中的设备窗口
  → HTTPS / WebRTC 信令与输入控制
    → Linux 会话代理与 Emulator 实例
      → 安装 safe APK 的 KVM Android 虚拟设备
        → Gateway → order / inventory / payment / rum-proxy
```

Linux 宿主机必须开放 `/dev/kvm`，使用包含 x86_64 ABI 的 Android 系统镜像，并为每个并发
演示会话分配独立 Emulator 数据目录。启动后通过 `adb install -r` 安装
`app-safe-release.apk`，由流媒体层把真实 Emulator 画面与触控/键盘输入传给网站设备窗口。
网站只嵌入远程设备客户端，不加载商城 HTML，也不把 APK 放入 iframe。

APK 自身负责演示画面边界：Android 状态栏和系统手势导航条均保持可见，使用白色系统栏背景与深色图标；商城品牌行、搜索框和顶部工具按钮使用统一的 16dp 水平栅格，头部与底部导航通过 Safe Area 避让系统区域。Linux Emulator 镜像应使用无偏置打孔的 `medium_phone` 硬件配置，并在启动后执行 `mobile-app/scripts/configure-android-demo-ui.sh 390`，固定演示视口密度、保留真实系统网络和电量状态并隐藏无关通知图标。不要为 API 36 启用 System UI Demo Mode 的 Wi-Fi 状态；该模式可能通过新旧状态管线重复绘制 Wi-Fi 图标。不要裁掉或伪造系统栏；流媒体层也不应二次裁剪顶部或底部，否则会破坏 360/390 dp 的原生布局与触控坐标。

公开环境默认使用 `safe` APK；`demoFaults` 只进入隔离、可自动重建的实例池。会话代理还应负责
鉴权、最大会话时长、断线回收、实例清理、并发限额和 TLS，避免不同访客共享登录 Cookie、
购物车、RUM 用户上下文或故障状态。本仓库交付 APK 与 Gateway 契约；KVM 编排、WebRTC
服务和网站嵌入客户端属于部署系统边界。

## 验收

1. 在 360px 与 390px 设备验证首页、阅读路径、全部详情 Tab、空/非空购物车、人物登录、中英文、Toast、加载层和抽屉。
2. 验证搜索、主题/排序、多商品选择与数量、删除、登录后真实下单和连续下单。
3. Android/iOS 分别确认 View、Action、Resource、Error、Log、Trace 和 Replay。
4. 验证购书 Resource 与 gateway、order、inventory、payment Trace 共享业务 ID 和 DDTrace 上下文。
5. DemoFaults 包触发 Native Crash，重启后确认符号化堆栈指向 `DemoFaultsModule`/`DemoFaults.mm`。
6. Android 验证 ANR，iOS 验证 Freeze；Safe 包应拒绝两类危险调用。
7. 上传 SourceMap、R8 mapping、Native 符号和 dSYM 时保持 `app_id + env + version` 一致。

Native Crash/ANR/Freeze 会退出或阻塞 App，只在隔离设备执行。移动 Session Replay 作为内部 Demo 验收项。
