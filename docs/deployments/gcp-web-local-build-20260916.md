# GCP Web 本地源码构建验收（2026-09-16）

按用户要求，从当前本地工作区构建并发布，包含未提交改动。
基线提交为 `4a1cbcc54612c3177bd748aaace3d92fe427dc0f`，发布版本为
`2.4.0-gcp-local-20260916`。源码快照、文件哈希及公网核对结果保存在
`dist/gcp-web-local-20260916/`。

## 发布范围

本地最新代码将游戏迁移至独立 Game 服务，因此同步构建和部署 Order、Gateway、Game。
镜像分别为 `observability-demo-{order,gateway,game}-service:web-complete-20260916`。
三个镜像采用 Java 17 普通运行时，Agent 由只读 `/datadog-lib` 挂载并通过唯一
`JAVA_TOOL_OPTIONS=-javaagent:...` 注入。沿用原 Agent 二进制，SHA256 为
`2682f18135bc52cca743a9326b913086697a9ac38d778f078eda0062f3d4a408`。

- GCP：`twt-gcp-integration / asia-east2-a / mall-demo-kvm-emulator-poc`。
- 发布目录：`/home/cherry/mall-demo-web/releases/web-complete-20260916`。
- 入口：<https://35.241.68.75.nip.io/business.html?lang=zh&scene=android-storefront&view=mobile>。
- APK 保持 2.3.23/code16，Payment、Inventory、MySQL、Redis 容器 ID 未改变。

## 验证

- Order 32、Gateway 12、Game 5 项 Java 测试通过；Android Web 控制 25 和游戏 12 项 Node 测试通过。
- 两处旧测试预期已同步至当前实际语言包版本和 Android 场景提示。
- 三个已安装 JAR 与本地构建 SHA256 一致。JAR 内全部 383 个静态文件与源码一致。
- 34 个公网资源与本地哈希一致；两个未公开原型页面按网关白名单仍返回 404。
- 公网配置和 Game API 正常；三个 Java 服务健康。
- 浏览器游戏大厅显示两个游戏入口；Android 控制台显示“Android异常”、商品详情白屏、结算闪退和请求成功但持续加载。
- 本轮没有重新注入故障或重复执行云端 Replay 验收；此前 APK 回放证据见 Android 故障验收文档。

匹配本次 Web 版本的 SourceMap 包已生成于
`dist/observability-demo-rum-sourcemap-2.4.0-gcp-local-20260916.zip`，未上传观测云。

## 回滚

在 GCP VM 上以 sudo 执行发布目录内 `backup/rollback-web.sh`。
脚本恢复此次 Web 更新之前的 Order/Gateway 配置并停止新增 Game 服务。
此次没有执行 Git 提交、推送或打标签。
