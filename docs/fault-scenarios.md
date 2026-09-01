# 故障场景目录

公开控制接口只有：

- `POST /api/demo/faults/{scenarioId}/enable`
- `POST /api/demo/faults/off`
- `POST /api/demo/warmup`


| scenarioId | 执行 | 平台 | 场景 | 层级 / 目标 | 预期观察 |
| --- | --- | --- | --- | --- | --- |
| `frontend_click_error` | client | web | bookstore | 前端 / Browser | RUM Error、Browser Log、用户行为 |
| `frontend_slow_resource` | client | web | bookstore | 前端 / Browser | 慢 Resource 与页面体验 |
| `frontend_sourcemap_error` | client | web | bookstore | 前端 / 压缩 JS | SourceMap 还原源码与行号 |
| `mobile_white_screen` | client | android, ios | mobile-storefront | 前端 / RN root | 白屏开始、自动恢复和关联 Action |
| `mobile_js_error` | client | android, ios | mobile-storefront | 前端 / JS runtime | React Native Error、Log、SourceMap |
| `mobile_native_crash` | client | android, ios | mobile-storefront | Runtime / native main | 重启后上传并还原 Native 堆栈 |
| `mobile_android_anr` | client | android | mobile-storefront | Runtime / main thread | Android ANR/卡顿现场 |
| `mobile_ios_freeze` | client | ios | mobile-storefront | Runtime / main thread | iOS Freeze 现场 |
| `mobile_slow_network` | client | android, ios | mobile-storefront | 网络 / Gateway | 慢 Resource、DDTrace 与业务头关联 |
| `order_slow` | server | web, android, ios | bookstore, mobile-storefront | 服务 / order-service | 入口慢 Span、接口延迟 |
| `inventory_redis_timeout` | server | web, android, ios | bookstore, mobile-storefront | 依赖 / Redis | 依赖超时、错误 Span、关联日志 |
| `payment_slow` | server | web, android, ios | bookstore, mobile-storefront | 服务 / payment-service | 慢 Span、慢方法与 Profile |
| `payment_error` | server | web, android, ios | bookstore, mobile-storefront | 服务 / payment-service | HTTP 5xx、ERROR 日志、错误中心、错误率和失败 Trace |
| `payment_cpu_burn` | server | web, android, ios | bookstore, mobile-storefront | JVM / payment-service | CPU、JVM 与 Profile 热点 |
| `game_render_overload` | client | web | webgl-game | 前端 / WebGL 主线程 | 约 10 秒粒子风暴、12 FPS 持续掉帧、开始/恢复 Action、多段 Long Task 与 Replay 画面 |
| `game_asset_load_failure` | client | web | webgl-game | 前端 / 资源加载 | 缺失护盾纹理产生两次 404 Resource、一条 handled Error、失败/重试/恢复 Action 与约 10 秒 Replay 可见降级材质 |

示例：

```bash
scripts/inject-fault.sh inventory_redis_timeout
scripts/generate-traffic.sh
scripts/inject-fault.sh off
```

内部 `/admin/fault/**` 由 order-service 调用。Gateway 对外返回 404，且 chart 不为内部服务创建外部入口。

目录响应保留 `clientSide` 以兼容网页，并提供 `execution`、`platforms`、`scenes` 和 `expectedObservation`。工作台按当前 `scene` 过滤目录：商城显示 `bookstore` 场景，游戏显示 `game_render_overload` 与 `game_asset_load_failure`。渲染过载点击注入后自动运行约 10 秒，不需要额外游戏操作：粒子数量和场景负载上升，游戏绘制稳定下降到约 12 FPS，并用间隔约 250ms 的短 CPU 压力产生多段真实 Long Task；两次压力之间保留 Replay 采集机会。开始/恢复 Action 携带实际 FPS、掉帧数、粒子峰值和压力次数，不伪造 Error。

资源加载失败同样无需额外操作。游戏立即请求同源 `/api/demo/game-assets/orbital-shield-texture.webp`，该精确端点固定返回 404 且禁止缓存；约 5 秒后只重试一次。首次失败记录 `game_asset_load_failed` Action 与一条 handled Error，重试记录 `game_asset_load_retry`，两次 404 都由 RUM Resource 自动采集。飞船在约 10 秒内使用醒目的降级材质和 DOM 提示，随后切换到内置程序化备用材质并记录 `game_asset_fallback_recovered`。该方案限制为两次请求，避免制造持续 404 噪声。移动端用右侧抽屉触发本地/服务端场景，详见 [React Native 移动端 RUM Demo](mobile-rum.md)。
