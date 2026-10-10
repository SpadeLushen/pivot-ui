# Pivot UI：pi 1.0.4 → 1.1.0 适配计划

状态：**1.1.0 依赖升级与必要兼容已实施，当前工作区构建通过；用户授权的自动化回归已通过（538 项：534 通过、4 跳过、0 失败），包含既有无头浏览器用例；C2 codemode＋MCP 显示集成已获用户验收，真实账户及其余 1.1.0 人工验收边界独立记录**。三个直接 pi 包固定为 1.1.0，Pivot 保持 1.2.2，继续使用 TypeScript 7。C3 后经用户独立授权实施且构建通过，行为验收待授权；C4 未启动；未控制服务、提交或发布。初始分析／计划保留如下，实际取舍与证据见第七节。

## 1. 结论与证据

建议在继续 C3／C4 前完成一批独立的 1.1.0 兼容升级，重点是耗时契约、codemode 输出和 OAuth 清理。未发现必须迁移 Provider 名称、认证文件或 JSONL 版本的变化；这只是静态结论，不等同升级后运行通过。

- 官方 [v1.1.0 release](https://github.com/earendil-works/pi/releases/tag/v1.1.0)，发布于 2026-10-07。
- 完整增量 [v1.0.4...v1.1.0](https://github.com/earendil-works/pi/compare/v1.0.4...v1.1.0)：53 个 commits；基线 `7c10bd4337495ee613f2224843ecdf349b80d1df`，目标 `abe508e1b89912adde45528136c3221eb69acdd7`。
- npm 三个直接包的 1.1.0 元数据均要求 Node `>=22.19.0`，与 1.0.4 相同。当前 Node 24.19.0 满足直接包要求；现已安装并构建通过，但未进行 consumer 安装或发布包运行验证。
- 对照 tag 文档的 SDK、codemode、模型、MCP、扩展及消息／会话格式，与对应源码补丁。新增字段以 tag 源码定义为准：部分消息文档示例尚未列出 `durationMs`。
- 本地落点：`lib/rpc-manager.ts`、`lib/session-reader.ts`、`lib/types.ts`、`lib/nested-tool-state.ts`、`hooks/useAgentSession.ts`、`hooks/useTimings.ts`、`components/ToolResultContent.tsx`、`lib/native-mcp-oauth*.ts`、`lib/provider-login.ts` 和模型 API。

C1／C2、B1／B2 既有验收记录保留，不重开为未实施，但它们不证明 1.1.0 兼容。总待办见 [原升级计划](pi-1.0.2-upgrade-plan.md#待处理的项目)。

## 2. 差异与项目影响

| 已确认变化 | Pivot 落点与判断 | 处理 |
|---|---|---|
| assistant／toolResult 与工具 end 增加 `durationMs`，包含嵌套 end | 现有本地类型缺顶层字段，计时仍主要来自浏览器事件 | 升级批次补契约与工具耗时优先级；区分响应和整轮 |
| codemode 标注多段文本、合并相邻 text、console 移至末尾 | Output 按 content 分块，不再等同一次输出调用 | 核对新旧格式；保持按 content 分块，不默认反解析标记 |
| `agent_settled.aborted` | wrapper 原样广播；前端主要处理 agent_end 与状态对账 | 核对取消与最终结束；新增终态提示可选 |
| MCP 登录接受 signal；授权请求限时；关闭不刷新 token | Web 有独立 OAuth worker，不能直接套用 TUI 取消结论 | 必须复核 worker 取消／凭据提交／关闭路径，必要时最小修复 |
| Anthropic 回调端口占用时改用空闲端口 | Provider 登录委托 SDK | 自动受益；保留粘贴回调与取消 |
| OpenAI 登录新增可选 agentName | 当前沿用 SDK 默认身份与 deviceId | 品牌名称可选，不改变凭据或策略 |
| Haiku 5.5；GPT-6 Luna／图片分类；llama.cpp 原生 decision 模型 | chat 列表与 typed catalog 能力不是一回事 | chat 自动受益；非 chat 界面仍归 D／P2 |
| SDK／CLI tools 支持全 modifier 列表 `+name/-name` | 当前不传旧 toolNames／preset 到 SDK tools | 无需恢复旧预设；C3 后续遵循新语义 |
| ToolRenderContext 新增 durationMs／outputPad | React 结果 UI 不直接使用该上下文；HTML 导出由 SDK 构造 | 不照搬终端 padding；若自建上下文必须补齐 |
| OSC 7501 program status、TUI／standalone 更新修复 | Web 使用 in-process SDK，不解析终端状态 | 不新增 Web 状态协议 |

其他自动受益包括 SDK 的忙碌／Mistral 错误重试、Bedrock thinking、Codex 自定义 headers、Radius owner 禁用目录、图片 resize worker 消息识别及 prompt-length 分档价格修复。仍需授权后的对应回归，不宣称已生效或覆盖全部 Provider。

## 3. 必要兼容批次（原计划，实施取舍见第七节）

### 3.1 依赖与运行时

- 将 `pi-ai`、`pi-coding-agent`、`pi-tui` 三个直接依赖一起精确固定为 1.1.0，并同步锁文件；核对 chord、pi-agent-core、pi-mcp、pi-codemode、pi-telemetry 实际解析版本。不要只升级全局 CLI。
- 不升级无关 Next／React／TypeScript，不修改 Pivot 版本号；安装需包含已声明的 devDependencies，避免 `NODE_ENV=production` 导致编译依赖缺失。
- 保留 SDK externalization 与现有 runtime aliases 恢复机制。核对 worker／WASM／新增 lazy API 的模块解析，不能假设依赖一定在包内 node_modules。
- 实施时先解决编译暴露的 API 不兼容，再应用必要行为补丁，最后仅在当前工作区执行一次正常 `npm run build`（含自带编译／typecheck／Next／pack），不另拆分验证、备份或同步目录；如修复后需重建则记录原因。
- 构建会更新 .next，不证明运行进程已加载 SDK；不自动停止／重启服务。测试、安装冒烟及部署必须另获明确授权。

### 3.2 耗时契约

`AssistantMessage.durationMs` 是一次模型响应耗时；`ToolResultMessage.durationMs` 及 `tool_execution_end.durationMs` 是实际 execute 耗时，用单调时钟测量。参数／权限拒绝等未执行的结果可缺字段；0 是合法值。assistant 的旧消息或稍后获取的 deferred 结果也可能缺字段，不能补造。

升级前现状：`lib/types.ts` 只在 nested summary 表达 durationMs；`useTimings` 从 start/end 收到时间相减；`NestedToolState.observe` 未读取新 end 字段。历史转换大体保留消息元数据，不代表视图已消费它。

拟实施：
- 顶层消息类型补可选字段；历史／SSE 投影保留 SDK 元数据，不重写 JSONL。
- 工具完成值优先有效 SDK 记录，其次本连接观察值；缺少依据显示 `—`，不加约等号。收到带 duration 的 end 即使没观察到 start，也可使用记录值；无记录／无 start 不造值。
- 按用户确认的最终建议，nestedCalls 保存摘要保持 C2 最终权威；摘要到达前保留浏览器 start/end 间隔，不以 end 的 execute-only 值替代整个嵌套管线耗时。
- 不把 assistant 响应耗时替换为现有包含工具执行的整轮耗时，不把子调用相加为父耗时；TPS 若以后改用新分母，必须另说明统计口径，不能暗中改动。

### 3.3 codemode Output 格式

1.1.0 的 `formatOutput` 给多段非 console text（包括 return）增加 `==> text N/M <==`，把 console 行放到末尾一个 `<console_output>` 文本块；`joinAdjacentText` 合并邻接文本，再经截断与图片保存流程。标记属于正文文本，不是新的结构化块类型，不能可靠反推出每次输出调用，更不能对应某个子工具结果。

本地 `ToolResultContent` 已支持从首文本块提取执行摘要以及摘要／正文合并；上游仍生成同样的 `Script completed|failed\nWall time … seconds\nOutput:\n` 头，静态未发现需要改头部正则的证据。

兼容决定：
- 继续按 SDK 最终 content 块提供 blocks，允许一个折叠文本块含多个带标记段落；不默认用正则拆标记，避免误拆用户同名文本、截断内容或伪造结构。
- plain 原样显示最终文本／图片顺序，包括标记和末尾 console；不恢复 console 的原始调用时间顺序。blocks 默认关闭正文块，执行摘要仍直接显示。
- 输出小且未截断时，非 console 文本／图片保序；超限时 SDK 本就可合并文本并将图片移后，UI 遵循最终 content，不承诺恢复脚本原序。
- C1 图片懒加载仍按原始 content 的 blockIndex 读取，不能用重排后／正文显示序号访问历史图片。SDK 图片路径说明、失败后部分输出和 Script error 不得丢失。
- 若用户另要求每次 text 都独立折叠，作为额外 C2 产品增量评估，不列为此次必须改造。没有实证回归时无需修改实现。

### 3.4 运行终态

新增 `agent_settled.aborted` 是整次 run 的取消依据，不是所有子调用均取消的证明。SDK 文档明确 agent_end 后仍可能恢复／重试／继续，settled 才表示不再自动继续。

核对 `rpc-manager` 原样转发、`useAgentSession`／`AgentRunState` 的最终收敛、SSE 旧 run 防护和完成音触发。此次只修复发现的兼容问题；若增加 cancelled 提示，必须使用当前 run 的明确终态，不能把 unfinished／断线误标取消，不能因增加字段绕过现有重连对账或重构整个 disposition 模型。

### 3.5 MCP OAuth 与资源清理

上游 `signInMcpServer` 新增可选 signal，并把 signal 传到 discovery、注册、token exchange 和回调等待；SDK 登录的授权请求各限 15 秒。底层 pi-mcp flow 的 signal 是可选能力，本身没有自动超时。15 秒是单请求限制，不是整个授权流程期限。

`StreamableHttpTransport.close()` 不再调用 authProvider.token() 刷新，而用最后请求的 token 发 best-effort DELETE（1 秒限制）。原生刷新仍刻意不可取消：已经收到轮换 refresh token 时必须保存。

本地差异：
- Web worker 仍通过 cancel 标记停止后续 fetch／拒绝手动输入，没有把取消 signal 传入 SDK signIn；SDK 新的 15 秒请求限制可自动生效，但不因此拥有全过程主动取消。
- worker 保留 30 秒 fetch 上限和内存暂存，成功后在 refresh lock 内提交；Web attempt 有五分钟期限与身份去重。SDK TUI 在 session_shutdown abort 登录，不等于独立 Web worker 自动随 wrapper shutdown abort。
- wrapper 已先发 session_shutdown 再 dispose；保留此顺序。上游 /mcp manager 的异步打开／实时更新是 TUI 改造，不证明 Pivot Tools 弹框同步获得这些交互。

拟处理：审查 discovery／注册／浏览器等待／exchange／提交各阶段的取消、断连、超时与配置变化，明确 attempt／worker 的实际所有者与清理边界。必要时接入原生 signal，但不能盲目在所有阶段 abort 或立即 terminate worker，丢失已返回的新凭据；不能删内存暂存／旧凭据保护，只为追求取消快而打断持久化。SDK authorize／刷新／锁继续作为执行依据，不复制 OAuth executor，不在 Next 主进程修改 global fetch。

是否需要代码修复，须以升级后调用链与用户授权的专项证据决定；不是重新实施 B2，也不自动修改用户认证文件。

### 3.6 Provider 登录

Anthropic 的 53692 端口占用会回退空闲端口，再失败仍可粘贴回调；SDK 使用实际 redirectUri 换 token。Pivot 不硬编码回调端口，应保留取消和安全错误映射，尤其核对 Windows WSL／Hyper-V 场景。OpenAI agentName 为可选品牌提示，可暂沿用默认值。

保持 openai／openai-codex 独立，不迁移、合并或删除凭据，不改全局 deviceId 来源；OAuth 与 API key 互换仍须显式确认，取消／失败不覆盖原值。不记录 token、完整回调或凭据响应。此次上游变化不解决 Business 的第三方委托策略拒绝。

## 4. 新能力与原阶段关系

- **Haiku 5.5**：chat catalog 和支持的 thinking 由 SDK 提供，现有模型 API 已使用 getSupportedThinkingLevels；不硬编码新档位，不强制改默认模型。
- **GPT-6 Luna**：`openai/gpt-6-luna` 是 `openai-decisions` classifier，图片输入由 SDK 校验；不能塞进 chat picker 或用 chat 测试接口验证。只支持 API key，OpenAI Provider 在 OAuth 下过滤 classifier；即使环境有 OPENAI_API_KEY，也不能假定覆盖已存 OAuth。不得为启用 Luna 自动 logout／换凭据。
- **llama.cpp**：0.6.0+ 报告 decisions 模态的模型使用 /v1/systemone；decision-only 不列为 chat，text+decisions 才可能同时支持。Pi CLI 的内置 llama provider 不因升级自动进入 Pivot SDK services，需先确认扩展装配；产品接入仍归 D。
- **C3**：继续独立 on／only、inlineBudget、tool_search 与工作区工具规则设计；`tools` 全 modifier 列表修改 default selection，不是 allowlist，不能混普通名称、不能当 enabled／exposure 的替代。当前不传旧预设，无额外迁移。
- **C4**：上游分档价格修复自动影响新记录，不重算已有消息 cost。工具自身模型调用及 nested 聚合 usage 仍按父结果统计，classifier 并不天然成为子工具节点；此轮不实施统计增强。
- **D／P2**：typed catalog、classifier-only Provider、非 chat 测试和专用界面保留原优先级，不因新模型升级扩大本轮范围。

## 5. 建议执行顺序与完成条件

1. **U1：升级底座**。三包／锁文件、实际传递依赖、安装 devDependencies、公开 API／运行时资产静态核对。
2. **U2：必要兼容**。耗时字段与工具值优先级；Output 新旧格式；OAuth 取消与安全提交复核；run 终态和导出 renderer 契约。能由 SDK 自动修复且本地无回归的部分不重复实现。
3. **U3：基本构建**。当前工作区 npm run build，准确记录版本、结果与既有警告，不扩大成测试／安装验证。
4. **U4：另行授权验收**。以下矩阵按授权范围执行，失败定位后最小修复；不能降低断言换绿灯。
5. 兼容批次验收后继续 **C3 → C4 → D**，不将新特性全部塞入升级批次，不分批发布。

U1–U3 已完成；U4 已获测试授权，完成现有自动化回归和新增必要兼容用例，结果与未覆盖边界见第八节。完整专项矩阵仍未全部验收。代码与构建通过不等同真实授权、第三方 MCP、运行进程重载或最终发布通过。

## 6. 后续验收清单（完整矩阵未完成）

只有用户明确授权，才创建／修改／执行测试、浏览器专项或安装冒烟。服务控制与部署也需单独指示。

- [ ] 旧 1.0.4 历史、新 1.1.0 消息、0／缺失／无效 duration；未执行权限拒绝、执行失败、deferred 响应；刷新后工具记录耗时不依赖浏览器缓存，响应／整轮与并行子调用不混算。
- [ ] 单 text、多 text／return、console-only、console 与图片交错、头／正文合并、失败部分输出、超限截断；plain／blocks、执行摘要始终显示、历史图片原索引与懒加载不回退。
- [ ] 多层／并行工具、caught 子失败而父成功；agent_end 后自动重试、settled.aborted、断线／迟到事件、切会话／分支、完成音不误播，SDK 权限管线和状态归属不变。
- [ ] MCP discovery／注册／exchange 卡住与取消、回调和关闭清理、Web attempt 与 wrapper 的独立生命周期；旧凭据保留、已返回轮换 token 保存、锁内提交、同身份重入／配置变化保护；关闭不触发 refresh。
- [ ] 新旧 OpenAI 登录／API key 共存边界、取消／refresh、Anthropic 固定端口冲突和粘贴回调；真实账号另行人工授权，不访问现有 auth 文件做静态取证。
- [ ] Haiku 可用 thinking／默认模型不变，Luna 不进入 chat picker、OAuth 不误报 classifier 可用；Radius owner 禁用目录、受影响 Provider 重试和分档价格。
- [ ] 会话恢复／Fork／导出、Tools／Packs／hidden／项目 trust 与 idle reload；新 lazy API／worker／WASM 模块解析和 npm／pnpm／忽略脚本安装恢复。发布包运行、Windows PTY／ACL、第三方服务器和匹配进程保留最终交付门槛。

初始分析仅有静态证据；安装与工作区构建证据见第七节，授权后的自动化／既有无头浏览器结果见第八节。以下项目包含未覆盖场景，不因回归通过而整体勾选；实机／完整专项验收仍未完成。

## 7. 1.1.0 实施记录

用户确认采用工具耗时建议并授权执行其他必要适配；本轮不开展 C3／C4，不运行测试或 lint，不重启服务、不提交／发布。

- **依赖**：三个直接 pi 包精确固定为 1.1.0；锁文件及安装实际确认 pi-agent-core、pi-mcp、pi-codemode、pi-telemetry、chord 同为 1.1.0。`npm install --include=dev` 成功，日志显示更新 8 个包；安装自带 postinstall 恢复 4 个 runtime aliases。Pivot 1.2.2、TS7 和无关依赖声明不变，已有未提交实现保留。
- **顶层工具耗时**：`lib/types.ts` 增加 assistant 响应／toolResult 执行的可选 durationMs；`MessageView` 优先有效的结果消息记录，再使用本次计时／标签页旧缓存。`useTimings` 对顶层 end 优先 SDK duration，即使未收到 start 也可显示；缺字段且无 start 不造值。`recordedDuration` 拒绝负值／非有限值，0 保留并显示为 0ms。元数据由现有 normalize／历史投影保留，不重写 JSONL。
- **嵌套耗时**：继续优先父结果的 nestedCalls 保存摘要；摘要到达前保留浏览器观察的整条 start/end 间隔，不采纳嵌套 end 的 execute-only duration 作为摘要替代，避免混淆排队／权限／hooks 口径。运行中继续本地时钟；不改变整轮／thinking／TPS，不相加并行子耗时。
- **终态**：静态确认前端曾在低层 agent_end 结束整轮，SDK 后续重试／恢复会被提前收敛。现保留该事件的错误处理，等待 agent_settled 才完成 SSE 收敛与 timing 清理；明确 aborted 的 settled 不触发完成音。保留 prompt_done／状态对账作为漏事件兜底，不增加取消子节点或重做 disposition 模型。漏掉 settled 时的跨客户端取消识别仍属于后续专项边界，不宣称全矩阵通过。
- **Output／其他**：核对安装版本源码，摘要头仍兼容，保留现有按 content 分块、plain 原样输出和历史原始图片索引；不反解析 text／console 标记。Provider 回调回退、价格／重试等使用 SDK 实现；不增加 agentName 品牌提示、classifier UI 或工具预设，不操作用户认证文件。
- **MCP OAuth**：独立 worker 将 AbortController.signal 传入原生 signIn；cancel／SSE 断连／management retire 在 discovery、注册和回调等待阶段可主动 abort。一旦原生 URLSearchParams token grant 请求开始，延迟 abort，保留 SDK 单请求 15 秒限制与 worker 原有上限，让响应正文、SDK saveTokens 及最终 refresh-lock 提交完成；取消 UI 不迟报成功，已经完成的授权仍安全保存并通知 idle reload。取消前尚未开始的请求被拒绝，不复制 OAuth executor、不修改 Next 主进程 fetch。SDK transport.close 复用最后 token、不做刷新；management record 与 wrapper 生命周期仍独立。
- **构建证据**：当前工作区 `npm run build` 成功，完成 compiler guard、TS7 typecheck、Next build 及自带 npm pack；934 文件，包 shasum `4e19716b09e449598a58c5b53de2d19c3bed07e1`。日志 `/tmp/pivot-pi-110-install.log`、`/tmp/pivot-pi-110-build.log`；13 条既有 Turbopack 动态文件追踪警告仍在，安装有既有 emoji-mart／React peer warning，未放宽类型或屏蔽警告。
- **未执行**：测试、lint、浏览器、真实 OAuth／第三方 MCP、consumer 安装、额外打包、备份／同步、部署及服务控制。构建更新 .next／本地 tgz，不等同运行进程已加载 1.1.0，需用户另行控制服务与验收。安装触发已有 postinstall 不视为额外手动部署。
- **自动模式记录**：首次差异／哈希检查因 classifier 超时被阻止，未执行、未绕过重试；只读诊断确认 auto mode 保持启用，没有修改规则或配置。后续独立安装、实现与构建获准并完成，不能把受阻检查算作验证证据。

## 8. 用户授权后的自动化测试记录

用户另行要求“执行测试”。本轮只修改测试／本地测试 fixture 和文档，没有进一步修改产品实现、重建产物、控制现有服务、提交或发布；C3／C4 未启动。

- **升级专项**：`node --test --test-concurrency=4 lib/timing-store.test.mjs lib/turn-duration.test.mjs lib/agent-run-state.test.mjs hooks/useAgentSession.test.mjs components/MessageView.test.mjs lib/native-mcp-management.test.mjs lib/native-mcp-sdk.test.mjs`：68 项全部通过。Provider 单独运行 `node --test lib/oauth-login.test.mjs`：5 项全部通过。
- **完整回归**：显式选择 app／components／hooks／lib／scripts 下 94 个 `*.test.mjs`，执行 `node --test --test-concurrency=4` 加文件列表：538 项，534 通过、4 跳过、0 失败。

```bash
mapfile -t test_files < <(find app components hooks lib scripts -type f -name '*.test.mjs' | sort)
node --test --test-concurrency=4 "${test_files[@]}"
```

- **首次失败与修正**：耗时测试的 3 处旧断言期待 agent_end 清理和 0ms 被抬为 1ms，按已确认的新契约改为严格断言，并增加反向／缺失值与真实 hook 回调覆盖；没有删除或放宽断言。裸 `node --test` 会误发现 `/api/models-config/test/route.ts`，改为上述显式列表，不修改 API 或模块类型。Provider fake runtime 缺少新 refresh 方法、创建阶段未等待异步凭据读取，补齐模拟并保留刷新失败仍登录成功的断言。
- **新增证据**：SDK 0／无效 duration、缺 start 的完成值、旧记录与缓存 fallback；真实 useTimings 回调的 SDK 优先、nested 管线 fallback 和 aborted settlement 清理；MessageView／NestedToolCalls 静态渲染的保存值优先；agent_settled／完成音的源码契约断言（不是浏览器行为证明）；真实 SDK＋本地 OAuth peer 的 grant 期间断连后保存 access／refresh token，取消 UI 不迟报成功、不输出凭据。
- **测试隔离**：发现旧 Provider 测试缺少目录隔离，首轮 route 会读取默认用户配置及 deviceId 设置；没有进行真实账户登录。已改为在 SDK／route 导入前设置临时 PI_CODING_AGENT_DIR 并重跑，结束清理目录，不把初次运行宣称为全程隔离。MCP OAuth 使用本地 peer 和临时凭据，不联系第三方账户。
- **浏览器与跳过项**：既有 5 项 MCP 面板、2 项聊天文本选择无头 Chrome 用例通过；不等同新增计时／完整 1.1.0 手动浏览器验收。4 项跳过为 Windows 上的 3 项 PTY 用例和缺少 PIVOT_TEST_PRODUCTION_DIR 的生产页面冒烟；未设置该变量、未启动生产页面测试服务。C2 codemode＋MCP 显示集成的后续用户确认见第九节；真实 Provider、其余第三方 MCP 边界、consumer 安装与第六节剩余专项仍独立记录。
- **日志**：`/tmp/pivot-pi-110-focused-tests.log`、`/tmp/pivot-pi-110-provider-tests.log`、`/tmp/pivot-pi-110-regression-tests.log`（后两轮重跑结果覆盖同名日志；裸自动发现的误发现错误不计入最终通过数量）。

## 9. C2 codemode＋MCP 人工验收补充

用户确认此前已测试 codemode＋MCP，显示正常，并明确可视为验收通过。据此关闭 C2 中“真实 MCP 作为嵌套子工具的显示集成”待验收项，阶段 C 与总计划同步更新。

此为用户对既有人工测试的补充确认，不是本轮新增执行记录，未指定测试时 SDK 版本；不将其冒充完整 1.1.0 人工验收或所有 MCP 超时／断连／OAuth 边界覆盖。既有 B2 验收不重开；未修改代码、执行测试／构建、控制服务、提交或发布，C3／C4 未启动。

## 10. 后续 C3 独立实施

用户随后要求“先按你说的做 C3”，已在现有 Tools 完成编排配置和会话能力表达，工作区完整 `npm run build` 通过；见 [C3 实施记录](codemode-stage-c-plan.md#c3-实施记录)。本批没有测试授权，未创建／修改／运行测试；第八节 538 项回归属于 C3 前的 1.1.0 兼容批次，不能作为 C3 验收。这是 C3 初次实施时的状态；后续 C3 信任提示用户验收通过，C4 也已完成实现。用户随后授权阶段 C 补测及主题提交，新增 40 项本地／SDK／Chrome fixture 自动化，完整回归 578 项（574 通过、4 跳过、0 失败）和工作区构建通过；见 [阶段 C 测试记录](codemode-stage-c-plan.md#8-授权自动化补测记录)。真实账户／生产整应用／其余外部专项仍保留，未控制服务或发布。
