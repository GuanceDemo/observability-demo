# RUM、Browser Logs、Replay 与 SourceMap

RUM 默认关闭。先在可观测平台创建 Web RUM 应用，取得非敏感的 application ID，再设置：

```bash
helm upgrade --install demo charts/observability-demo \
  --namespace observability-demo \
  --reuse-values \
  --set rum.enabled=true \
  --set-string rum.applicationId=YOUR_RUM_APPLICATION_ID
```

浏览器从 `GET /api/demo/rum-config` 获取开关、application ID、project、service、`gameService`、env/version 和同源 `datakitOrigin=/rum-proxy`。商城使用 `service=mall-h5`，ORBITAL DRIFT 使用同一个 Web Application ID 和独立的 `service=mall-game-h5`；可以分别通过 `RUM_SERVICE`、`RUM_GAME_SERVICE` 或 Helm 的 `rum.service`、`rum.gameService` 覆盖。RUM、Browser Logs 与请求 baggage 统一使用 Helm 配置的 `project=mall-demo`；响应永远不包含 client token。order-service 将 RUM、Browser Logs 和 Session Replay 请求转发到当前节点 DataKit 的 `9529` 端口。

工作台 URL `business.html?scene=webgl-game&view=web` 会把游戏以同源 iframe 紧凑嵌入；独立打开链接保留完整实验页。游戏在读取运行时配置、加载当前 Guance/TrueWatch CDN 的 RUM SDK 与 WebGL 插件并完成 `init()` 后，才启动游戏并创建 WebGL Context。默认使用面向演示流畅度的高帧率档位：20 FPS、WebP、质量 0.72、最大画布 1280、单帧 160 KB 与 50 ms 采集间隔；页面仍可切换为低成本或小流量验证档位。嵌入模式下右侧遥测面板在可视高度内独立滚动。RUM 关闭、SDK 加载失败或 WebGL 不可用时，页面会显示降级状态但不会阻断其余可用功能。

SourceMap 演示文件固定为 `assets/checkout-sourcemap-fault.min.js`。打包：

```bash
scripts/package-rum-sourcemap.sh --version 2.3.6
```

产物位于 `dist/observability-demo-rum-sourcemap-2.3.6.zip`，`dist/` 不进入 Git。脚本会同时输出上传所需的 Environment 和 Version；它们必须与 RUM 事件一致。本 Demo 默认 service 为 `mall-h5`，version 来自 `DD_VERSION` 或镜像 tag。

验证顺序：启用 RUM，打开商城，确认 View 与 Browser Log；启动 Replay 后产生交互；触发 `frontend_sourcemap_error`，检查错误栈是否还原到 `assets/src/checkout-sourcemap-fault.js`；最后确认前端 Resource 与后端 DDTrace 使用同一个业务请求上下文。

WebGL Replay 验收：切换到“游戏 Demo”，确认手工 View 名为 `game/orbital-drift`，上下文包含 `project=mall-demo`、`business_scene=webgl-game`、`preview_mode=web`，service 为 `mall-game-h5`。注入 `game_render_overload` 后无需继续操作游戏；约 10 秒内应看到粒子风暴、HUD FPS 降至约 12、飞船和陨石持续掉帧，但 Replay 仍有连续画面。相同 View 时间轴应包含 `game_render_overload_started` Action、多段约 65ms Long Task、`game_render_overload_recovered` Action，恢复 Action 包含 `actual_fps`、`dropped_frames`、`particle_peak`、`cpu_bursts` 和 `duration_ms`。Guance 与 TrueWatch provider 都应各验证一次，并确认 Replay 继续通过同源 `/rum-proxy` 上传。

资源故障验收：注入 `game_asset_load_failure` 后，飞船应立即变成粉色降级材质并持续约 10 秒，页面提示一次 5 秒重试，随后自动恢复内置材质。相同 View 中应出现两条 `/api/demo/game-assets/orbital-shield-texture.webp` 404 Resource、一条 handled `GameAssetLoadError`、`game_asset_load_failed`、`game_asset_load_retry` 与 `game_asset_fallback_recovered` Actions；恢复 Action 包含 `attempts=2`、`http_status=404`、`duration_ms`、`fallback_material=procedural-shield-v1` 和同一 `trigger_id`。

游戏资源基于固定上游提交移植，许可证和版本记录见 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。

React Native 使用独立的 Android/iOS App ID、SourceMap、R8 mapping、Native 符号和 dSYM，不与 Web application ID 混用。移动配置、构建和验收见 [React Native 移动端 RUM Demo](mobile-rum.md)。
