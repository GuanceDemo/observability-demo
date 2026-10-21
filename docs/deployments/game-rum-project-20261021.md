# 旧 SDK Demo 停用与游戏 RUM project 修复

2026-10-21，用户授权停用旧 SDK Demo、补齐 `mall-game-h5` 的
`project=mall-demo`，并核对商城 APP 的 `project` / `env`。

## 生效结果

- `mobile-demo/mobile-demo` Deployment 从 1 缩容至 0；无运行 Pod，Service
  Endpoints 为空。保留 Deployment 和 Service，未删除历史观测数据。
- `observability-demo/demo-observability-demo-game-service` 已滚动更新并恢复
  1 个 Ready / Available 副本。游戏大厅和植物游戏共用的 `game-runtime.js`
  在首个 Action、Replay、View 之前设置 RUM 全局 `project`，优先使用运行配置，
  缺省回退 `mall-demo`；飞行游戏已有等效设置。
- 当前商城 APK 2.3.32 为 gateway-proxy 模式，实际
  `project=mall-demo`、`env=demo`、`service=mall-mobile`。线上
  `/api/demo/mobile-config` 与近七天 RUM 数据一致。

## 部署方式与文件

本次为单脚本静态热修复，未发布新镜像或 Git tag。修改前公网脚本与本地源码
逐字节一致，SHA256 为
`c06dcb7592e4817c101398ef1898b5c294afac02ed7deff64e3c4a5a78625db3`。

不可变 ConfigMap `game-rum-project-ac17700d85e8` 提供修复脚本，挂载于
`/opt/game-rum-hotfix/assets/game-runtime.js`；Deployment 增加
`SPRING_WEB_RESOURCES_STATIC_LOCATIONS`，先查该外置目录，再保留全部默认
classpath 静态资源目录。其余静态资源继续来自原镜像。

公网脚本与源码 SHA256 均为
`ac17700d85e83a1983e86e3aa02394db21004da8bd5485d3abe01d460209b1c6`。
Deployment 注解 `demo.guance.com/game-rum-project-hotfix` 记录该摘要。

管理主机 `120.79.13.13` 保存：

- `/root/mobile-demo-before-scale-20261021.json`
- `/root/game-rum-before-20261021.json`
- `/root/game-rum-project-20261021/game-configmap.json`
- `/root/game-rum-project-20261021/game-patch.json`
- `/root/game-rum-project-20261021/game-rollback.json`

线上仍使用 Game 镜像 `pubrepo.jiagouyun.com/demo/observability-demo-game-service:2.4.3`，
`DD_VERSION` 和 RUM version 均为 `2.4.3`。原 Helm revision 34 的 Chart / App
Version 是 `2.4.1`；该既有版本差异未由本次静态热修复改动，不作为版本一致的
正式发布验收。没有上传或覆盖 SourceMap。

后续正式镜像发布必须包含源码修复，并在同次部署中移除本热修复的环境变量、
volumeMount、volume 和注解，防止外置旧脚本遮盖新镜像。然后核对公网脚本摘要、
新 RUM 标签及版本/SourceMap 一致性，再删除无引用的 ConfigMap。

## 验证

- `mvn -pl order-service,game-service,gateway-service test` 通过。
- `node --test scripts/tests/*.test.cjs`：26 项通过；新增覆盖大厅/植物游戏的
  配置 project、缺省 project、首次 Action/Replay/View 和单次 SDK 初始化。
- `game-runtime.js` 及 `business.html` / `shop.html` 内联 JS 语法检查通过；
  `git diff --check` 通过。
- 通过本机 SSH 转发访问线上游戏，使用 Demo Reader A 打开植物游戏，页面
  显示“RUM 已连接 · 画面采集中”，无浏览器 error。此处只验证标签和页面加载，
  不作为完整游戏或云端 Replay 播放验收。
- Owl 在演示工作空间查询新浏览器会话
  `c2b7ee59-d118-411e-94ab-fc7b9f16052b`：`games/home` 与
  `games/plants-vs-zombies/level-1` 均有 `project=mall-demo`、`env=demo`。
  查询范围为北京时间 2026-10-21 15:14:00–15:15:17；精确毫秒及原始结果保存于
  `owl-reports/20261021-service-origin/game-new-visits.json`。
- 商城 APP 查询范围为北京时间 2026-10-14 15:08 至 2026-10-21 15:08，
  结果保存于同目录 `app-tags.json`；APK 发布清单与
  当前生成的 BuildConfig 都确认代理模式。BuildConfig 中直连模式的
  `RUM_ENV=prod` / `RUM_SERVICE=mall-app-android` 不生效，因为
  `RUM_DIRECT_ENABLED=false`。未改动或重装 APK。

已加载旧脚本的浏览器须刷新。修复仅影响新产生的数据，不回填历史空标签。

## 回滚或恢复

以下在管理主机执行。恢复旧 SDK Demo：

```sh
kubectl scale deployment/mobile-demo -n mobile-demo --replicas=1
kubectl rollout status deployment/mobile-demo -n mobile-demo --timeout=60s
```

撤销游戏静态覆盖（也用于正式镜像包含修复后清理覆盖层）：

```sh
kubectl patch deployment demo-observability-demo-game-service -n observability-demo \
  --type=strategic --patch-file=/root/game-rum-project-20261021/game-rollback.json
kubectl rollout status deployment/demo-observability-demo-game-service \
  -n observability-demo --timeout=60s
```

撤销后必须验证返回脚本及服务健康；先移除引用，再按需删除 ConfigMap。
