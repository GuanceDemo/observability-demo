# Android sidebar UI alignment — 2026-09-15

The GCP Android workbench now uses the Mall fault panel styles: layer/scenario
buttons, selected description, actual active fault, inject/recover buttons and
observation links. Connection, transport, FPS and device metrics are collected in
`apkDiagnostics`, a bottom native details element closed by default. Metric
updates preserve its expanded state. APK catalog and command protocol are unchanged.

## Release
- Web/Order version: `2.3.15-android-sidebar`.
- Image: `observability-demo-order-service:android-sidebar-20260915-final`.
- GCP release: `/home/cherry/mall-demo-web/releases/android-sidebar-20260915`.
- Only Order is recreated; existing Gateway, player, bridge and APK 2.3.17 retained.
- Source archive: `dist/observability-demo-rum-sourcemap-2.3.15-android-sidebar.zip`;
  prepared for user upload, not uploaded.
- Original overlay is recorded in `previous-overlay.txt`, with protected
  `compose.previous.json`. To roll back, use the existing root compose and that
  overlay to recreate Order only, then restore the default overlay symlink.

## Verification
- 34 Order tests and 25 Web/player tests pass; inline business/shop scripts parse;
  `git diff --check` passes.
- Public HTML/i18n bytes match local source; runtime configuration identifies
  the new Web version and unchanged APK/player versions.
- Browser confirmed default-closed diagnostics, expansion and collapse, actual
  APK catalog, selection of 加购无反馈, and backend grouping of 订单入口慢响应,
  支付慢方法 and 支付 5xx 错误.
- Unit coverage checks disabled dangerous scenarios, layer/selection changes,
  stale-state controls and retained safe observation links.
- During acceptance the APK initially returned an empty catalog. A GCP request
  to its configured backend timed out after 15 seconds; reconnecting the APK
  subsequently loaded the real catalog. This transient backend connectivity
  issue is separate from UI rendering; no fallback catalog is fabricated.
- No new fault injection or cloud Replay playback was performed for this UI-only
  change. The prior end-to-end control acceptance remains in
  `android-web-control-gcp-20260915.md`.

## Follow-up: remove duplicate replay entry
User requested removal of the separate session replay button. Removed its DOM
node, rendering reference and translation keys; RUM View and Trace remain.
Web release `2.3.15-android-sidebar-r2` uses GCP release directory
`android-sidebar-r2-20260915` and image
`observability-demo-order-service:android-sidebar-r2-20260915-final`.
The release retains the previous overlay for rollback. 34 Order and 25 Web/player
checks pass. Matching symbols are packaged locally with the r2 version; no upload.
