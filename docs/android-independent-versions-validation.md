# Android 独立版本配置验证

2026-09-10，本地实现，未提交或部署。

- Helm / Compose / Spring 配置 / `/api/demo/config` / 工作台使用同一组运行时元数据。
- `playerVersion` 和 `apkVersion` 默认空，`apkMinAndroidVersion` 默认 `7.0`。未启用有效 HTTPS 播放器时 API 不发布版本字段。
- 标准播放器路径允许覆盖 `v`；未配置版本时保留原 URL 的 `v`，自定义路径不覆盖。APK 与二维码的固定路径使用 APK 版本缓存参数。
- 下载说明通过中英文翻译模板生成。空版本显示通用说明；无效前端版本值不会写入页面，非法后端版本配置拒绝启动。
- Java/RUM 版本维持原有字段。版本元数据不会构建、上传或安装 APK，也不选择历史文件。

验证结果：

| 检查 | 结果 |
| --- | --- |
| `mvn -pl order-service test`（Java 17） | 34 项通过 |
| `node --test scripts/android-webrtc/tests/*.test.mjs` | 22 项通过；增强中英文实际模板测试后该测试文件 2 项再次通过 |
| `helm lint charts/observability-demo` | 通过，仅已有 icon 建议 |
| EKS 默认与 Android 配置后的 Helm Deployment 对比 | 只有 order-service 的三个 Android 环境变量值变化；所有 Java image、DD_VERSION 和其他 Deployment 保持一致 |
| `docker compose config --quiet` | 通过 |
| business / shop 内联 JavaScript 语法 | 通过 |
| `node mobile-app/scripts/sync-storefront-data.mjs --check` | 通过，重生成规范源校验头 |
| scoped `git diff --check`（排除既有 patch 文件） | 通过 |

首次部署需要包含此功能的新 order-service 镜像。之后发布播放器或 APK 时，可独立发布文件并更新 Helm 值，无需重建 Java 镜像；环境变量更新可能滚动重启 order-service。操作说明见 [Android 独立版本配置](android-emulator-webrtc.md#android-独立版本配置)。
