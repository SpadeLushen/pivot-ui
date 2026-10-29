# Pivot UI：pi 1.3.0 → 1.4.0 适配计划

状态：**适配已实施，第一阶段工作区构建通过；未执行行为测试**。三个直接 SDK 包及传递 pi 包已升级至 1.4.0，Pivot 保持 3.2.1。后续底部面板改造在该构建通过后开始；classifier 图片测试 UI 和遥测平台不纳入本批。

已确定继续保持 `mode: "tui"`，本批未修改 SDK 界面模式声明。用户新增的“收起输入区、将询问内嵌至会话底部”需求已在本批适配构建通过后实施，见 [底部内嵌询问面板方案及完成记录](session-inline-interaction-plan.zh-CN.md)。

测试准备、专项用例、现有入口及结果判定见 [pi 1.4.0 适配测试指南](../pi-v1.4.0-testing-guide.zh-CN.md)。该指南尚未执行，不增加已有验证结论。

## 1. 基线与获取结果

- 上游：`https://github.com/earendil-works/pi.git`。
- 在 `I:\pi_git` 执行 `git fetch origin tag v1.4.0`，然后 `git switch --detach v1.4.0`；没有合并 main 或执行无目标的 pull。
- 原标签 `v1.3.0`：`71023aec1546d6d677a65669c5665c0927ce0dd0`。
- 目标 `v1.4.0`：`4a080252f06caf63a525d7873c5d94d3c23887e0`。
- 标签间 81 commits，343 文件变更，18347 行新增、3181 行删除。各包 CHANGELOG 标示发布日期为 2026-10-21。
- 保留上游工作树原有未跟踪 `.pi/mcp.json`、`.pi/skill-packs.json`，未读取其内容或安装源码依赖。
- Pivot 基线：`739061a850d178d060dd04890f304ba58a91f3c2`，版本 `3.2.1`；三个直接 pi 依赖精确固定 `1.3.0`。以当前代码为准，不把旧适配文档的未完成项直接当成本轮缺陷。
- npm 元数据已确认 `pi-ai`、`pi-coding-agent`、`pi-tui` 均发布 `1.4.0`；coding-agent 的 Node 要求仍为 `>=22.19.0`。规划阶段未安装或构建；后续实施结果见第八节。本批未执行或修改测试、运行 lint、控制服务、修改 Pivot 版本号或提交。

依据：[完整比较](https://github.com/earendil-works/pi/compare/v1.3.0...v1.4.0)、[目标源码](https://github.com/earendil-works/pi/tree/v1.4.0)。下文上游路径相对于 `I:\pi_git`，Pivot 路径相对于本工作区。

## 2. 更新内容与影响分级

| 上游变化 | Pivot 判断 |
|---|---|
| codemode 全进程默认两个 worker，容量满时按到达顺序等候；最长等 60 秒，或更短的脚本 deadline | SDK 承接执行队列；Web 的旧错误匹配和文案需适配。等待算入脚本超时，取消中的 worker 真正退出才释放。 |
| 新增 `PI_CODEMODE_MAX_WORKERS`，每次调用读取正整数 | 不默认提高。每个 worker 的 VM 上限 256 MB，单脚本最多四个非 chat 模型调用；并发调整不是免费提速。 |
| 并发 select/confirm/input/editor/inline custom 改用弹窗栈 | 修复在上游 InteractiveMode，不在 SDK UI 桥接；Pivot 单弹窗状态仍有相同覆盖问题。 |
| pi-ai 新增 ClientIdentity，统一 User-Agent、OpenRouter/NVIDIA/OpenCode 归因；自定义 OpenCode endpoint 也带 session header | 正常聊天由 SDK 读取 telemetry 开关后设置 identity；不为升级自动更换成 Pivot 品牌归因。 |
| `telemetryContext` → `telemetry?: TelemetrySpan`；移除旧 getPiUserAgent 子路径；resolveTranscriptTools 改签名 | 当前 Pivot 源码未发现调用这些旧接口，暂无直接编译迁移落点；用户扩展可能需要自行修改。 |
| System One classifiers 支持图片，新增 compat.imageInput/sendImageOptInHeader | 内置 codemode 能自动承接；Pivot 自定义 typed 注册的 Provider compat 传递需补齐。 |
| 压缩、分支摘要取消固定输出上限；split-turn 摘要遵循手动 compact 指令 | SDK 自动承接；reserveTokens 只决定压缩触发，不再是摘要输出预算。 |
| 恢复/树导航激活历史尚未提及的新扩展工具；截断失败尝试与其 toolResult 成对省略 | 保持 Pivot 工具策略、context_edit 和统计契约，重点复核而非重写恢复逻辑。 |
| MCP JSON 接受 UTF-8 BOM | SDK 读取受益；Pivot MCP 编辑器及 Pack 路径另有 JSON.parse，必须对齐。 |
| Responses deferred tools 缓存修复、空白工具输出占位、HTTP 413 视为溢出、更精确的 transient 重试 | SDK 自动承接；继续以 agent_settled/对账判断最终结束。 |
| HTML 导出和 TUI 修复 CJK 强调；TUI 修复未闭合数学块吞表格、文件补全正则字符、退出清理并支持 Rex | 导出与 TUI 桥接受益；Web React Markdown 不是 pi-tui，不能宣称其自动修复。 |
| Windows shell 发现修复、grep 增加 rg --no-config、扩展加载器公开 pi-ai/models | 内置工具/加载器承接；不顺带改 Pivot 独立终端工具。 |

目录变化包括 MiniMax-M3.1-Flash（不支持 off）、xAI Grok 4.3/4.5 的 xhigh、Cloudflare Clef Omni/Jev 1.14；修正 Clef Flash 为每百万输入 tokens $0.038、24576 context，Jev 为 $0.042。默认模型变为 Copilot gpt-6.1-sol、NVIDIA Nemotron 3.5 Super VL、Xiaomi mimo-v2.6-pro；移除部分上游退役模型及 openai-codex 的 gpt-5.5、gpt-5.3-codex-spark。这些是上游目录变化，不授权重写用户默认模型或重算历史费用。

## 3. 第一批：必要兼容

### U1. 依赖和运行时资产

`package.json`、`package-lock.json` 中 `pi-ai`/`pi-coding-agent`/`pi-tui` 同时精确固定 `1.4.0`，核对 agent-core/codemode/mcp/telemetry 的实际解析版本；不升级无关框架或 Pivot 自身版本。

保留 `next.config.ts` externalization、`scripts/pivot-runtime-aliases.js` 的 npm/pnpm 向上解析及恢复、`scripts/pivot-build-runtime.js` 的 SDK/产物版本一致性保护。pi-tui 新增 `marked-cjk-friendly@0.1.2`；导出器新增读取 `dist/core/export-html/vendor/marked-cjk-friendly.min.js`。实施时检查安装产物中的该文件、QuickJS worker/WASM、Photon WASM、typed lazy API 和原生 MCP 内部 dist 模块，不凭源码存在即判运行包完整。

### U2. codemode 排队和失败表达

落点：`components/MessageView.tsx:956`、`lib/i18n/{zh,en}.ts`，以及 SDK wrapper 的终态/取消链。

旧实现只匹配 `Codemode worker limit reached (` 并显示“容量已满，等待退出后重试”。1.4.0 的第三个脚本会先等待，最终可能是“60 秒内无空闲 worker”“等待期间脚本超时”或“等待期间取消”，并明确脚本未启动。

- 保留旧匹配以显示历史 1.3.0 记录，增加新版失败分类；不得把所有超时/执行错误都归为容量不足。
- SDK 没有新增可供 Web 订阅的排队事件。未收到进度时沿用“进行中”与耗时，不根据“尚无 nestedCalls”猜测已排队或已开始执行，也不伪造队列位置。
- 等待时保留 abort、SSE 重连和 busy 状态；等待失败后必须能够 finish 并再次发送，不能让资源 reload 提前切换在途 loadout。
- 不自建第二层队列、不自动重跑脚本、不改 node_modules；默认保留两个 worker。提高环境变量上限须作为运行配置决策另行实施。
- 1.3.0 适配文档的 fail-fast 建议只描述旧版本，本轮交付说明必须改用排队语义，不将旧容量用例当成新版完成条件。

### U3. Web 扩展交互不再覆盖未完成请求

证据：服务端 `lib/rpc-manager.ts` 已用 Map 保存多个 pending 请求和 custom 组件；`hooks/useAgentSession.ts:909` 却直接 `setExtensionDialog(request)`，custom 也只保存一个。第二次 confirm 会隐藏第一次，回答第二次后第一次不会恢复，服务端 Promise 仍等待。上游 InteractiveMode 的栈修复不会运行在 Pivot 自建 UI 上；这属于既有缺口，不是升级新引入的回归。

推荐在 LiveSession 内建立按 request id 管理的交互栈：新请求置顶，关闭栈顶恢复前一个；custom 重绘只更新自身，不能抢占更新的 dialog。普通表单和 custom 需统一排序/输入所有权，ChatWindow 只消费当前交互，不拥有第二份队列。

本阶段只修复交互状态与生命周期，保留现有展示形式；不提前实施底部面板或 composer 收起。后续内嵌方案直接消费本阶段的活动请求/提交/关闭状态，不再建立另一套请求栈。

同步完成服务端关闭通知与重连快照：正常响应、超时、signal abort、custom done、wrapper 销毁均按 id 幂等移除；当前普通 dialog cleanup 只删除服务端 Map，没有主动向浏览器发关闭通知。隐藏请求也可能先超时，不得在栈顶关闭后重新出现。重连按权威 pending 集合恢复并去重/移除失效请求；切换会话忽略旧事件。保存被遮挡表单的输入、custom 组件与焦点状态，不因为组件切换丢失草稿或错误 dispose。

浏览器 POST 失败不能静默丢掉尚可回答的请求；保留/恢复交互并显示失败，实际是否关闭以服务端状态为准。通知、widget 和 status 不入栈。沿用 backdrop/Escape 规则，不绕开 permission confirm，也不将取消当成授权。

### U4. MCP BOM 在编辑和 Pack 路径一致

证据：SDK `extensions/mcp/config.ts:97,233` 已 stripBom；Pivot `lib/workspace-pack-files.ts:25` 的 `readPackFile()` 仍直接 `JSON.parse(before)`。`native-mcp-editor.ts` 和 `workspace-pack-switch.ts` 都调用它，所以 SDK 能加载的文件仍可能在 Web 读写/Pack 操作时报无效 JSON。

仅在解析视图去掉开头 U+FEFF，`before` 继续保留原文本用于 revision/回滚。优先修共享读取边界，保持严格对象校验、格式错误 fail-closed、workspace 锁、symlink/trust 限制、Pack ownership、凭据脱敏和原子写入。保存时明确保持已有 BOM/换行格式，不因 GET 重写文件；回滚必须还原原始文本。不要泛化为吞任意非法前缀或自动修复所有配置。

### U5. typed classifier 的兼容字段真正到达请求

证据：SDK `provider-composer.ts` 将 models.json 的 Provider compat 合并进原有 classifier，但 Pivot `lib/typed-model-runtime.ts` 通过扩展模型列表再覆盖目录。其 `definition()` 仅展开 base/model，没有合并 Provider compat；SDK 对扩展 classifier 也只展开 definition，不再替它合并。

新自定义 Provider 或缺少对应 base 的 typed classifier 因此可能丢失 `imageInput`/`sendImageOptInHeader`。尤其自定义代理的 URL/名称不足以检测 OpenRouter 时，错误格式可能返回 200 却丢弃图片。

在 typed 注册边界明确合并已知 System One 字段，优先级为模型显式值 > Provider 显式值 > base 元数据 > SDK 自动检测；保留 false。只影响适用的两种 System One API，不给 Decisions/llama.cpp/image/chat 注入错误 compat。继续保留未知配置字段和 typed 分文件存储，不把 classifier 塞进只构造 chat 的 SDK models 数组，也不扩大 modelOverrides 的既有含义。内置目录本来携带的 input/compat 必须在 refresh/reload 后保留。

## 4. 必须复核，但不预设重写

### 工具恢复和权限

上游 `_restoreToolsFromTranscript()` 现在遍历当前分支全部 system 记录（包含压缩前），恢复已声明工具，并激活从未被该分支添加/移除的新扩展工具；`defaultActive: false` 仍抑制该自动激活，已移除的工具不会因此复活。

Pivot `activateAllSessionTools()` 有意采用“全可用 + global/workspace 字段规则”，会重新选择 direct 工具；不能为机械追随 SDK 语义而改回历史 preset 或悄悄改变既有默认启用策略。复核 bind/resume/tree/reload/首次 prompt 后 disabled/hidden 优先，owner 已撤回的 hidden 不重启，MCP deferred/codemode 的激活仍由原生 owner 管理。在途规则保持不变，动态注册继续经过 tool_call 权限管线。

### 压缩、恢复和账单

- SDK 去掉摘要固定 maxTokens，交由各 API 的模型输出限制及上下文约束处理；长推理摘要可能耗时更长、费用更高。不要在 Pivot 重新加回旧 4096 或 reserveTokens 输出上限。
- `_omitRecoveryAttempt()` 从投影消息找到截断调用对应的结果，写 context_edit 成对省略，支持恢复后的旧尝试。原始 JSONL 仍保留记录，Web 不应物理删消息或费用。
- 保持 `lib/session-reader.ts` 的 SDK context 投影与 `session-statistics/session-usage` 的原始历史/当前分支统计区分；省略上下文不代表免单。若复核发现旧成本丢失，修统计消费点，不改 SDK 恢复算法。
- HTTP 413 现在触发 overflow compact/retry；代理断流及 transient 错误走重试，Business workspace 限额明确不重试。不要在第一个 agent_end 播完成音或释放运行状态。

### 请求身份和扩展兼容

SDK session 每次请求用 `getClientIdentity(settingsManager)`，遵循 PI_TELEMETRY/enableInstallTelemetry；直接 ModelRuntime 的请求默认是 pi-ai 的详细 User-Agent、无归因，不能宣称所有嵌套/classifier/探测请求都继承 SDK session identity。

`before_provider_headers` 不再看到尚未注入的默认归因头，但返回对应头为 null 仍能删除，显式配置头仍优先。扩展若依赖“读到默认头再修改”的行为需更新；Pivot 自身没有此 hook，当前无需补兼容层。不要把通用 `withClientIdentity()` 包装器当成完整 ModelRuntime 替换：它不承诺保留 Pivot 所用的注册/快照扩展方法。

### HTML 导出与内部 dist 接口

`app/api/sessions/[id]/export/route.ts` 的三处强制匹配补丁（sortChildren/mapNodes/markActive）在此次 template.js diff 中未变，继续保留匹配失败即报错；新增 CJK vendor 文件需要随安装包存在。实际导出和深树交互待后续获准验收。

静态 diff 中 SessionManager、SDK 扩展 types、原生 mcp-servers、pi-mcp/src、pi-codemode/src 和 auth 核心未改。没有发现需要迁移会话 JSONL、auth.json、MCP 凭据或 Packs 数据的依据。仍需检查内部 dist 加载路径/签名和安装资产，不能以“文件未改”代替运行证据。

## 5. 可选能力与明确排除

### classifier 图片测试入口：推荐第二批

当前 `lib/model-test-input.ts` 明确拒绝任何 images 字段，`app/api/models-config/test/route.ts` 和 `components/ModelsConfig.tsx` 的文案也限制为文字/JSON。这是现有入口的边界，不是 SDK 升级会自动消除的限制；codemode 的图片分类与该 Web 测试入口是两条路径。

第一批保持该边界，明确交付“运行时支持图片分类，Models 测试仍限文字”。若后续扩展：由同一任务贯通输入验证、上传/大小总量限制、MIME/base64 校验、目录能力、API 和文案；只在用户点测试后调用，先验证再解析凭据/收费请求，不根据 input:image 自动执行。

- Jev assets：PNG/JPEG；TypeSafe 官方实验图片功能要求 opt-in header。
- Clef images：PNG/JPEG/WebP，最多四张。
- OpenRouter state-image-urls：由对应目录能力决定；不要发送 assets 然后仅凭 200 判图片生效。
- GPT-6 Luna 的图片能力此前已存在，本次主要新增 System One 路径，不误报为全部首次支持。音频/视频不在 ClassifierContext 支持范围。
- 保持取消、超时、错误脱敏和 usage 数值白名单，测试请求费用不混入任意聊天会话。

### 遥测：不作为升级前置

pi-ai 新增可选请求/轮询 spans 和 tokens/cost/duration metrics，telemetry 包扩展 propagation/links/metrics；默认无上报适配器时使用 no-op。Pivot 没有旧 telemetryContext 或自建 span adapter 的引用，本轮不新增追踪存储或监控页面，也不用 trace metrics 替代持久化 session 账单。

如果今后接入，使用 `telemetry: TelemetrySpan`，单独处理错误诊断可能包含最多 500 字符 Provider 信息的脱敏和留存策略；内容块只记录类型/长度不等于所有错误信息都安全。

### 不迁移到 Durable/Chord

本版本 Durable 的 sleeping task、sleepUntil、checkpointWhen、崩溃循环保护、IndexedDB 和 SQLite schema v2 是另一套宿主架构；Chord 新增 SQLite/遥测存储和 Context.telemetry。Pivot 使用 in-process coding-agent，不直接使用这些宿主。因此不要给 Pivot 会话做数据库迁移，不引入新队列/调度平台，也不把 Durable 的“schema 升级后不能回退”套到 Pivot JSONL。

## 6. 实施顺序与验收

建议顺序：**U1 依赖 → U2 排队反馈 → U3 交互生命周期 → U4 BOM → U5 typed compat → 关键静态复核 → 工作区构建**。每项由同一实施任务完成服务端、DTO、客户端和本地化，不按文件拆分状态机所有权。

开始实施前协调现有运行进程：安装会改变 SDK，而已有 `.next` 记录旧身份；构建会更新当前工作区 `.next`。不自动停止/重启服务，包括 WinSW；文件占用不强杀。代码完成后按仓库约定直接执行一次 `npm run build`（含自带 compiler/typecheck/Next build/npm pack），不拆分重复构建、不创建隔离目录、不额外打包/备份/同步，不修改 Pivot 版本或发布。

下列为原定行为验收清单，实施与构建记录见第八节，尚未执行这些行为检查。**用户明确授权测试后**，优先复用现有 fixture，在临时 agentDir、假凭据和本地 Provider/MCP 下覆盖：

| 范围 | 完成条件与可复用入口 |
|---|---|
| worker admission | 前两个占位、第三个等待且仅执行一次；释放后按序获准；排队中 abort、短 deadline、60 秒无空位、取消 worker 退出、跨 wrapper 共享上限；失败后 UI 可继续。上游 `packages/coding-agent/test/codemode-worker-admission.test.ts`、Pivot `lib/rpc-manager-sdk.test.mjs`、`components/MessageView.test.mjs`。 |
| 交互栈 | 两个 confirm、confirm+input、custom 内弹 confirm、隐藏 custom 重绘、非栈顶超时/abort、响应失败、双击/迟到响应、重连和会话切换；每个 Promise 完成一次且权限默认拒绝；草稿/焦点不丢。复用 `lib/rpc-manager.test.mjs`、`components/ChatWindow.test.mjs` 的现有入口。 |
| BOM | global/project MCP、继承 override、Pack on/off、revision 冲突/回滚均可处理 BOM；格式错误仍失败，凭据/其他字段不丢、读取不改文件。复用 `lib/native-mcp-editor.test.mjs`、`lib/workspace-pack-switch.test.mjs`。 |
| classifier compat | 内置/自定义代理经保存、重开、刷新、reload 后的实际 wire body 分别为 assets/images/state-image-urls；显式 false 不丢，模型覆盖 Provider；纯文字旧行为保持，错误不泄密。复用 `lib/stage-d-models.test.mjs`、`lib/models-config-sdk.test.mjs`。 |
| 既有契约 | resume/tree/压缩后的新扩展工具与 hidden/deferred；截断恢复无孤立 toolResult，原始费用保留；compact 自定义指令进入 split-turn；SSE settled、源保持 Fork、MCP trust/Packs。复用 SDK wrapper/native MCP 既有覆盖。 |
| 目录/产物 | 退役模型不会从 typed overlay 重新混回；用户显式默认不自动改写；thinking 跟随能力；HTML CJK、三个深树补丁、新 vendor/worker/WASM 和 npm/pnpm aliases 在实际产物可用。consumer 安装/浏览器/真实账户需相应授权。 |

源码/编译证据与行为验收分开记录。上游已有测试及旧版本通过记录不代表本轮执行通过；无需为证明谨慎重跑无关全套或调用真实收费 Provider。

若需回退，成组还原本批依赖声明、锁文件和适配代码，再重建同一版本产物；保留现有用户配置和会话，不能只替换 node_modules 或用硬重置覆盖他人修改。服务切换/回退执行由另行授权的运维阶段负责。

## 7. 源码定位

上游均取 `v1.4.0`，不采用 main 后续提交：

- 发布内容：`packages/{ai,agent,coding-agent,tui,codemode,mcp,telemetry,chord,durable}/CHANGELOG.md`；直接/传递依赖见相应 `package.json`。
- worker：`packages/coding-agent/src/extensions/codemode/execute.ts:58–113,554–613`；文档 `docs/{codemode,environment-variables}.md`（相对 coding-agent 包）。
- 弹窗栈：`packages/coding-agent/src/modes/interactive/interactive-mode.ts` 的 pushExtensionDialog/removeExtensionDialog/showTopExtensionDialog；并非 SDK factory 或 RPC 自动提供的栈。
- identity：`packages/ai/src/utils/identity.ts`、`packages/agent/src/{agent,agent-loop}.ts`、`packages/coding-agent/src/core/{client-identity,sdk,model-runtime}.ts`。
- 遥测和破坏性 API：`packages/ai/src/{types,telemetry,models}.ts`、`src/utils/transcript.ts`。
- 图片分类：`packages/ai/src/api/{system-one-shared,typesafe-system-one,cloudflare-workers-ai-system-one}.ts`、`src/providers/compat-schema.ts`；`packages/coding-agent/src/core/provider-composer.ts:277–355`。
- 目录：`packages/ai/scripts/{generate-models,openrouter-catalog}.ts`、`packages/coding-agent/src/core/model-resolver.ts`。生成模型数据不直接手改。
- 工具恢复/上下文修复：`packages/coding-agent/src/core/agent-session.ts:1244,1830,3103,3847,4198`。
- 摘要：`packages/coding-agent/src/core/compaction/{compaction,branch-summarization}.ts`。
- BOM：`packages/coding-agent/src/extensions/mcp/config.ts:97,233`。
- HTML：`packages/coding-agent/src/core/export-html/{index.ts,template.html,template.js,vendor/}`。

已对照目标标签的 SDK、Extensions、Custom Providers、Models/Models Configuration、Codemode、Compaction、Settings、Environment Variables、TUI、MCP、RPC Extension UI 文档及相关示例。关键结论同时检查了 Pivot 实际调用路径；行为结果仍需获准验收后确认。

## 8. 实施记录：第一阶段适配

- **U1**：三个直接包精确固定 1.4.0；npm 实际解析的 agent-core/codemode/mcp/telemetry 同为 1.4.0。安装使用 ignore-scripts，只新增一个包、更新七个包，未调整框架版本或 Pivot 版本。保留既有 emoji-mart/React peer warning。
- **U2**：保留旧 worker capacity 文案用于历史记录；新增等待 60 秒容量失败、排队超时、排队取消的准确分类，不伪造队列位置，不自动重试脚本。
- **U3**：wrapper 提供带 runtimeId/revision 的权威有序 pending 快照；响应、超时、abort、custom done、reload 和销毁更新状态。custom 在异步 factory 开始前记录顺序，嵌套确认不会被稍后挂载的父 custom 抢占。重复响应无副作用，失效/非活动请求不能误授权。
- **客户端**：`useExtensionInteractions` 作为 LiveSession 内部状态保存全部询问与草稿，只有栈顶显示。提交失败保留输入；custom 按键顺序发送；重连快照与 focus/online 刷新去重并移除失效请求。保留 `mode: "tui"`。
- **U4**：共享读取仅去掉解析视图开头 BOM，保留原文 revision/回滚；MCP 编辑/Pack 写入复用保留 BOM、换行和缩进的格式化。锁、trust、ownership 和凭据边界保持。
- **U5**：typed classifier 注册按模型 > Provider > base 传递已知 System One 图片兼容字段，保留 false，非法字段给出配置错误；不开放 Models 图片测试入口。
- **静态复核**：原生 MCP 内部加载路径、导出新增 CJK vendor、codemode/image workers、QuickJS WASM 和 Photon WASM 在安装产物可定位；既有工具策略、源保持 Fork、SDK context/历史账单分离继续复用，不复制上游算法。

在当前工作区执行 `npm run build` 成功，含 compiler guard、typecheck、Next build 和命令自带 npm pack。记录 4 个 runtime aliases；产物 `sincw-pivot-ui-3.2.1.tgz`，996 文件、15.6 MB。Next 仍报告 16 条动态文件追踪 warning，未屏蔽。完整日志：`C:\Users\spade\AppData\Local\Temp\pivot-pi140-build.log`。

本阶段没有编写/修改/执行测试、运行 lint、调用真实 Provider、控制服务或提交发布。构建不是行为验收，也不代表已运行的服务进程加载了新 SDK。

后续底部面板阶段复查补充了取消响应优先、旧 runtime 快照过滤、会话询问草稿的标签页内存恢复及待答时 SSE 致命断线重连；这些相邻修正与底部面板一起通过最终完整构建，未改变工具权限或 TUI 声明。最终构建日志为 `C:\Users\spade\AppData\Local\Temp\pivot-inline-interaction-build.log`，同名产物已被最终构建覆盖。
