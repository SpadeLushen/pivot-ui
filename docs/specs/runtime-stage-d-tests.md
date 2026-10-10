# D5 及更早阶段：授权补测记录

> **最新收尾决定**：用户明确跳过 D6–D8、聊天“显示隐藏消息”开关及所有剩余验收；目前没有可验收场景，后续遇到问题另行修复。跳过不代表实现或验收通过，不再作为本轮待办／前置条件。下文早期范围、待验收清单和门槛保留历史，以[升级总计划](pi-1.0.2-upgrade-plan.md#待处理的项目)最新决定为准。提交与推送已获授权；Pivot 将以单独的最后一个版本 commit 提升至 2.0.0，SDK 保持 1.1.0；不发布、部署或控制服务。


入口：[阶段 D 计划](runtime-stage-d-plan.md)／[技术附录](runtime-stage-d-technical.md)。

用户明确要求创建并执行 D5 及更早未执行测试。本轮新增 **30 项**本地行为用例，修复 11 项失效的旧测试／fixture，未修改产品实现。

## 执行结果

- 全量显式选择 app／components／hooks／lib／scripts 的 `*.test.mjs`：**608 项，604 通过、4 跳过、0 失败**，包含新增与既有无头 Chrome 用例。日志 `/tmp/pivot-stage-d-regression.log`。
- 工作区 `npm run build` 成功，含自带 compiler guard／typecheck／Next／pack；Pivot 1.2.2、SDK 1.1.0 未变。日志 `/tmp/pivot-stage-d-build.log`。
- 4 项跳过：Windows 上的 3 项 PTY 生命周期／历史用例；缺少 `PIVOT_TEST_PRODUCTION_DIR` 的生产页面冒烟。没有将跳过算作通过。

```bash
mapfile -t test_files < <(find app components hooks lib scripts -type f -name '*.test.mjs' | sort)
node --test --test-concurrency=4 "${test_files[@]}"
```

## 未执行矩阵与本轮证据对应

| 阶段 | 本轮本地覆盖 | 测试文件 |
|---|---|---|
| D1 | started 不等待模型结束；普通忙碌拒绝；steer／follow-up／显式排队 queued；命令和 input hook handled 不制造消息；preflight 失败；SDK 转换文本仅落盘一次 | `lib/rpc-manager-sdk.test.mjs` |
| D1／早期终态专项 | 发送中不假装运行；handled／失败无幽灵消息及通知；agent_end 不结束、settled 才通知；取消不通知；快 SSE／慢 HTTP 不复活；切会话隔离；null 旧回执按实际状态处理 | `components/stage-d.browser.test.mjs`、`lib/fixtures/stage-d-chat-ui.jsx` |
| D1 | 预留与真实开始分离、旧 run 不能启动／结束新 run、Pack reload 失败保留待重试并合并调用 | `lib/agent-run-state.test.mjs` |
| D2／D2b | 同 ID 三类型、聊天目录隔离、计数／DTO 不泄密；真实 SDK＋本地 HTTP peer 的分类协议、失败脱敏和进行中取消；缺输入／未知类型阻止调用、image Test 不生成；usage 0／非法数值 | `lib/stage-d-models.test.mjs` |
| D2b／D4 | 双文件分流、修改名称／重读保存、未知字段／0／false／null／未来 thinking 原值保留；新 runtime 和新 Node 进程恢复三类型；损坏／未来版本拒绝覆盖；第二次 rename 失败回滚两份文件；删除清理自有注册且不替换扩展 owner | `lib/stage-d-models.test.mjs` |
| D3 | compaction 前祖先、分支、失败／取消不覆盖最近成功模型；selected router 保留；实际模型费用＋classifier usage＋未归属父聚合，不重复 nested；未知容量不造值；浏览器连续实际模型更新且不改选择 | `lib/stage-d-selection-theme.test.mjs`、`components/stage-d.browser.test.mjs` |
| D5a | 完整 token／style／旧格式接口纯文本，颜色对象不可修改且实例独立；真实扩展 ctx.ui.theme 使用、reload 和独立 wrapper 一致 | `lib/stage-d-selection-theme.test.mjs`、`lib/rpc-manager-sdk.test.mjs` |
| D5b | 全局／项目作用域、trust、revision、保留未知设置；无会话只读 unknown；显式会话／cwd 隔离、绑定中 unknown、有界脱敏碰撞／错误；真实 SDK 禁用／重启用工具、第三方命令替代；活跃 run 延后、重载失败重试 | `lib/stage-d-builtins.test.mjs`、`lib/rpc-manager-sdk.test.mjs` |
| A–C 已有本地专项 | 会话落盘／Fork／导出、OAuth 假 peer、MCP 管理、权限／hidden／trust、Packs、费用、Output／图片与既有浏览器 fixture 全量重跑 | 既有 app／components／hooks／lib／scripts 测试 |

## 失败与修正

首轮 fixture 不符合 SDK chat 完整定义，且 SDK 不接受 thinking 覆盖对象本身为 null；将**存储原值保留**与**SDK 可加载配置**分开断言，不把 SDK 接受范围扩大。主题颜色经 SDK 解析为冻结 RGB 对象，改为断言不可变性与值相等。浏览器换会话模拟改为与 AppShell 相同的 keyed remount。SDK input hook 抛错会报告扩展错误而继续，不能假定其拒绝 prompt；wrapper preflight 失败采用明确注入拒绝，文本转换仍使用真实 SDK。

保存回滚测试最初在 jiti 导入后替换 fs.rename，无效且没有触发故障；最终编译**未修改的生产源码**，只注入第二次 rename 失败，严格断言四次替换及两文件字节恢复。

全量首轮 606 项：591 通过、11 失败、4 跳过。旧失败分别是当前上下文变量改名、D1 去除乐观图片／draft 交接／按 run settlement、Packs 信任控制、typed catalog 缺字段、费用偏好默认值，以及两个旧 mock 缺 ModelRuntime／resourceLoader。更新旧契约断言并使用临时目录内真实 ModelRuntime，62 项相关旧测试重跑全部通过；新增测试继续补充后，最终全量 608 项通过结果如上。

## 保留的验收边界

不将本地 fixture 等同生产整应用／真实付费服务验收，D1–D5 **不是全矩阵验收完成**：

- D1 新会话晋升时继续编辑文本／附件、真实编辑器交互、队列送达／撤回全部竞态、实际浏览器断线和音频播放仍未全面专项覆盖；本轮浏览器验证的是完成回调计数，不是扬声器声音。
- D2 classifier-only 的真实账户认证／OAuth 能力、chat 与 classifier 超时全矩阵、图片真实生成／计费仍待；本地分类 peer 不需要外部 API 资源。
- D2b／D4 保存／恢复和既有表单 callback 测试已执行，不冒充完整 Models 点击保存／改名／改类型浏览器流程或 Windows ACL 验收。opaque JSON 可保留不代表任意参数能通过 SDK schema。
- D3 完整真实 router 扩展的 resume／Fork／reload／自动 compaction、移除 router／目录不可用的整应用流程，D5 custom TUI 键盘交互、Built-in 标签页／开关浏览器全流程仍待专项。
- 早期真实 OAuth／第三方 MCP、Windows PTY／ACL、npm／pnpm consumer 安装与生产匹配进程验收继续保留。本轮没有访问真实账户凭据、控制现有服务、安装消费包、提交、推送、发布或改版本。

测试使用临时配置、临时工作区和本地 peer；浏览器使用独立 Chrome profile。构建仅在当前工作区执行，没有额外备份／同步或隔离构建目录。
