# RUM、Browser Logs、Replay 与 SourceMap

RUM 默认关闭。先在可观测平台创建 Web RUM 应用，取得非敏感的 application ID，再设置：

```bash
helm upgrade --install demo charts/observability-demo \
  --namespace observability-demo \
  --reuse-values \
  --set rum.enabled=true \
  --set-string rum.applicationId=YOUR_RUM_APPLICATION_ID
```

浏览器从 `GET /api/demo/rum-config` 获取开关、application ID、project、service/env/version 和同源 `datakitOrigin=/rum-proxy`。RUM、Browser Logs 与请求 baggage 统一使用 Helm 配置的 `project=mall-demo`；响应永远不包含 client token。order-service 将 RUM、Browser Logs 和 Session Replay 请求转发到当前节点 DataKit 的 `9529` 端口。

SourceMap 演示文件固定为 `assets/checkout-sourcemap-fault.min.js`。打包：

```bash
scripts/package-rum-sourcemap.sh --version 2.3.6
```

产物位于 `dist/observability-demo-rum-sourcemap-2.3.6.zip`，`dist/` 不进入 Git。脚本会同时输出上传所需的 Environment 和 Version；它们必须与 RUM 事件一致。本 Demo 默认 service 为 `mall-h5`，version 来自 `DD_VERSION` 或镜像 tag。

验证顺序：启用 RUM，打开商城，确认 View 与 Browser Log；启动 Replay 后产生交互；触发 `frontend_sourcemap_error`，检查错误栈是否还原到 `assets/src/checkout-sourcemap-fault.js`；最后确认前端 Resource 与后端 DDTrace 使用同一个业务请求上下文。

React Native 使用独立的 Android/iOS App ID、SourceMap、R8 mapping、Native 符号和 dSYM，不与 Web application ID 混用。移动配置、构建和验收见 [React Native 移动端 RUM Demo](mobile-rum.md)。
