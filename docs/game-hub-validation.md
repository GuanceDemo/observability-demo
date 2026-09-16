# 小游戏大厅本地实现与验收

> 植物教学实现已按用户纠正被实际开源引擎替换。当前版本见 [开源移植验收](pvz-upstream-validation.md)。本页保留上一版历史记录，不能用于证明当前植物实现。

验收日期：2026-09-15，Asia/Shanghai。代码保留在当前工作区；本次未发布正式 K8s，未修改 Android APK 或模拟器。

## 本地入口与运行环境

- 大厅：http://127.0.0.1:18766/game-hub.html
- 工作台：http://127.0.0.1:18766/business.html?lang=zh&scene=webgl-game&view=web
- 历史飞机地址：http://127.0.0.1:18766/webgl-replay-game.html
- 教学关：http://127.0.0.1:18766/plants-game.html

本次本地容器 `demo-game-hub-order` 和 `demo-game-hub-gateway` 使用已构建的
Order/Gateway JAR，Gateway 仅绑定 127.0.0.1:18766。Order 挂载当前 static
目录到 `/app/game-static`，修改页面后刷新即可。复用现有本地 Docker 网络、
数据库及 Redis；原 18080 服务保持运行。重启：

```sh
docker start demo-game-hub-order demo-game-hub-gateway
```

结束本轮本地演示：

```sh
docker stop demo-game-hub-gateway demo-game-hub-order
```

RUM application：`observability_game_demo`，service：`mall-game-h5`，环境：`demo`，
版本：`2.3.13-gamehub`。本地服务仅向既有采集入口发送验收遥测，未改云端部署配置。
将代码用于后续发布时，必须重新打包当次版本，不能沿用旧符号包。

## 实现

紧凑大厅保留两张已确认的生成封面、分类、搜索、按账号隔离的最近玩过，以及
「待上线」空卡片。真实登录复用商城 Cookie 和服务端账号列表；无模拟账号系统。
大厅可匿名浏览，独立游戏页面同样校验登录。跨页面退出/会话失效暂停游戏，
重新登录后手动继续。换账号或失效结束旧 run，恢复后生成新的 run_id。

飞机为原 ORBITAL DRIFT 横向自由移动、发射与小行星生存玩法，仅改可见名称
和大厅入口。保留 WebGL 插件、压力控制、渲染/资源故障和观测链接。
工作台 `webgl-game` 默认打开大厅，仅飞机运行时显示并启用飞机故障。

教学关是 3×9 DOM 草坪：初始阳光 150；向日葵 50、豌豆射手 100；每次阳光 25；
冷却 3 秒。三波分别 2/3/4 只普通僵尸，全清才进入下一波/胜利，越过左边界失败。
同一时钟管理生成、攻击、阳光与冷却；暂停冻结，重试清空，离开销毁。

上游：[MIT 源码固定提交](https://github.com/plantsvszombiesjs/plantsvszombiesjs.github.io/tree/edd9496907be1e73ce62eecf2316fdeed0b88368)。
改编实体模型、同路目标判断与碰撞方案，重写教学关时钟和波次逻辑。
许可证保留在 `docs/licenses/plantsvszombiesjs-MIT.txt` 和根目录第三方说明中。
游戏内使用 CSS/系统 Emoji，未带入原版商业资源包、排行榜或第三方嵌入页面。

## 自动验证

- Order 34 + Gateway 9 项 Maven 测试通过。
- Node 10 项：登录失败重试、失效身份与 run 边界；种植费用/冷却/占位；阳光
  一次性收集和过期；暂停冻结；三波全清；失败；重试/退出清理；静态资源/语法；
  精确源码 SourceMap 行映射。
- Gateway 逐个验证新增 HTML/JS/CSS/PNG GET/HEAD；POST、`.bak` 和未列出路径拒绝。
- 工作台、商城、新增页面内联脚本及游戏脚本语法检查；改动范围 whitespace 检查。

运行命令：

```sh
mvn -pl order-service,gateway-service test
node --test scripts/tests/*.test.cjs
bash scripts/package-rum-sourcemap.sh --version 2.3.13-gamehub
```

## 实际浏览器验收

| 项目 | 结果 |
|---|---|
| 未登录大厅/直接访问飞机 | 大厅可浏览；直达飞机弹出真实账号选择，未启动游戏 |
| 商城登录复用 | Chrome 登录 Reader B 后商城识别同一账号；游戏无需重复登录 |
| 浏览器独立 | 内置浏览器 Reader A 与 Chrome Reader B 同时存在 |
| 跨页面退出与失效 | 另一 Chrome 页面退出后，运行中的飞机暂停并弹出登录；重新登录可继续 |
| 登录失败重试 | 自动测试用 HTTP 503 验证弹窗保留、按钮恢复、重试成功；未人为中断共享服务 |
| 搜索/返回 | 搜索“飞机”只剩飞机；进入并返回后保留搜索条件 |
| 布局 | 桌面两游戏+空卡；390px 两列，最近玩过入口可用；教学草坪窄屏横向滚动 |
| 植物玩法 | 实际种植向日葵及三行射手、收集阳光，观察资源不足/冷却提示、暂停/继续 |
| 植物胜败 | 实际打通三波显示“守护成功”；重试后不防守触发“僵尸突破了防线” |
| 飞机渲染故障 | 工作台两层 iframe 转发成功，10.007 秒后恢复；实际 10.5 FPS，832 掉帧，40 次 CPU burst |
| 飞机资源故障 | 真实两次 404，约 10.003 秒后备用材质恢复 |
| 返回/退出 | 子 iframe 卸载；工作台回到大厅即收回故障入口；引擎清理另有单测覆盖 |

## 云端 RUM / Replay

查询覆盖范围：2026-09-15 11:00–13:10（UTC+08:00），实际操作从 12:48 开始；
约 13:02 播放最终结算。查询均使用当时向前 2 小时的窗口。
数据域 RUM（R::view / R::action / R::resource / R::long_task），使用 Owl 只读查询与云端控制台。
原始成功响应见 `owl-reports/game-hub-20260915/`；查询返回的 result/run 字段可能
分列为同 timestamp 的记录，依据相同 time 与事件关联，不能只看 shell 退出码。

核对到三个命名 View、用户 A/B、版本 `2.3.13-gamehub`、game_id/level_id/run_id，
种植/阳光/波次/暂停/继续，以及正常胜败 game_end。普通胜败没有作为 Error 上报。
飞机故障保留真实 Resource 和 handled Error；云端另已查到真实 Long Task 记录。
当前查询返回的 Long Task 归在大厅 View，飞机故障本身的开始/恢复 Action 则归在
飞机 View；不将本地 CPU burst 计数等同于云端长任务条数。不为无请求动作伪造 Trace。

- 会话 A：`2229e3a8-c2f7-46f0-97ab-f3e1e9edc8da`
- 飞机 View：`2549c1f7-d7d9-409e-acee-48abc8905ed7`
- 植物 View：`e37dc580-de14-4f96-96ec-a679e30fc4cf`
- 胜利 run：`e1746824-bdcd-4890-8c67-a079099a570a`，time `1789447952653`，result `victory`
- 重试失败 run：`2a9e71c1-f9f0-4ff7-838a-ca0363153c0e`，time `1789448318856`，result `defeat`

[实际回放](https://console.guance.com/rum/sessionReplay?app_id=observability_game_demo&view_id=2549c1f7-d7d9-409e-acee-48abc8905ed7&session_id=2229e3a8-c2f7-46f0-97ab-f3e1e9edc8da&ts=1789447714368&w=WORKSPACE_ID&lak=Rum)：
实际播放飞机飞船/小行星画面；定位植物种植事件看到向日葵、射手、移动僵尸和阳光；
04:07 回放画面显示第三波全清与“守护成功”。初次索引尚未齐全时会话信息曾提示失败，
刷新后已显示 Reader A 和会话时长并正常回放。飞机旧诊断计数仍显示 0，实际云端
WebGL 画面可播放，验收不依赖该旧计数。

## Web SourceMap 交付

`dist/observability-demo-rum-sourcemap-2.3.13-gamehub.zip` 包含原商城故障符号和
`game-runtime.js`、`game-hub.js`、`plants-engine.js`、`plants-game.js`、
`webgl-replay-game.js` 的精确源码及 v3 行映射。上传环境 `demo`，版本
`2.3.13-gamehub`，保持压缩包内 `assets/` 路径。按约定由用户上传，本次未代上传。
当前游戏脚本未压缩，映射保留真实源文件行号；后续压缩构建须使用对应构建器符号。

## 2026-09-15 工作台 iframe 缩放

本地游戏 Demo 的入口为 game-hub.html。修正此前仅商城启用固定桌面缩放的条件，
游戏也复用内部 1512px 宽、按外框宽度统一缩放、反算 iframe 高度的现有实现。
实际验证外框 522px 时 scale=0.345238，802px 时 scale=0.530423，内部宽度均为 1512px。
在嵌套 iframe 中开始植物关，点击种植后阳光 200→150；改变窗口尺寸后游戏和种植状态保留，
返回大厅正常。Order 34 / Gateway 10 测试、内联脚本解析和 scoped diff 检查通过。
本次仅本地，未发布正式 K8s。入口：
http://127.0.0.1:18766/business.html?lang=zh&scene=webgl-game&view=web

## 2026-09-15 栏目折叠 ResizeObserver 修复

用户提供旧 18766 会话中的 `ResizeObserver loop completed with undelivered notifications`。
代码检查发现工作台 observer 同步修改 iframe 尺寸，植物 viewport observer 也同步写高度。
修正为每帧合并写入、仅在尺寸变化时修改，退出时取消待执行 RAF。没有屏蔽浏览器 Error 或 RUM。
新增回归测试证明通知不会同步写布局、多通知合并、尺寸稳定时不重复写入以及移动模式清理。
Order 34 + Gateway 10 + Node 14 项测试通过；已打包并更新原有 18080 Order，三份线上本地静态文件逐字节匹配源码。
浏览器实测未完成：浏览器工具两次因 request-header policy 加载失败而无法打开验证页面。
因此本轮确认代码风险点已修正、测试通过，不能宣称浏览器/云端错误已实测归零。
