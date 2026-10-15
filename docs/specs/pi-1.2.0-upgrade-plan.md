# Pivot UI：pi 1.1.0 → 1.2.0 适配计划

状态：**适配已实施，授权的本地自动化回归及修正后构建通过；真实账户与完整产品验收仍有未覆盖项**。适配及测试时 Pivot 为 2.0.2，三个直接 pi 包和锁文件为 1.2.0。用户随后授权提交本批改动，并以单独的最后一个版本提交提升至 2.1.0；不推送、发布或控制现有服务。实施记录见第七节，2.0.2 下的测试与构建证据见第八节。旧计划的实施和用户跳过事项不重新列为本轮前置条件。

## 1. 目标与证据

建议做一个独立兼容批次：先完成必要适配，再按另行授权范围验收；不顺带重构 LiveSession、Tools／Packs 或非 chat 模型体系。

- 官方文字版：[pi.dev/changelog](https://pi.dev/changelog)，1.2.0 标示发布日期为 2026-10-12；网页列出主要变化，完整修复还需对照各包 CHANGELOG。
- 基线 `v1.1.0`：`abe508e1b89912adde45528136c3221eb69acdd7`。
- 目标 `v1.2.0`：`06a466935536f8c9bcacb2d5efc0fc021be1bdff`；[完整增量](https://github.com/earendil-works/pi/compare/v1.1.0...v1.2.0) 共 81 commits。
- `I:\pi_git` 原为干净的 detached `v1.0.2`。已执行 `fetch origin --tags`，并将工作树切为 detached `v1.2.0`。获取时 `origin/stable` 仍停在 1.1.0，`origin/main` 为 `7d75a0e3e`；不将 main 未发布内容混入目标。
- npm 官方 registry 已确认三个直接包均有 1.2.0，Node 要求仍为 `>=22.19.0`。这是元数据证据，不是安装或运行通过。
- 对照目标 tag 的 SDK、扩展、配置、模型、Provider、MCP、codemode、主题和 TUI 文档，以及相关源码差异；新增字段与运行逻辑以 tag 源码为准。

## 2. 影响分级

**必须实施**：三包／锁文件升级、Web 扩展组件的 APC 光标标记处理；若要交付 OpenRouter 新能力，必须接通有边界的目录网络刷新。

**必须复核，按证据最小修改**：启动 busy／取消／disposition，custom run 的工具策略，schema 兼容，MCP `reachesTools` 和内部模块接口，运行时 worker／WASM 资产。

**自动承接／无需新增 UI**：Provider 重试、Mistral 流超时、压缩省略 thinking、MCP structuredContent 和 OAuth 安全修复、codemode 声明／输出性能。

**不纳入本轮**：远程／inline sandbox、确定性回放、Durable／Chord 新架构、终端剪贴板协议及新的模型产品功能。

## 3. 必要兼容与落点

### U1：依赖与运行时底座

- `package.json`、`package-lock.json`：`pi-ai`／`pi-coding-agent`／`pi-tui` 一起精确固定 1.2.0，安装包含 devDependencies；核对 pi-agent-core、pi-codemode、pi-mcp 实际解析版本。1.2.0 coding-agent 已去掉 chord 依赖，不手工删除仍被其他包引用的依赖。
- 不升级无关 Next／React／TypeScript，不修改 Pivot 版本号，也不以全局 CLI 更新代替工作区 SDK 更新。
- 保留 `next.config.ts` externalization 与 `scripts/pivot-runtime-aliases.js` 的 npm／pnpm 向上解析和恢复机制。核对 worker、QuickJS WASM、Photon、lazy API、MCP dist 内部路径与构建身份保护；不能只看类型通过。
- 上游删除未发布的 experimental server／client／plugin 及 pi-client／pi-protocol／pi-server。Pivot 使用 in-process SDK，本地未发现这些运行时引用，不改为新服务栈。

### U2：扩展 TUI → Web 渲染桥接（明确不兼容）

上游 `Editor.render()`／`Input.render()` 不再直接输出反色 SGR，而以 APC 包裹光标字符：`ESC _ pi:fc BEL`／`ESC _ pi:/fc BEL`，焦点标记仍为 `ESC _ pi:c BEL`。真正 TUI 会解析这些零宽标记，Pivot 的自定义组件桥接不会。

- `lib/rpc-manager.ts` 的 `emitCustomUiRender()` 直接发送 render 行；`components/ChatWindow.tsx` 使用 `lib/ansi.ts` 的框线规范化和 SGR 解析。
- 现有 `stripAnsi()` 正则不能完整消费 APC payload，`parseAnsiLine()` 只识别 SGR，故会泄漏标记并影响可见字符／边框处理。
- 拟在桥接／ANSI 公共边界统一处理 APC、OSC 和非显示控制序列，同时保留光标中的可见字符。若保留原有光标可视性，将 fake-cursor 成对标记映射到 Web 光标样式或已有可支持的样式，不能只转换成当前解析器不支持的反色 SGR。
- 纯文本路径可用 SDK `stripTerminalSequences()`；保留 ANSI 配色的路径不能直接全剥离。规范化、渲染与复制应共享控制序列口径，不吞掉光标字符或邻接中文／emoji。
- `PlainTextTheme` 仍由服务器拥有，不把浏览器主题写入 SDK 全局。其 token 类型只是重组，未发现新增 token；保留现有覆盖守卫，不预设需要改 palette。

### U3：启动阶段、custom run 与工具策略

上游 `_startRun()` 在压缩检查和 `before_agent_start` 前即置 busy；期间 abort 记录请求，在 `agent_start` 后、第一次模型请求前执行。hook 失败会恢复 idle。这不意味着 abort 会立即中断任意异步 hook。

- `BeforeAgentStartEvent` 按 `messageType` 区分：user 有 prompt／images，custom 有 message、无 prompt。只处理用户文本的第三方扩展必须判别类型；不自动修改用户插件。
- Pivot 唯一该事件 handler 在 `lib/workspace-tool-extension.ts`，不读取 prompt，而是捕获每次 run 的工具规则，应对 user／custom 都执行，**不能加 user-only 过滤**。新行为修复 custom run 未捕获规则的问题。
- 复核 `lib/rpc-manager.ts`、`lib/pi-types.ts`、`hooks/useAgentSession.ts`、`lib/agent-run-state.ts`：启动 hook／前置压缩期间的忙碌状态、显式 steer／follow-up、未接受 HTTP 请求、hook 失败、abort、custom run、延迟输入及资源 idle reload。
- wrapper 已有 promptRunning 和 preflightResult，不重复实现 SDK 起跑锁；但原来用于“仍在 input hooks”保护的 `inner.isStreaming` 判断现会包含 before_agent_start，要明确允许排队的阶段，不无意放开普通重复 prompt。
- 不把 busy 误当已接受或已调用模型；继续用 disposition 回执和 agent_settled／prompt_done／状态对账收敛，保留旧 run 防护、取消不播完成音和源 wrapper 不变的 Fork。

### U4：配置 schema 与保存契约

上游发布 settings／models／keybindings／theme schema。**不等于四种配置都新增严格运行时拒绝**：主题严格校验，Settings 仍允许未知字段；models 改用共享 schema，contextWindow／maxTokens 新要求大于 0。

- 复核 `lib/typed-model-config.ts`、`lib/model-config-store.ts`、Models API／组件及 Tools 设置保存：保留 `$schema`、未知字段和手写采样配置，不因升级自动清洗用户文件。
- 本地 Models 保存已限制正 token 值；`modelOverrides` 是 opaque，应确认 0／负值及不符合已知 schema 的内容能够提示加载错误，而不是默默当空配置或自动修正。
- SDK models schema 仅用于 chat `models.json`；Pivot 的 classifier／image 仍放在 `pivot-models.json`，不将其混回 SDK 文件，不给组合编辑数据套错误的 schema。
- 自定义 theme 现在启动也验证：可复用颜色放 vars，colors／export／顶层未知元数据会被拒绝。项目只提供诊断，不擅自迁移外部主题。
- `$schema` 自动写入是可选编辑增强，不是升级必要条件；本轮不开发完整 schema 编辑器。

### U5：OpenRouter 按密钥目录（需要接通刷新）

SDK 网络刷新以 `GET /models/user` 过滤 chat 目录，更新该 key 的 contextWindow／maxTokens／价格，遵循 models.json 的区域 baseUrl；image／classifier 不过滤。个性化目录保存并替换目录，不应再由 Pivot 合并全部内置 chat 回去。

**升级前证据（实施时补充修正）**：`ModelRuntime.create()` 只有 `allowModelNetwork === true` 才在创建时联网；Pivot 常规创建和资源 reload 主要只读缓存。已有 `/api/models/refresh` 手动联网接口及 OAuth 登录后联网刷新，但手动按钮仅在 OAuth 详情；聊天选择、API-key／配置变更后的个性化目录刷新仍有接入缺口。`/api/models` 本身只读 snapshot，不能把 CLI 自动刷新视为 Web 已有，也不能说所有 Web 显式刷新都不联网。

- 落点：`lib/model-runtime.ts`、`lib/models-cache.ts`、`lib/model-catalog.ts`、`app/api/models/route.ts`、认证／Models 保存通知与必要的前端刷新入口。
- 拟提供模型选择／明确刷新时的受控 SDK refresh，认证或 baseUrl 变化后失效并刷新；不要让认证状态 GET、会话只读浏览、每次 services 创建都联网。
- 同一身份／endpoint 的请求去重，设置总超时／signal，区分进行中、旧缓存和失败；不得在日志或浏览器暴露 key。SDK 15 秒仅是 /models/user 请求限制，不是包含 pi.dev 目录请求的全过程上限。
- SDK 离线复用最后保存列表，缓存未按 key 分桶；切 key 后到成功刷新前可能仍是旧列表。空目录、无 key、超时及空返回的 fallback 按 SDK 契约表达，不承诺其为严格授权白名单。
- /models/user 的 401／403／404 上游会返回完整原目录（代理可能不支持该接口），不能当“零可用模型”或“已成功验证权限”。服务端权限仍由实际 Provider 控制。
- 新价格只用于新请求记录；不重算历史 cost、不把未记录费用改成 0。OpenRouter 的负占位价格归 0 是 SDK 行为，不等于模型免费。

### U6：MCP 与 codemode 元数据

- `reachesTools(input)` 使 MCP 按工具声明等待所需服务器，并决定替代 codemode／tool_search 是否可自动激活；namespace 增加 aliases（包含 server 名）。沿 `lib/pi-types.ts`、`lib/session-tool-policy.ts`、`lib/tool-catalog.ts` 与 native 装配核对元数据是否保留。
- 本地工具策略当前只原位改变 exposure，不重建 definition，未见已丢失 reachesTools 的证据。函数只留 SDK 运行时，不序列化给客户端。不得靠猜包名／schema 判断替代工具能力，也不因升级重新启用 hidden 工具。
- 原生 MCP 不再连接时枚举资源，只读 hasResources capability；Pivot 已显式调用 resourcesPage／resourceTemplatesPage，结构接口未依赖被删的 connection.resources 数组。复核分页与错误状态，不恢复连接时全量枚举。

- `pi-mcp` 的 structuredContent 从 object 变为 unknown，可为 array／null／primitive。本地输出、历史、SSE 与权限脱敏必须保值，不使用 truthiness 判定存在性，不强转 object；MCP isError 仍可能在脚本中 resolve，不能以 Promise 是否 reject 判成功。
- 上游 MCP 取消／超时后不会因 OAuth refresh 完成而补发请求，且无法验证 iss 时拒绝登录。Web 的独立 OAuth worker 保留取消 UI／已返回轮换 token 安全提交，不绕过 issuer 检查。
- `lib/native-mcp-config.ts`、`lib/native-mcp-management-types.ts`、`lib/native-mcp-oauth-worker.ts` 等使用 SDK 内部 dist 模块，应核对目标安装产物路径、导出与调用签名。这是公开 API 类型检查覆盖不到的重点。
- codemode 移除 MCP_TYPESCRIPT_PREAMBLE／mcpStructuredContentSchema，结果改为自包含类型；Pivot 未发现直接引用，无需复刻声明器。新增约束注释会影响 inlineBudget 下能列出的工具数量，由 SDK 裁剪，保持 searchTools 发现能力。
- 非首行 `// @options:` 现在在执行前失败；不由 Web 移动／删除该行后偷偷运行。继续保存 SDK 最终 content 顺序、失败部分输出、图片原 blockIndex、nestedCalls 摘要与父 usage，避免重复累计。
- codemode 耗时新增主要是 TUI renderer 表达；Web 已有 duration／运行计时，不增第二套，不混淆模型响应、工具 execute 与整轮耗时。

## 4. 自动承接与明确不做

| 上游变化 | Pivot 处理 |
|---|---|
| Mistral 请求 timeout 仅限制响应 headers，不中途切断生成 | SDK 承接，保留 Web abort 与状态对账 |
| Anthropic strict:prefer 限制失败后一次非 strict 回退 | SDK 承接，不降低 strict:require 或绕过权限 |
| 新 transient Provider 错误重试 | SDK 承接，仍等待 settled 而非首个 agent_end |
| 压缩／分支摘要 serializeConversation 省略 thinking | SDK 承接，不删除历史 thinking，不改变 UI／统计口径 |
| Windows auth lock 的短暂 EPERM 重试 | SDK 路径受益；Pivot auth-store 已有仅 mkdir race 的五次重试，保留安全边界，不重复扩宽 |
| ~ 在资源 modifier 中展开、worktree 的 symlink AGENTS | SDK 承接，不重新实现路径发现／trust |
| npm 12 pack JSON 输出修复 | 属于上游打包解析，Pivot 自带 build／pack 不因条目自动改造 |
| Editor／Input、符号按键、硬件光标、OSC52、Herdr、滚轮 | 仅渲染桥接需适配；不将终端行为推广到浏览器聊天／xterm 工具 |
| Remote／Inline sandbox、sandbox.start()、portable／Cloudflare | 可选能力，执行 API unchanged；继续现有本地 worker，不加新部署或依赖 |
| experimental stack／chord 移除 | 减少依赖；不迁移 Pivot 到 Durable、Chord 或新 client/server |

静态 diff 未显示 session-manager／sdk／session-runtime 源码变化，未发现必须迁移 JSONL、Provider 身份或认证格式的依据；这不等于已验证旧会话和用户配置在 1.2.0 下运行。

## 5. 实施顺序与完成条件

1. **底座 U1**：升级三包／锁文件，检查安装产物与实际传递依赖；只解决真实编译 API 差异。
2. **必要桥接 U2**：处理 APC 与光标字符，统一规范化／显示／复制口径；不顺带重做自定义 UI。
3. **行为边界 U3／U4／U6**：复核启动 busy／取消、custom 工具规则、配置保存、MCP 元数据／内部路径；没有回归证据不重复实现 SDK 功能。
4. **目录 U5**：接通受控网络刷新及缓存失效，保留离线／失败边界与 typed 目录，避免每个只读端点都联网。
5. **基本构建**：实施后直接在当前工作区执行 `npm run build`，正常包含 compiler guard、typecheck、Next build 和自带 pack；不拆分重复验证、不另建隔离构建／备份／同步目录。
6. **另行授权验收**：按第六节范围执行，区分构建、fixture、浏览器、真实账户和安装产物运行证据。既有验收／跳过决定不重开，不把旧 1.1.0 的通过数量冒充 1.2.0 结果。

完成记录须包含 SDK／Node 实际版本、修改文件、构建结果与既有警告、未覆盖边界。若只完成依赖／兼容而推迟 U5，应明确“已兼容 1.2.0，未完整接入 OpenRouter 新目录能力”。

构建会更新 .next，可能影响在用进程；遇占用不强杀。不自动重启 WinSW／服务，不自动发布、提交、推送或升级 Pivot 版本。工作区构建也不证明现有运行进程已加载新 SDK。

## 6. 完整验收矩阵（已完成的本地证据见第八节，未整体勾选）

- **扩展 UI**：真实 Editor／Input、焦点前后、光标中／末尾、中文／emoji、窄宽度、框线、SGR 配色、复制；无 APC payload 泄漏，无字符丢失。纯文本／保样式路径各自正确。
- **run**：慢 before_agent_start、前置压缩、custom triggerTurn、hook 失败、启动时 abort、steer／follow-up、普通重复发送、nextTurn 注入、settled 后继续、断线／迟到事件；回执／busy／完成音及 idle reload 不串 run。
- **工具**：custom run 捕获 workspace 规则、动态重注册、hidden／权限 gate、替代 codemode 的 reachesTools、有／无 aliases、慢连接 MCP 与首次发现；不改变在途 loadout。
- **配置**：$schema／未知字段／采样 null 的往返、无效 token override 诊断、旧主题启动错误、typed 分文件、全局／项目 trust 和保存作用域保持不变。
- **OpenRouter**：受限 key、换 key、地区 endpoint、代理 401／403／404、空列表、离线旧缓存、总超时／取消、并发／迟到 refresh、image／classifier 不过滤；catalog／picker／context／新费用一致，无凭据泄漏。
- **MCP／codemode**：资源 capability／分页／列表失败不阻塞工具，array／null／primitive structuredContent、isError resolve、OAuth refresh 期间取消不补发、iss 不可验证拒绝、轮换 token 保存；options 非首行不执行、失败部分输出／图片索引、usage 不重复计费。
- **持久化／运行时**：旧新会话恢复、源保持 Fork、分支／压缩／统计／导出；worker／WASM／lazy API 与 hoisted npm／pnpm aliases。consumer 安装、真实 Provider／第三方服务器、浏览器整应用及服务重载均需相应授权。

上述是原拟验收范围。用户后续已授权编写并执行测试，本地覆盖与剩余边界见第八节；不因此宣称整份矩阵已验收。

## 7. 本轮实施记录

### 已实施

- **U1**：三包精确固定 1.2.0，实际安装与锁文件的 pi-agent-core／pi-codemode／pi-mcp 也为 1.2.0；npm 安装更新 7 包、移除 3 包，保留 Pivot 2.0.2、TS7 和其他直接依赖。没有手动删除残留包或引入新服务栈。
- **U2／D1**：`lib/ansi.ts` 完整识别 APC／OSC 控制字符串，保留 SGR；fake cursor 转为可解析的反色样式，保留空编辑器的光标空格。自定义面板、组件型 statusline 在 `rpc-manager` 发出前也规范化；不修改存储的聊天内容或 SDK 全局主题。
- **U5／D2**：复用刷新 API，新增服务器刷新协调器和客户端共享 hook。聊天模型选择打开时、Models 的 OpenRouter 目录展开时进行限频自动刷新；各处可手动刷新。API-key 保存／删除、Models 保存和 OAuth 登录／退出触发失效与更新；读取历史和普通 Models GET 不联网。
- **刷新边界**：同 Provider／同工作区共享在途请求和 60 秒自动刷新结果；不同工作区串行，避免项目扩展互相覆盖。请求和刷新执行有 30 秒上限；离线模式不联网，客户端关闭不取消其他等待者，最后等待者离开会取消其操作。OAuth 登录保留原有 15 秒等待边界，目录失败不改报登录失败。
- **迟到保护**：配置／凭据变更取消已登记的旧刷新；文件元数据变化也会使旧结果失效，避免直接改文件后继续标 fresh。服务器 snapshot 在代次变化后重读；聊天和 Provider 目录忽略旧读请求。外部改文件并非实时监控，不保证正在运行的第三方代码立即停止；旧缓存仍可能保留到下一次刷新，UI 明确提示边界。
- **typed 目录修复**：OpenRouter 非 chat 自定义模型的注册层改为跟随刷新后的基础目录，避免静态 chat 副本重新引入被过滤模型。继续保留自定义定义与类型身份，不迁移分文件配置，不重算历史 cost。

### 差异复核与无需重做的部分

- **U3／A1**：wrapper 已有 promptRunning、disposition 和终态收敛，保持实现。明确 SDK busy 包括 before_agent_start 后，显式 steer／follow-up 可以进入起跑中的队列；普通重复 prompt 和更早 input hooks 期间的并发仍拒绝。未重做任务控制、Fork、声音或资源 idle reload；真实慢 hook／取消／重连仍待验收。
- **U6／A2**：本地 getToolDefinition 原位修改 exposure，不重建 definition；结构类型补充 reachesTools 和完整 namespace。安装产物中的 MCP connection、分页、signIn signal、纯 validator 路径／导出经静态核对仍兼容。structuredContent 的显示层按 undefined 判断存在性，可保留 null／array／primitive，无须强制改为 object。权限管线、隐藏工具和项目 trust 未放宽；MCP OAuth 安全修复由新版承接，未改 Web token 安全提交逻辑。
- **U4／A3**：SDK 配置加载错误在模型目录／聊天选择中显示安全的本地化诊断，不暴露原始 Provider 错误。空聊天列表仍可打开选择器查看问题。保存继续保留未知字段／$schema，typed 定义仍分文件；未自动重写主题、迁移凭据或新增 schema 编辑器。主题 token 守卫编译通过，不改 palette。
- 新 Provider 重试、Mistral、压缩摘要、codemode 声明／options／输出等采用 SDK 实现，未复制执行器或新增云端 sandbox；上述是源码／编译层复核，不是真实服务行为通过。

### 构建与尚未覆盖

安装日志：`C:\Users\spade\AppData\Local\Temp\pivot-pi-120-install.log`。Node 24.19.0、npm 11.11.1；安装仍有 emoji-mart／React 的 peer warning，没有更改 React 版本规避。

代码实施阶段在当前工作区执行 `npm run build` 成功，包含 compiler guard、TS7 typecheck、Next 构建及自带 npm pack；记录 4 个 runtime aliases，产物 `sincw-pivot-ui-2.0.2.tgz`（984 文件，15.1 MB），shasum `3925f59b31abf8b8d9239d02f238f6d26cb84314`。日志 `C:\Users\spade\AppData\Local\Temp\pivot-pi-120-build.log`。16 条动态文件追踪警告仍在，其中新增刷新模块的路径／文件元数据访问也触发此类警告；未屏蔽警告或把它们称为全部既有。第一次构建已成功，收尾追加迟到读防护、服务端输出规范化和文件变更信息识别后，重新执行同一完整构建；未拆分编译、增加测试或另行打包。

**实施阶段未执行**：测试／lint、浏览器、真实 OpenRouter／其他 Provider、第三方 MCP、consumer 安装、额外打包、备份／同步、服务控制、提交或发布。此为测试授权前的记录；后续本地测试见第八节。构建更新 .next 与自带 tgz，不证明现有进程已加载 1.2.0。

## 8. 用户授权后的测试与修正

用户明确要求“编写并执行测试”，随后继续；一次全量重跑被自动模式拒绝后，又通过交互问答明确重新授权相同范围。最终专项与全量回归通过，没有以许可拒绝算作执行、改变安全配置或更换工具绕过。

### 新增／扩展覆盖

测试数量净增 33 项：

- `lib/ansi.test.mjs`：APC／OSC 完整消费、可见正文／中文／emoji、反色恢复、空光标、普通 padding、RGB／256 色值与实际 SDK Input render。
- `lib/models-cache.test.mjs`：失效后的旧请求本身返回新 snapshot，区分配置失效取消与单纯 snapshot 清理。
- `lib/model-catalog-refresh.test.mjs`：10 项协调器测试，执行生产模块，替换 SDK／服务工厂边界；覆盖去重／TTL／强制刷新、不同 cwd 排队、多个等待者取消、总超时／重试、错误脱敏、离线、配置失效与文件元数据变更。
- `lib/pi-120-models-sdk.test.mjs`：5 项真实 SDK 测试，mock fetch 严格拒绝其他请求；验证按 key 过滤及 limits／price、typed 模型保留、缓存持久化／只读重开、失败保留、旧请求不覆盖换 key 后的文件、401／403／404 回退和非法 token override 不改原文件。
- `components/pi-120-refresh.browser.test.mjs`：5 项本地 Chrome 用例，运行真实刷新 hook／提示组件及 ANSI 渲染；验证去重、失败保留、错误脱敏、切 Provider／卸载后的取消与迟到防护、中文／emoji 的 DOM 文本与样式、DOM 选取文本。
- `lib/rpc-manager-sdk.test.mjs`：真实 SDK 验证 before_agent_start 期间 busy／重复拒绝／abort 不发模型请求，以及 custom run 重新捕获规则，动态注册后也不能执行禁用工具。
- Fork 持久化用例扩展到 root／setup × idle／running／compacting，使用真实 SessionManager 和结构化 inner 状态 fixture，断言源 wrapper 不 dispose、manager／leaf／文件字节及 child 写入隔离；更新既有真实 SDK Fork 用例的合法用户分叉点。这不冒充真实 Provider 生成或实际压缩过程的联调。

### 发现的问题与处理

1. 浏览器 fixture 的 HTML／JS 未声明 UTF-8，中文／emoji 被按错误字符集解释；修正测试服务响应头，不改变产品编码或中文断言。
2. UTF-8 修正后暴露真实问题：保留光标时也留下框线旁普通尾空格。修正 `lib/ansi.ts`，逐字符跟踪反色，只保留光标空格、仍清理普通 padding；同时避免 RGB／256 色 payload 中的 7／27／0 被误当反色指令。原断言保留，增加反向边界用例。
3. 旧 Fork 测试使用 setup 记录作为分叉点，并要求销毁源 wrapper，与现有源保留契约冲突。构造合法 root 用户分支和 setup 后用户分支，明确拒绝非用户分叉，增加源文件／leaf 不变断言；另核对 Git HEAD 中已有实现明确保留源 wrapper，仅对另开 manager 分支，确认不是为通过测试改产品 Fork 行为。
4. OAuth 登录测试的 fake runtime 补齐刷新协调器所需的公开方法，继续断言目录失败不覆盖登录成功和错误脱敏。

### 执行结果

- **最终专项**：8 个测试文件，71 项全部通过，0 失败／跳过。包含上述新用例、真实 SDK wrapper、OAuth 与持久化回归。
- **最终全量**：app／components／hooks／lib／scripts 下 106 个 `*.test.mjs`；641 项，637 通过、4 跳过、0 失败。首轮全量为 637 项，631 通过、2 个旧 Fork 断言失败、4 跳过；扩展并修正后重跑，未删用例或降低安全断言。
- **4 项跳过**：Windows 上的 3 项 PTY 用例；缺少 `PIVOT_TEST_PRODUCTION_DIR` 的生产 HTML／登录页面冒烟。未设置该变量或启动生产测试服务，不算实际运行环境验收。
- **隔离**：测试使用临时 agentDir 并在进程启动前设置；执行进程移除常见 Provider／AWS 环境凭据。新增 SDK 用例的 fetch 只接受固定 fixture 请求，不联系真实服务；Chrome 使用临时 profile 和本地服务。协调器测试只读临时文件元数据、使用 fake 时钟，不等 30 秒真实超时。

全量文件显式选择，避免裸 `node --test` 误把 `/api/models-config/test/route.ts` 当测试：

```bash
mapfile -t test_files < <(find app components hooks lib scripts -type f -name '*.test.mjs' | sort)
node --test --test-concurrency=4 "${test_files[@]}"
```

上面只展示文件选择；实际命令另包含临时 agentDir、环境凭据清理与退出清理。最终日志（位于 `C:\Users\spade\AppData\Local\Temp`）：`pivot-pi-120-focused-tests.log`、`pivot-pi-120-regression-tests.log`。同名日志由最终重跑覆盖；单独 SDK／浏览器初次日志不代替最终专项结果。

### 修正后构建与剩余边界

因测试发现的 ANSI 产品修正，重新在当前工作区执行 `npm run build`，compiler guard、TS7 typecheck、Next build 和自带 pack 全部通过。仍有 16 条动态文件追踪警告；产物 `sincw-pivot-ui-2.0.2.tgz`，984 文件、15.1 MB，shasum `ff2f3e44236b6feb883a786191d65bb9647fbe0d`。日志 `C:\Users\spade\AppData\Local\Temp\pivot-pi-120-tested-build.log`。这是修正后的最新构建，不以第七节原产物代替。

浏览器证据来自受控 fixture，不是整应用／真实插件面板或系统剪贴板写入验收；DOM 选取文本不能冒充实机剪贴板验证。真实 OpenRouter 密钥／地区、第三方 MCP／OAuth、更多网络异常、consumer npm／pnpm 安装运行、WinSW 重载和完整发布流程仍未验证。离线、回退、取消及费用逻辑有本地证据，不宣称全部 Provider 均覆盖。

**自动模式记录**：浏览器命令曾因 classifier 超时被拒绝，按规定重试同一命令一次；随后正常执行。一次全量复跑因 classifier 误判测试授权范围被拒绝，未执行；只读诊断确认 auto mode 保持启用、日志未启用，没有修改规则／配置。用户通过问答再次授权后，原命令重跑成功。没有通过替换工具或关闭安全控制绕过拒绝。

测试阶段未另行运行全项目 lint、访问真实账户执行模型请求、额外打包、备份／同步、停止或重启现有服务、修改 Pivot 版本号、提交或发布；后续版本／提交授权以文首最新状态为准。全量包含既有的工具链／lint fixture 测试，不等于额外执行 `npm run lint`。测试只控制自己的 fixture 子进程。



