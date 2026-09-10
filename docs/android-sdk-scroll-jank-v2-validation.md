# Android SDK 永久 ID 遍历优化验证（第二版）

2026-09-10，约 11:10–11:21（Asia/Shanghai），小米 14 / Android 16。

## 结果

保持永久 ID、RUM 和 Replay，第二版在本轮三次各 30 秒的首页滑动中，
P95 从第一版的 22/20/20ms 降至 16/16/15ms，三轮均值下降约 24.2%；
P99 从 27/25/25ms 降至 20/19/18ms，均值下降约 26.0%。
这不是零掉帧：120Hz 的帧预算约 8.3ms，仍有帧超过截止时间。

## 修改范围与语义

- 保留第一版动态 View ID 跳过不存在资源查询的规则。
- 在一次同步 UI 快照内复用祖先路径，每个父节点一次扫描统计同类兄弟序号。
- 每个快照创建独立上下文，finally 释放；嵌套恢复外层，其他线程不可见。
- 包名、screen/context 回退仍按目标 View 计算，转义、兄弟类型比较、MD5 不变。
- 作用域外与普通 RUM action 仍按原路径即时计算；没有跨帧 View/路径缓存。
- 保留 Replay 解析失败返回 null 的容错，不让自定义 View 属性异常中断回放。

本地依赖为 `ft-sdk:1.7.5-jankfix02` + `ft-session-replay:0.1.8-jankfix02`，
需配套使用，默认构建仍选择官方依赖。编译替换四个 class（包括新增 Snapshot），
其余 AAR/class 内容保持原字节。源码与用法见
`mobile-app/sdk-patches/ft-sdk-1.7.5/README.md`。

约束：mapper 不应在同一次同步 UI 快照中修改 View 身份/层级；帧间的重排、
重挂、改 ID 和页面变化会在新上下文中重新计算。异步 mapper 回调不共享缓存。

## 同设备对照

相同 Safe Release 2.3.12 / code 5、Hermes/R8、arm64、profileable；
业务 JS bundle 逐字节一致，沿用原 Gateway/RUM 配置和应用数据。
第一版 APK 从手机拉取并核对哈希。每组重启后等待约 6 秒，连续三轮
各约 30.2 秒、38 次 700ms 往返滑动（600,900 ↔ 600,2100）。
采样期间不运行 ART 方法采样；未调整刷新率。独立 trace 前读取 Thermal Status=0。

| 组别/轮次 | P50 | P95 | P99 | GPU P95 | legacy jank |
| --- | ---: | ---: | ---: | ---: | ---: |
| 第一版 1 | 6ms | 22ms | 27ms | 3ms | 14.90% |
| 第一版 2 | 5ms | 20ms | 25ms | 4ms | 13.88% |
| 第一版 3 | 5ms | 20ms | 25ms | 3ms | 13.65% |
| 第二版 1 | 5ms | 16ms | 20ms | 3ms | 13.58% |
| 第二版 2 | 5ms | 16ms | 19ms | 3ms | 12.82% |
| 第二版 3 | 5ms | 15ms | 18ms | 3ms | 12.12% |

这是进程级 gfxinfo histogram，rendered frames 不等于 FPS，P95 倒数也不是
平均 FPS。现代 jank 计数两组首轮均为 1、其余为 0，不能据此宣称无掉帧。

## 独立 Perfetto

另录约 12 秒第二版窗口：1,029 个应用 FrameTimeline 帧，103 个包含
App Deadline Missed（10.01%）；主线程 1,031 次 draw-VRI，均值 2.042ms，
最大 17.546ms，1 次超过 16.7ms，0 次超过 32ms。

第一版独立补录窗口：855 帧、106 个 App Deadline Missed（12.40%）；
857 次 draw，均值 3.192ms，最大 41.528ms，87 次超过 16.7ms，2 次超过 32ms。
补录第一版是在重装、启动等待约 6 秒后，第二版 trace 在三轮预热滑动之后；
两段预热状态不同，因此这些独立窗口不代替上表同流程三轮对比。

最初的第一版独立 trace 录制时前台已切换到其他应用，没有 Demo 帧，明确废弃。
之后脚本增加每次手势前的前台检查，离开 Demo 就停止，不混用那段 trace。

## 验证

- 官方原始源码作为 oracle，11,178 JVM 断言通过；覆盖宽树、深树、混合类、
  null、逆序解析、资源 ID 边界、帧间重排/重挂/改 ID、screen/context 回退。
- 401 个含空槽的子节点只扫描 401 次；81 个共享资源祖先在一批叶节点中
  只查询 81 次；10,000 次动态 ID 即时解析不查询资源表。
- 嵌套作用域恢复、线程隔离、清理与错误容错检查通过。
- 移动端 18 suites / 87 tests、typecheck、lint、Replay 反射缓存检查通过。
- 最终 APK 回放反射和资源上传 ABI 检查通过，DEX 中确认作用域进入、正常和
  异常退出清理，隐私资源字段保留真实运行时读取；编译桩未打包。
- 当前进程日志未发现 fatal/linkage 错误。
- 独立 12 秒 ART 方法采样得到 2,436,707 字节，确认新 Snapshot.resolve/
  hierarchyPath/siblingIndex 已执行，Replay 写入与上传任务仍有样本。MD5 仍
  在解析路径中；方法样本重叠，不将样本数当作耗时比例或互斥 CPU 占比。
- 首页、图书详情打开/返回、故障抽屉打开/收起正常，显示“未注入异常”。
  未执行下单或改变购物车。方法采样已停止，手机停留在第二版首页，安装哈希已复核。

云端范围已使用正确的「观测云演示Demo」工作空间查询。测试期间会话
`50c03f6dc345487291599c24afdfc261` 持续有 RUM view 数据及本地录制标记，
但该 session 跨本轮进程重启/换包，不能仅凭它区分两版的分片，也不能代替播放验收。
此前指定会话的云端回放获取失败仍未完成根因定位；本次不宣称已修复该问题。

## 产物

`mobile-app/build/diagnostics/scroll-jank/sdk-fix-v2/` 保存第二版 APK、
第一版回滚 APK、精确 R8/Hermes 映射与 hashes.json。第二版保持安装，应用数据保留。

```text
第二版 APK SHA-256
0d63592599da8d74fbc58113d998c1e53de6ead6b1d9218cbebf30ed81670a05

第一版 APK SHA-256
b93936d0db9c290f598462d68993b55c0d9411a78653bcf3e536bf9026d21bf5

ft-sdk 1.7.5-jankfix02 SHA-256
dd22ef08c26a437d1463d023ff42ad5e42a98a1f0cb9d09f544d8ddb9be07409

ft-session-replay 0.1.8-jankfix02 SHA-256
80c059d40103dc965c0828eba2d5f7091ace48de53b461b94b5fc8e49a48f097
```

原始证据：`.trellis/tasks/09-10-android-scroll-jank/evidence/sdk-v2-*`。
构建、测试及 APK 检查：`mobile-app/build/sdk-patch/*v2*`。
