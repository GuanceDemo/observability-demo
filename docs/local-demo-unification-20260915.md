# 本地 Demo 服务统一

2026-09-15 按用户要求，将最新游戏大厅、真实开源植物关、15 fps 目标 Canvas 采集和工作台缩放整合到原有本地服务。

- 保留服务名 `observability-demo-gateway-service-1`、`observability-demo-order-service-1`，入口 18080。
- 使用最新 Maven JAR 更新原有本地镜像，保留其 JRE/Java agent 基础；没有推送镜像。
- `compose.local-games.yaml` 保存已验证的 game Application ID、demo 环境、版本与 RUM 接收端，只覆盖两个服务。
- 原有日志卷和数据库卷保持；MySQL、Redis、Inventory、Payment 容器均未重建。
- 已移除 `demo-game-hub-{gateway,order}` 和 `demo-game-hub-{gateway,order}-v2` 四个临时容器，不再使用 18766。

验证：18080 health=UP；商城会话接口、游戏 RUM 配置返回 200；工作台/大厅/植物页/采集脚本与源文件逐字节相同；347 个资源返回 200。浏览器真实登录、嵌套 iframe 开局、返回大厅成功，显示画面采集中。前序 44 项服务测试已经通过，本轮 Maven package 成功；未改变业务源代码。

回退镜像标签：`observability-demo-{order,gateway}-service:before-game-unify-20260915`。原容器配置备份位于 `dist/local-unified-backup-20260915/`，目录仅当前用户可读；未删除数据卷。

后续启动/更新见 README 的本地游戏 Compose 命令。正式 K8s、APK、模拟器未修改。
