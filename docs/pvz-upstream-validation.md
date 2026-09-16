# 植物大战僵尸实际开源源码移植

2026-09-15，Asia/Shanghai。根据用户纠正，移除上一版自写 Emoji 教学玩法，改为
直接使用 [Yang Yunhe 的 H5 植物大战僵尸](https://github.com/yangyunhe369/h5-game-plantsVSzombies)，
固定提交 `79fb2aeeffe7358100af01cee01c3813495bea85`。

## 交付内容

入口：http://127.0.0.1:18766/plants-game.html；大厅仍为同端口 `/game-hub.html`。
保留上游 4 个 JS 文件定义的 Game/Main/Plant/Zombie/Animation 等真实类，344 张
上游动画/背景/卡片素材、7 种植物、5 行草坪、除草车、攻击与死亡动画。
初始 200 阳光、植物价格与自动收集机制沿用上游；单关配置限定 9 只普通僵尸。
这是社区开源 H5 实现，不宣称是 PopCap 官方源码或原商业游戏的关卡数据。

原始代码、MIT 许可证、图片和源码 hash、生成方法及全部适配点在
`third-party/pvz/`。生成脚本可重复生成服务端 bundle；攻击/移动/死亡判定来自
上游，适配层负责登录、RUM、指针缩放和计时器生命周期。

## 本地环境

运行容器：`demo-game-hub-order-v2`、`demo-game-hub-gateway-v2`，仅监听
127.0.0.1:18766。旧本地两个 game-hub 容器已停止并保留；原 18080 服务、正式
K8s、APK、模拟器均未改动。新容器复用本地网络/数据库和已有采集入口，挂载
当前 static 目录供刷新验证。

```sh
docker start demo-game-hub-order-v2 demo-game-hub-gateway-v2
# 停止本次演示
docker stop demo-game-hub-gateway-v2 demo-game-hub-order-v2
```

RUM application `observability_game_demo`，环境 `demo`，版本
`2.3.13-pvz-source`，View `games/plants-vs-zombies/level-1`。

## 验证

- 本地真实登录成功，资源加载完成后才启动原始引擎。
- 实际种下上游向日葵、豌豆射手和樱桃炸弹；观察僵尸移动、自动阳光、原始攻击
  与除草车清理；9 只全部清完后显示“第一关胜利”。
- 重试后还原到 200 阳光、0/9 出场，旧植物/任务清空；暂停/继续通过统一时钟。
- 小窗口缩放后点选植物及草坪成功；使用 ResizeObserver 同步可用宽度。
- 自动测试直接运行原始攻击、死亡与胜负逻辑，覆盖计时暂停/清理、卡片冷却、
  bundle 可重复生成和 344 个素材 hash；共享登录失败重试与身份边界测试保留。
- Gateway 清单包含 347 个精确新增文件路径：只放行 GET/HEAD，POST、`.bak`
  与未列出图片拒绝。无 `/assets/pvz/**` 通配放行。

原始文件和适配 bundle均本地托管，运行期间不嵌入或调用第三方游戏网站。

## 回放采集修复

第一次验收发现 numeric Canvas sampling 只保持首屏位图，虽有 Actions 但不能
证明实际游戏画面已录到。尝试 `replayCanvasSampling: 'all'` 后云端出现黑屏，未作为验收通过。
最终配置使用 WebP 连续快照，并将单帧容量提高到 256000 字节；SDK 在
创建 2D context 前初始化，沿用用户输入隐私设置。

## SourceMap

`dist/observability-demo-rum-sourcemap-2.3.13-pvz-source.zip`，上传环境 `demo`，
版本 `2.3.13-pvz-source`，由用户上传。包含真实上游 bundle、计时器、游戏适配、
大厅、飞机及共享 runtime 的精确源码/行映射。本次未上传、未发布正式环境。

## 自动检查与云端事件证据

- 2026-09-15 本地 Order 34、Gateway 10、Node 11 项测试全部通过。
- 347 个清单路径逐个通过本地 Gateway HTTP GET，全部返回 200。
- SourceMap 包的六个 JS 与最终 static 源文件逐字节一致。
- Owl 在 R 数据域查询实际 `2.3.13-pvz-source` 事件，先通过 DQL 校验；
  查询成功，工作空间配置查询后已恢复。原始证据位于
  `owl-reports/pvz-upstream-20260915/actions.json` 与 `views.json`。
- 实际用户 `demo-reader-001`、View `games/plants-vs-zombies/level-1`；
  通关 run `891f2add-9591-49fa-ac1d-2c29cd820273` 在
  2026-09-15 14:14:17.343 +08:00 记录 `result=victory`。
- 修复窄屏按钮聚焦造成隐藏容器滚动：游戏视口改为 overflow:clip，
  实测完整显示五行草坪，种植命中正确。

## 历史失败记录：云端 Canvas 动态画面

2026-09-15 14:30–14:34 +08:00 再次实际打开并播放云端会话，最新版
View `eac874b5-2dcf-4c26-9f03-6406d4fac259`，Session
`2229e3a8-c2f7-46f0-97ab-f3e1e9edc8da`。播放器显示种植/出场等真实
Actions，但绘制仍停留在封面或黑屏，尚未看到可靠的移动画面。
因此本次只确认本地开源游戏和 RUM 事件采集通过，**Canvas Replay 不通过**。
不能用前一版 Emoji DOM 回放的验收替代本次结果。还需区分 SDK 快照上传与
云端播放器对连续 2D 画面重建的问题，不能据当前证据断言根因已修复。

## 2026-09-15 Canvas 黑屏修复与性能优化验收

上述失败由本节的实际播放结果更新。改为 SDK `snapshotCanvas` 手动采集真实 Canvas，
每秒最多 2 次，最长边 800、WebP 质量 0.5、编码预算 60000 bytes；仅有新绘制时
采集且只允许一个编码任务在途。较大画面实测返回 `record_rejected`，不能把
SDK 已连接误报为画面已录制。生产 SDK 的 debug history 为桩函数，空数组不能
用于判断是否采集。压缩请求选项未作为本次修复依据或改动保留。

渲染定时器在掉帧后合并重复绘制，独立的出怪、冷却时间仍按原规则运行；
进度 DOM 仅在数值变化时更新。该优化减少额外绘制/编码工作，未作 FPS 提升百分比承诺。

实际云端播放 Session `dc6d6687-bc50-4e63-8c7c-0055b3c348b4`、
View `8a6fbfd9-28d0-495c-84a2-c88119841a04`，run
`06837dda-1f56-481a-b9f7-bfc213800345`，用户 `demo-reader-001`，
版本 `2.3.13-pvz-source`。起初云端提示暂无回放，等待处理后刷新可播放，
本地 replay POST 返回 200 不等于云端已完成索引。

- 00:01:00 画面显示草坪、卡片和右侧僵尸。
- 连续播放至 00:01:11，显示已种植的向日葵、豌豆射手及子弹；僵尸位置向左变化，另一个僵尸入场。
- 播放后续阳光收集、暂停和返回大厅，录像最终显示大厅。
- 这是实际开源 Canvas 画面，不是 DOM 代绘；2 fps 是回放采集频率，不限制游戏帧率。
- 本轮验证动态种植/移动/退出画面；胜负画面的单独录像未在本轮重新验收。

[云端回放](https://console.guance.com/rum/sessionReplay?app_id=observability_game_demo&view_id=8a6fbfd9-28d0-495c-84a2-c88119841a04&session_id=dc6d6687-bc50-4e63-8c7c-0055b3c348b4&ts=1789455110104&w=WORKSPACE_ID&lak=Rum)

Order 34、Gateway 10、Node 13 项检查通过，SourceMap 包已按最终源码重新生成。
修复仅应用本地静态资源，不发布正式 K8s、不修改 APK/模拟器。历史未录到的画面不能补回。

## 2026-09-15 演示流畅度修正

用户明确指出 2 fps 不满足演示。此前黑屏修复验收仅证明画面恢复，不代表流畅度合格。
现在手动快照目标改为 15 fps（1000/15 ms），保留 800px / WebP 0.5 / 60000 bytes
和单个编码任务在途；不补采积压帧。状态文字成功时仅在变化后赋值，避免每帧制造 DOM 变更。
`replayCanvasSampling` 是 auto 模式参数，不决定本页面的手动频率，已移除误导性配置。

2026-09-15 15:08:53 至约 15:11:15 +08:00，在本机 Chrome 实际运行原版游戏并种植、
暂停、返回大厅。约 95.68 秒内 SDK 接收 1309 帧、拒绝 0 帧，约 13.68 fps；
游戏绘制 5688 次，约 59.45 fps。异步编码总耗时 70001.9 ms（平均约 53.5 ms/帧），
该时间包含异步等待，不能当成主线程 CPU 时间。暂停后没有持续采集静止画面。
诊断使用 `?replayDiagnostics=1`，每 5 秒将累计数据写入状态元素 data 属性，
不逐帧上报 RUM Actions；正式普通入口不启用该诊断。

云端实际播放 View `fa1ce0c6-3709-4338-a4f4-eb365a784012`，Session
`dc6d6687-bc50-4e63-8c7c-0055b3c348b4`，版本仍为本地未发布的 `2.3.13-pvz-source`。
同一 Session 包含此前 2 fps 试验，**新片段从 00:17:31 开局，00:18:05–00:19:00 为运动/种植片段**。
已看到植物和僵尸持续运动，无黑屏。在播放器 1x 下对游戏区域连续截取 40 张图，
2914 ms 内相邻图像变化 34 次，观测约 11.7 次/秒；此为截图采样下限，不能声称精确云端 FPS。
这验证了云端更新频率已超过 2 fps；是否满足用户现场演示的主观要求仍由用户试听观看判断，
不宣称已经达到 30/60 fps 视频效果。更高采集频率也会增加上传流量。

查询使用 Owl R 数据域，DQL 校验有效后查询 View，结果 success=true；查询后恢复原工作空间。
原始数据与测量摘要位于 `owl-reports/pvz-replay-smoothness-20260915/`。
本轮 Order 34 + Gateway 10 + Node 13 项检查通过，入口内联脚本和精确符号包检查通过。
更新本地 cache key v6 与匹配 SourceMap；正式 K8s、APK、模拟器均未变更。

## 2026-09-15 30 fps 采集优化

在统一的本地 18080 服务上部署 cache key v8。针对不透明的 PvZ 画布，
将 WebP 800px/0.5 改为 JPEG 640px/0.65，手动采集目标 30 fps，
仍保留单编码在途和 60000 bytes 帧预算。降低回放分辨率换取编码速度；
实际游戏画布分辨率与原版 60 Hz 逻辑不变。采集时钟对齐截止时间，
跳过迟到槽位，避免 60 Hz 绘制的时序舍入将采集降为 20 Hz，也不补采积压帧。

本机 Chrome 连续有效窗口 165.1459 秒，绘制 9897 次（59.93 fps）、
SDK 接受 4941 帧（29.92 fps）、拒绝 0 帧；平均异步处理 7.68 ms/帧，
此前 WebP 为约 53.5 ms。此耗时包括异步等待，不等于主线程 CPU 时间。
诊断计数通过 DOM data 属性读取；仅诊断 URL 启用。

已实际播放本轮 JPEG 云端片段 00:08:18–00:08:39，看到草坪、种植及僵尸移动，
没有黑屏。1x 播放时连续截取游戏区域 45 张图，3290 ms 内相邻图像变化 42 次。
截图采样速度不足 30 Hz，这只能验证连续更新，不能宣称云端播放器精确达到 30 fps。

[本轮云端回放](https://console.guance.com/rum/sessionReplay?app_id=observability_game_demo&view_id=b57f2798-67ec-445a-aa24-360ec6f2286a&session_id=4fd8731b-7972-4dae-9ccc-8e63758cb9e6&ts=1789458603741&w=WORKSPACE_ID&lak=Rum)

Owl 查询确认 View、版本和本地 URL，查询后恢复原 workspace profile。
原始查询及测量数据在 owl-reports/pvz-replay-30fps-20260915/。
Order 34、Gateway 10、Node 15 项检查全部通过；新增采集时钟测试覆盖稳态
30 Hz 和长时间卡顿后不追帧。已重新生成版本 2.3.13-pvz-source 的 SourceMap 包，
由用户上传；正式 K8s、Android APK 和模拟器未变更。

## 2026-09-15 回放清晰度修正

用户拒绝 640px JPEG 的画质。原 Canvas 是 1400×600，而显示窗口截取其中 900px，
因此旧快照可见部分仅约 411px，再被播放器放大。此轮最终采用分层：
原始 background1.jpg 作为 DOM 图片，以与 Canvas 相同的 -120px 偏移置于底层；
Canvas 保持原版逻辑和尺寸，只绘制原版角色、卡片、阳光计数、子弹和结果。
重试时隐藏背景，场景启动后显示，透明 Canvas 覆盖其上。

动态层采用 1000px / WebP 0.85 / 44000 bytes，单次编码在途，目标上限仍为 30 Hz。
背景不再逐帧缩小或压缩；动态层可见像素较旧版提高约 56%。
曾测试整帧原始分辨率 JPEG/WebP，以及分层 PNG，出现 encode_too_large，
没有将这些失败候选作为最终验收。临时像素和编码探针已删除。
最终只保留可选诊断中的拒绝原因，不新增逐帧 Action。

2026-09-15 16:13–16:15 左右，本机 Chrome 在两株植物及逐步生成到 6 只僵尸的回合中，
有效窗口 60.0548 秒，采集 1032 帧（17.18 fps）、拒绝 0，
游戏绘制 3592 次（59.81 fps）。平均异步编码约 54.14 ms，
不能作为主线程 CPU 时间。此版本明确以清晰度优先，未维持旧版 29.9 fps 采集。

实际播放云端新片段 00:31:45 开始，00:32:12 后观察到原图背景、
两株植物和持续移动的僵尸，无黑底；连续 35 次截图在 2954 ms 内变化 33 次。
只将此作为持续运动验证，不声称精确播放器 FPS。

[清晰版回放](https://console.guance.com/rum/sessionReplay?app_id=observability_game_demo&view_id=5edb97a6-47eb-4961-a627-e6f41c66cb1a&session_id=4fd8731b-7972-4dae-9ccc-8e63758cb9e6&ts=1789460016956&w=WORKSPACE_ID&lak=Rum)

Owl R View 查询先校验 DQL，读取结果 success=true，并恢复原工作空间。
原始数据位于 owl-reports/pvz-replay-clarity-20260915/。
Order 34、Gateway 10、Node 16 项通过；新增背景复位和上游阳光绘制回归检查。
最终 cache key v17（较验收 v16 仅注释/缓存标识更新），本地 18080，
匹配 SourceMap 已重新生成，用户上传；正式 K8s/APK/模拟器未变更。
