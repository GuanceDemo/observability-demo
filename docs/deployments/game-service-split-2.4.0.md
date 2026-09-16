# game-service 拆分与本地验收（2.4.0 候选）

游戏后端已从 Order 拆分为独立 Spring Boot 模块 `game-service`，内部端口 8084。
现有本地 `observability-demo` Compose 项目已更新，统一入口仍为
`http://127.0.0.1:18080/business.html?lang=zh&scene=webgl-game&view=web`。
本次没有更新 GCP 或正式 K8s。代码已准备提交并推送 main；tag 由用户执行，SourceMap 仍由用户上传。

## 服务边界

| 内容 | 服务 |
| --- | --- |
| 游戏大厅、飞机、植物游戏页面及全部专属静态资源 | Game |
| `/api/games/rum-config`、`/api/games/faults` | Game |
| `/api/games/assets/orbital-shield-texture.webp` 与历史 `/api/demo/game-assets/orbital-shield-texture.webp` | Game，保留真实 404 故障 |
| 商城页面、工作台、20 个商城故障 | Order |
| `/api/demo/auth/session` 与现有 `/rum-proxy` | 继续共用 Order 的账号与采集代理 |

Game 不引入 JDBC、MySQL、Redis 或 Order Java 依赖，也不新建账号数据库。
因此账号和共享采集代理仍有既有服务依赖；独立服务不代表复制一套登录系统。
前端 RUM 继续使用 `game-web` 身份，后端 DD_SERVICE 使用 `game-service`。
工作台分别加载商城、游戏故障目录，任一目录失败不会隐藏另一边。

## Gateway 白名单

`PublicRoutePolicy` 保留精确路径与 GET/HEAD 方法限制。通过校验且 routeId 为
`game.*` 的请求转发至 `GAME_URL`；其他既有路由保持原服务归属。
新增游戏配置、故障目录及故障资源接口，历史飞机 URL 保持兼容。
PvZ 文件继续受资源清单限制，没有开放整个 `/api/games/**` 或静态目录。
测试遍历 Game 模块全部静态文件，确保每个文件都有显式游戏路由；同时测试
未授权路径和 POST 被拒绝，以及共享登录 Cookie 仍传给 Order。

## 部署与 Agent

Compose、Helm、发布镜像矩阵和 Kind CI 已包含第五个 Java 服务。
固定旧版 Workshop profile 禁用 Game，保留 legacy Agent 模式。
五个 2.4.0 候选镜像均为普通 Java Entrypoint，Agent 由运行时外部注入。

本地首次复制 Agent 到 Docker 命名卷时发现非 root 无写权限，已修正一次性
`ddtrace-init`：仅复制容器使用 root，根文件系统只读、capabilities 全部移除；
应用保持非 root，Agent 卷只读。复制成功退出 0 后，五个服务正常启动。
K8s 保持既有 fsGroup 与非 root init 方式。原 MySQL/Redis 容器未重建。

## 验证记录

- 59 项 Java 测试通过（全模块构建后补充 Gateway 全资源路由测试）。
- 41 项既有游戏/Web/player 检查及 2 项故障目录失败隔离测试通过。
- 6 项外部 Agent 契约、9 项 Workshop 检查通过，Helm 默认与 Operator lint 通过。
- 五个本地候选业务镜像构建完成，服务启动并可经原 18080 访问。
- HTTP 独立 Cookie 会话验证：真实商城登录、三张游戏页面、PvZ 图片、共享
  会话保留、Game RUM 配置、历史资源真实 404、退出均通过。
- 浏览器确认工作台大厅封面、两张游戏卡片及登录弹窗正常；本轮未完成浏览器
  实际游戏操作和云端 Replay 重验，不把 HTTP 成功作为云端验收。
- JAR 检查：Order 不再包含游戏大厅、飞机页面或 PvZ；Game 不包含商城或 MySQL 驱动。
- `dist/game-service-split-2.4.0/http-validation.json` 保存 HTTP 验收结果。
- 五镜像元数据与源码清单更新至 `dist/ddtrace-migration-2.4.0/`。
- Web 符号包已从拆分后的文件路径重新生成：
  `dist/observability-demo-rum-sourcemap-2.4.0.zip`，仍由用户上传。

正式发布继续遵循 [统一迁移说明](ddtrace-operator-migration-2.4.0.md)，需完成
真实集群 admission、完整 Trace/JVM/Profiler 和云端游戏 Replay 验收。
