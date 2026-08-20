# 故障场景目录

公开控制接口只有：

- `POST /api/demo/faults/{scenarioId}/enable`
- `POST /api/demo/faults/off`
- `POST /api/demo/warmup`


| scenarioId | 执行 | 平台 | 层级 / 目标 | 预期观察 |
| --- | --- | --- | --- | --- |
| `frontend_click_error` | client | web | 前端 / Browser | RUM Error、Browser Log、用户行为 |
| `frontend_slow_resource` | client | web | 前端 / Browser | 慢 Resource 与页面体验 |
| `frontend_sourcemap_error` | client | web | 前端 / 压缩 JS | SourceMap 还原源码与行号 |
| `mobile_white_screen` | client | android, ios | 前端 / RN root | 白屏开始、自动恢复和关联 Action |
| `mobile_js_error` | client | android, ios | 前端 / JS runtime | React Native Error、Log、SourceMap |
| `mobile_native_crash` | client | android, ios | Runtime / native main | 重启后上传并还原 Native 堆栈 |
| `mobile_android_anr` | client | android | Runtime / main thread | Android ANR/卡顿现场 |
| `mobile_ios_freeze` | client | ios | Runtime / main thread | iOS Freeze 现场 |
| `mobile_slow_network` | client | android, ios | 网络 / Gateway | 慢 Resource、DDTrace 与业务头关联 |
| `order_slow` | server | web, android, ios | 服务 / order-service | 入口慢 Span、接口延迟 |
| `inventory_redis_timeout` | server | web, android, ios | 依赖 / Redis | 依赖超时、错误 Span、关联日志 |
| `payment_slow` | server | web, android, ios | 服务 / payment-service | 慢 Span、慢方法与 Profile |
| `payment_error` | server | web, android, ios | 服务 / payment-service | HTTP 5xx、ERROR 日志、错误中心、错误率和失败 Trace |
| `payment_cpu_burn` | server | web, android, ios | JVM / payment-service | CPU、JVM 与 Profile 热点 |

示例：

```bash
scripts/inject-fault.sh inventory_redis_timeout
scripts/generate-traffic.sh
scripts/inject-fault.sh off
```

内部 `/admin/fault/**` 由 order-service 调用。Gateway 对外返回 404，且 chart 不为内部服务创建外部入口。

目录响应保留 `clientSide` 以兼容网页，同时新增 `execution`、`platforms` 和 `expectedObservation`。移动端用右侧抽屉触发本地/服务端场景，详见 [React Native 移动端 RUM Demo](mobile-rum.md)。
