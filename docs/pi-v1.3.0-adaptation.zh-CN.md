# Pi v1.3.0 变更分析与 Pivot 适配计划

## 结论

建议升级，但采用“小范围兼容升级 + 模型列表语义对齐”两阶段，不重写会话、MCP、Packs 或 LiveSession。

已按本计划实施依赖升级、参数诊断、并发反馈、Provider 定向提示和模型 scope 对齐。下面保留分析基线与设计依据；行为验收尚未执行，构建结果见实施记录。

## 实施记录

- 三个直接 Pi 依赖及 agent-core/codemode/mcp/telemetry 已统一为精确 `1.3.0`，Pivot 版本仍为 `3.0.0`。
- `lib/types.ts`、`lib/normalize.ts` 保留 `argumentsError`；工具卡片在折叠状态标示参数无效，展开显示原始诊断，不把 `{}` 当作有效输入展示。
- 继续采用原有工具策略与运行结束机制；容量失败直接显示在 codemode 卡片，保留 SDK 原始错误，不排队、不自动重试。
- `ProviderUpgradeNotice` 在 Models 中针对旧 Kimi API/官方地址/compat 及 OpenCode 旧官方地址提示检查。用户配置和凭证不作迁移。
- `lib/model-scope.ts` 复用公开 `resolveModelScopeWithDiagnostics`，沿用 60 秒模型缓存、配置失效取消，额外限制 scope 鉴权可用性解析为 5 秒。DTO 只返回诊断 code/pattern，不发送可能包含凭证的 SDK 异常文本。
- 模型选择器展示歧义、无匹配、非法 thinking 后缀、超时/失败和回退状态。无匹配时仍保留原来的全部可用模型回退，但不再静默。
- 构建：首次因环境 `NODE_ENV=production` 省略已声明的开发依赖而停止于 typecheck；用 `npm install --include=dev --ignore-scripts` 补齐后，当前工作区 `npm run build` 已通过，包含 typecheck、Next 编译及自带 npm pack，产物为 `sincw-pivot-ui-3.0.0.tgz`。Turbopack 报告 16 条动态文件访问追踪警告，构建未因此失败；本任务不扩大到文件访问/打包追踪重构。
- 未运行测试、真实模型调用或浏览器交互验收，未停止/重启服务。原有聊天/弹窗及同时进行的 TPS 改动不属于本适配任务。

## 分析基线

- 上游仓库：`I:\pi_git`，远端 `https://github.com/earendil-works/pi.git`。
- 已执行 `git fetch origin tag v1.3.0`，工作区已切换到该标签的 detached HEAD。
- 基线 `v1.2.0`：`06a466935536f8c9bcacb2d5efc0fc021be1bdff`。
- 目标 `v1.3.0`：`71023aec1546d6d677a65669c5665c0927ce0dd0`，发布说明日期为 2026-10-15。
- Pivot：`lushen-custom`，HEAD `28d7923`；声明与实际安装的 `pi-coding-agent` 均为 `1.2.0`，直接依赖的 `pi-ai`、`pi-tui` 也固定为 `1.2.0`。
- 上游区间共 63 个提交、226 个文件变化。Chord/Durable 占 85 个文件，并非 Pivot SDK 适配的主要范围。
- 两个工作区原有本地修改/未跟踪文件均保留。Pivot 的现有聊天及弹窗修改属于其他工作，本计划不覆盖它们。

## 上游变化及影响

| 变化 | Pivot 影响与处理 |
|---|---|
| Pi 内部依赖从 `^1.2.0` 改为精确 `1.3.0` | 三个直接 Pi 依赖同步升级并更新锁文件，检查传递依赖版本一致性，避免混版。 |
| 删除 `AssistantMessageFrame`、encoder、reducer | Pivot 业务代码未发现引用，不需重写 SSE；这是独立的实验接口，不是现用 `session.subscribe()` 事件流。 |
| 工具最终参数解析新增 `argumentsError` | SDK 将无效参数置为 `{}` 并拒绝执行；Pivot 的字段归一化会丢失该诊断，需补齐显示链路。 |
| 恢复会话时恢复 transcript 工具集 | 与 Pivot 的可用工具默认激活、workspace/global 规则再次应用发生交互；重点核对间接工具，不撤掉现有策略。 |
| codemode 结果/close 不再等待 worker 真正退出 | 上游同时限制一个进程内最多两个存活 worker，第三个调用立即失败；多会话并发是明确的行为变化。 |
| 模型解析统一 provider 选择规则 | 显式 provider/id 选择基本不受影响；`enabledModels` 的 Pivot 自定义过滤与 SDK 规则存在差异。 |
| Kimi Coding 改用 Chat Completions | 默认入口变为 `https://api.kimi.com/coding/v1`；旧 baseUrl/API/compat 覆盖需用户检查，不自动改写自定义网关。 |
| OpenCode Zen/Go 改为 inference 入口 | SDK 默认配置跟随修复；显式旧地址或 API 覆盖可能保留旧行为。 |

### 随 SDK 获得，不在 Pivot 复制实现

- 切换模型后，其他模型生成的 thinking 不再作为普通文本发给新模型。只是请求转换，不删除历史思考或改写 JSONL。
- OpenAI GPT-6 的 API-key 路径通过 `configuration_update` 保持 thinking 切换时的缓存；由 `compat.supportsMidConvoEffort` 控制。ChatGPT 登录路径明确排除，不能向所有代理或 Codex 一律打开。
- Gemini 4+ thinkingLevel、Xiaomi MiMo 仅 off/high、Claude Haiku 5.5/Opus 5 的 off 支持，以及 Codex GPT-6.1 Sol 的 500000 context window。
- Anthropic/Bedrock Claude 错误工具结果中的图片会移到本轮工具结果之后，模型仍可看到图片；Pivot 不应自行丢弃图片。
- 修复非法 `\\u` 工具参数、同一个流式 chunk 中 thinking/text 顺序，以及两类暂时性上游错误的重试。
- prompt template 保留空引号参数。HTML 导出修复 read 范围中数字字符串/null 的展示。

这些能力依赖实际加载的模型目录与用户覆盖；升级后应查看 effective model，而非只按包版本推断。

### 不属于本次必需适配

- `sessionShareDestination: auto | gist | radius` 作用于交互模式 `/share`。Pivot 目前的 HTML 下载不是 share 上传，不需要新增外部上传功能。
- 自定义 overlay 的 done 修复位于上游 InteractiveMode。Pivot 自己按 ID 管理 custom UI 关闭，不会自动获得该 TUI 修复，也无需移植其 overlayHandle 实现。
- 新增公开 `formatReadLineRange`。可供服务器端使用；不要为了显示范围将整个 coding-agent 根包引入浏览器。当前 MessageView 预览并没有上游那套范围计算，不必机械搬运。
- Chord 的 protocol 3/4、对象生命周期及 Durable 的 SQLite 命名空间等是其他包的变化。coding-agent 没有引入这些运行时依赖，本次不迁移相关架构。

## 第一阶段：最小兼容升级

### A. 依赖与打包（必需）

涉及 `package.json`、`package-lock.json`，保持 Pivot 自身版本号不变：

1. `pi-coding-agent`、`pi-ai`、`pi-tui` 一起固定到 `1.3.0`。
2. 锁文件解析到匹配的 agent-core/codemode/mcp/telemetry，确认没有因旧约束引入并行的不同版本实例。
3. 保留 `next.config.ts` 的 server externals、runtime alias 恢复机制；不另造打包路径。
4. 关注 codemode worker/QuickJS 资源定位，以及 MCP 内部路径、导出 HTML 模板的耦合，不以类型编译通过代替运行时兼容结论。

### B. 保留工具参数错误（建议作为升级交付项）

涉及 `lib/types.ts`、`lib/normalize.ts`、`components/MessageView.tsx`、中英文 i18n：

- 为 `ToolCallContent` 添加可选 `argumentsError`，归一化时显式保留字符串。
- 工具卡片显示“参数无效”与可展开诊断；错误中已含原始参数，不另行猜测或尝试修复执行。
- SDK 的 `arguments` 已清空，不能把 `{}` 展示成模型正常发出的完整参数。
- `hooks/useAgentSession.ts` 的 message_update/message_end 和 `lib/session-reader.ts` 都走 `normalizeToolCalls()`，优先在共享入口修复，避免分别维护。
- 现有 SDK 校验发生在服务端执行路径；这个遗漏影响 UI 诊断完整性，不意味着 Pivot 会绕过 SDK 执行坏参数。

### C. 保留工具策略与明确并发限制

涉及 `lib/rpc-manager.ts`、`lib/active-tools.ts`、`lib/session-tool-policy.ts`、现有工具结果显示：

- Pivot 未向 `createAgentSessionFromServices()` 传显式 tools，新版会进入 transcript 恢复路径。随后继续应用 Pivot 规则，保留全量可用默认值及 global/workspace override。
- 不以“尊重恢复工具集”为由重新启用 dormant preset，不把恢复列表直接当成新的持久化启用规则。
- 核对已加载的 deferred MCP 工具与 codemode/tool_search 在恢复、bind、reload、首次 prompt 后仍符合其 owner 曝光规则；workspace disabled/hidden 永远优先。
- codemode 直接使用 SDK 内置实现，不需要自行调用新增 acquireWorker/onWorkerStarted，也不修改 node_modules 提高上限。
- 推荐保留 SDK 的 fail-fast 行为，完整显示 worker limit 错误；先确保停止后 UI 能结束并再次发送。不自动重试整段脚本或新增跨会话队列，避免重复工具副作用。

### D. Provider 配置检查（条件必需）

涉及 Models 配置说明/必要的定向提示，而非自动迁移用户文件：

- 使用 SDK 默认 Kimi 配置者无需改配置；有旧官方 baseUrl 覆盖时，改为 `/coding/v1`，并检查显式 `api: anthropic-messages` 及旧 compat 覆盖是否仍合适。
- 自定义代理不能只追加 `/v1`：先确认代理支持的协议。K3、K3-256K、Kimi For Coding 支持动态工具添加，不将该能力推广到 highspeed。
- OpenCode 旧 `/zen`、`/zen/go` 覆盖需确认新 `/inference`、`/inference/go` 路由及模型 API；Go MiniMax M2.7 改用 Anthropic，Gemini 使用 Google API。
- 不自动改 credentials、provider ID 或会话历史。诊断优先基于用户在 Models 中打开的配置，不读取输出全局凭证文件。

## 第二阶段：模型列表语义对齐

这是现有差异在新版解析规则下更明显，不应误报成 1.3.0 才引入的故障。涉及 `app/api/models/route.ts`、`lib/models-cache.ts`，必要时增加共享模型 scope 适配层。

升级前的 `filterByExactEnabledModels()` 仅匹配完整引用或裸 ID，提前剥离 thinking 后缀，且零匹配时回退全部模型。它不能完整处理 SDK 的 glob、模糊匹配、合法包含冒号的模型 ID 和诊断；现已由 `resolveEnabledModels()` 替换。

建议将模型 scope 与诊断作为一份结果处理：

1. 单模型选择继续使用 provider/modelId 双字段，不引入裸 ID 猜 provider。
2. 同 ID 多 provider 的 enabledModels 匹配保留各 provider，展示歧义提示，不按目录顺序挑一个。
3. 完整 ID 优先，再解释 thinking 后缀；glob、模糊引用按 SDK 规则处理。
4. 零匹配不静默宣称过滤成功。若为可用性保留“全部模型”回退，需明确告知规则未匹配，并与 SDK 启动 fallback 区分。
5. 首选复用根包公开的 `resolveModelScopeWithDiagnostics`，在缓存加载/刷新边界执行并传播取消信号，不在前端复制解析器。
6. 此公开方法内部调用异步 `getAvailable()`，可能刷新鉴权可用性；不是纯快照读取。实施时必须保留有界等待及缓存，不能把它误当同步 filter 在每次 GET 上无界执行。纯 `resolveModelScopeFromModels` 虽在源码 export，却没有从包根导出，不可直接假设公共可用。

thinking 控件已使用 `getSupportedThinkingLevels()`，不需要新增 MiMo/Claude 硬编码。模型目录更新或配置保存后要沿用现有缓存失效链，让选项和 context window 同步刷新。已有会话费用仍使用录制值，不因目录价格更新重算历史。

## 后续验收与交付顺序

实施顺序：A 依赖 → B 诊断保真 → C 工具恢复/并发反馈 → D 定向配置提示 → 第二阶段模型 scope。每项由同一适配实现任务完成其服务端、DTO、前端和文案，不按文件拆分契约所有权。

代码开发后，仅按工作区约定直接执行一次 `npm run build`，保留该命令自带的 typecheck、Next 打包和 npm pack；不拆分重复构建、不创建隔离目录、不自动重启服务。

以下行为检查须用户另行明确授权测试后执行，优先复用现有 SDK fixture，不调用真实收费 Provider：

| 范围 | 完成条件 |
|---|---|
| 参数错误 | 流式、最终消息、刷新后的历史均保留诊断；无效调用不能产生真实工具副作用。 |
| 工具恢复 | 历史直接/间接工具、动态 MCP、禁用/隐藏规则在恢复和 reload 后一致；不影响其他进行中的 run。 |
| codemode | 两个并发可运行，第三个收到清楚的容量错误；abort/timeout 后 UI 可恢复，slot 按真正退出释放。 |
| 模型 scope | 同名 provider、带 `/`/`:` 的 ID、glob、thinking 后缀、无匹配及鉴权变化均有确定结果。 |
| 模型能力 | MiMo off/high、支持 off 的 Claude、Codex 500000、GPT-6 API key 与 OAuth 路径各自正确。 |
| 原有功能 | SSE 断线恢复/settled、fork 保留源 wrapper、分支、统计、MCP trust/Packs 和 HTML 下载保持原契约。 |

现有可复用覆盖入口包括 `lib/rpc-manager-sdk.test.mjs`、`lib/active-tools.test.mjs`、`lib/pi-120-models-sdk.test.mjs`、`lib/models-config-sdk.test.mjs`、`lib/native-mcp-sdk.test.mjs` 和 `components/MessageView.test.mjs`；本轮只阅读/定位，没有运行或修改。

运行包升级会使现有 `.next` 的 SDK 版本记录与安装版本不符，`scripts/pivot-build-runtime.js` 会拒绝这种不匹配。实施前协调运行服务的维护窗口；停止/重启必须另获明确指示。若需回退，应成组还原本任务的依赖声明、锁文件和适配改动并重新构建，不能只替换 node_modules，也不能覆盖他人的工作区修改。

## 源码依据与已排除的迁移

上游路径均相对于 `I:\pi_git`，以标签为准：[v1.3.0](https://github.com/earendil-works/pi/tree/v1.3.0)、[完整比较](https://github.com/earendil-works/pi/compare/v1.2.0...v1.3.0)。

- 发布范围：`packages/{coding-agent,ai,codemode}/CHANGELOG.md`；依赖固定见各包 `package.json`。
- 参数错误：`packages/ai/src/types.ts` 的 ToolCall、`utils/json-parse.ts` 的 parseToolCallArguments、`utils/validation.ts` 的 validateToolArguments。
- 工具恢复：`packages/coding-agent/src/core/agent-session.ts` 的构造过程和 `_restoreToolsFromTranscript()`；`core/sdk.ts` 的 usesDefaultTools 传参。
- worker 生命周期：`packages/codemode/src/runtime/{host,execution}.ts`、`src/types.ts`；全进程容量见 `packages/coding-agent/src/extensions/codemode/execute.ts`。
- 模型选择：`packages/coding-agent/src/core/model-resolver.ts` 的 resolveModelReference/resolveModelScopeFromModels/resolveCliModel；公共入口见 `src/index.ts`。
- Provider 与能力：`packages/ai/src/providers/{kimi-coding,opencode-go}.ts`、`scripts/generate-models.ts`、`src/api/{openai-responses,openai-responses-shared,transform-messages,google-shared,anthropic-messages,bedrock-converse-stream}.ts`。
- 分享/显示：`packages/coding-agent/src/core/settings-{schema,manager}.ts`、`src/modes/interactive/{session-share,interactive-mode}.ts`、`src/core/tools/render-utils.ts`、`src/core/export-html/template.js`。

静态 diff 确认本区间以下核心实现没有变化：SDK factory、SessionManager、ModelRuntime、agent-core/tui/mcp 的 src，以及 Pivot 使用的 `core/mcp-servers` 和 `extensions/mcp/config`。因此没有发现需要 JSONL、凭证、原生 MCP 或 Packs 数据迁移的依据。

Pivot HTML 导出仍依赖模板的三个精确文本替换。上游本次只改 read 范围展示，sortChildren/mapNodes/markActive 三个目标片段未改；暂不修改补丁，但升级包的实际导出仍需在获准的验收中确认。1.3.0 安装后的编译已通过，行为验证仍未执行。

