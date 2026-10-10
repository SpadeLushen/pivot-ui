# 阶段 C：codemode 增强与工具编排

> **最新收尾决定**：用户明确跳过 D6–D8、聊天“显示隐藏消息”开关及所有剩余验收；目前没有可验收场景，后续遇到问题另行修复。跳过不代表实现或验收通过，不再作为本轮待办／前置条件。下文早期范围、待验收清单和门槛保留历史，以[升级总计划](pi-1.0.2-upgrade-plan.md#待处理的项目)最新决定为准。提交与推送已获授权；Pivot 将以单独的最后一个版本 commit 提升至 2.0.0，SDK 保持 1.1.0；不发布、部署或控制服务。


状态：**C1／C2 已实施、构建通过且已有用户验收；pi 1.1.0 授权自动化回归通过（538 项：534 通过、4 跳过），C2 codemode＋MCP 显示场景也已获用户验收；C3／C4 已实施并构建通过，授权自动化专项通过（含真实 SDK＋本地模型及无头 Chrome fixture）；C3 信任提示人工验收保留，真实账户／生产整应用及其余外部验收不由这些 fixture 替代**。当前基线为 Pivot 1.2.2／pi SDK 1.1.0；总待办见 [升级计划](pi-1.0.2-upgrade-plan.md#待处理的项目)，测试范围与跳过项见 [1.1.0 测试记录](pi-1.1.0-upgrade-plan.md#8-用户授权后的自动化测试记录)。既有无头浏览器用例已通过，但不将 C2 的 1.0.4 人工验收视为完整 1.1.0 验收。

## 1. 前置条件与边界

A 的必要兼容已实施；B1、B2 及登录接入已经用户确认。1.0.4 升级构建通过后，C1／C2 已完成；新增的 1.1.0 兼容批次已完成必要耗时／终态／OAuth 适配和 Output 契约核对，构建通过；授权自动化回归已通过，剩余完整专项验收另记，不借升级启动 C3／C4。真实账户、第三方服务器、Windows PTY／ACL、部署与最终集成验收保留，不能用构建代替，但不阻塞本阶段规划。

首轮只增强现有服务端 SDK codemode，不在浏览器执行脚本，不复制 QuickJS／OAuth／工具执行器，不新增 MCP 迁移、Library 部署、Pack 继承、旧预设或 classifier／图片创作工作台。SDK `getPromptGuidelines()` 与 hidden declaration 过滤由原生 factory 提供。

## 2. 当前缺口与执行顺序

1. **C1：通用结果与图片**。已接入通用 `ToolResultContent`，补齐工具图片、混合顺序及历史按需读取；保留原有代码字符串、错误与 diff 展示。代码与构建完成，用户确认混合图片输出正常并明确验收通过。
2. **C2：嵌套调用与执行状态**。用户已采纳 4.1–4.4 方案，并明确不要约等号；现已接入父卡片摘要、折叠调用树、实时有界预览与 SDK 历史摘要。代码与构建完成，用户已确认浏览器验收通过，并补充确认此前 codemode＋MCP 可正常显示，视为该集成场景验收通过；1.1.0 自动化已补充保存摘要／计时 fallback 证据。C2 不再列为待验收项目。
3. **C3：独立编排配置**。用户另行授权实施；现已补 mode、预算、来源／恢复继承、当前会话能力与应用状态，复用 Tools 工作区 enabled／exposure。编译及打包通过，尚未运行 C3 测试或行为验收。
4. **C4：工具 usage 与统计**。已保留父工具 usage，新增只读统计快照、完整会话／当前分支累计与 SDK 记录费用分类；上下文占用独立显示，不从当前消息列表推断累计账本。授权账本／SDK／浏览器 hook 自动化已通过，外部真实调用验收另记。

阶段内分批顺序仍为 **C1 → C2 → C3 → C4**，前两批已完成、不等待高级配置设计；C3 也已独立完成代码与构建；用户已确认 C3 信任提示验收通过，其余 C3 专项后补；用户另行授权 C4 开发，pi 1.1.0 剩余专项仍保留。每批独立验收，不分批发布。1.1.0 的相邻文本合并／末尾 console 按最终 content 展示，不保证每次 text 独立折叠；工具 execute 耗时与整轮耗时区分，nestedCalls 保存摘要仍是 C2 最终权威。具体兼容边界及授权验收见增量计划。

## 3. C1：通用结果与图片

- 涉及 `lib/types.ts`、`lib/normalize.ts`、`components/MessageView.tsx` 及必要的读取／事件投影；优先拆出小型通用结果组件，不堆入工具名特例。
- 按原始 content 顺序展示 text 与 image；同时接受 SDK 的 `{ data, mimeType }` 和已有 `source` 格式，保留错误、diff、空输出和参数展示。
- 覆盖直接 read、MCP image 和 codemode `image()`。1.0.4 的脚本 read 图片值为 `{ type, data, mimeType, note }`；note／保存路径仍是输出说明，不把大 base64 当 JSON 文本渲染。
- 使用结果内嵌图片；保持现有路径及 symlink 限制，不放行整个 temp。图片保存失败仍可展示返回图片与错误说明。
- 验收目标：混合／多图片输出顺序、失败后部分输出、刷新与历史恢复、折叠和懒加载、移动端与长结果不卡住。大 structuredContent 仅按需查看，不与模型可见 content 混淆。

### C1 实施记录

- `lib/types.ts` 明确 SDK flat／旧 source 图片结构；`lib/message-images.ts` 共用图片来源检查，仅允许 image MIME 和安全 URL 形式，拒绝 file／javascript 等来源。
- `components/ToolResultContent.tsx` 按块展示文本和图片，支持多图、图片-only、空输出、错误／部分输出。折叠时不挂载内容，图片使用 lazy／async、限制预览尺寸，失败时提示并可重试。
- `lib/session-reader.ts` 保留既有删去 base64 后的历史 content／说明，另给出 `deferredImages` 的 entry ID、原始 blockIndex 与 noticeIndex。Web 展示按原始位置复原，缺少 session ID 时仍显示原来的省略说明。
- 新增只读 `GET /api/sessions/[id]/entries/[entryId]/images/[blockIndex]?toolCallId=...`：从已知会话读取指定 toolResult 图片，核对调用 ID、索引、MIME 与 base64；只返回该块的二进制，private/no-store、nosniff／sandbox。它不接受文件路径、不创建 AgentSession、不扩大 temp／文件 allow-list。
- 混合结果不再因 details.diff／patch 隐藏图片；纯 diff 保留原有展示。SDK 给出的图片保存路径、保存失败说明与脚本失败前的部分输出原样保留，不新增保存流程。
- 大结构化元数据仅在 `details.structuredContent` 已存在时按需、有界预览，省略图片 data，不当作模型 content。SDK 原生 MCP 当前不把完整 CallToolResult 放入持久化 details；本轮不抓取或复制它、不改 SDK、不承诺恢复未记录的数据。
- 当前工作区 `npm run build` 已通过；未创建、修改或运行自动化测试、未提交或控制服务。C2–C4 未开始实现。
- **用户验收通过**：用户自行重启 Pivot 后，使用 codemode 读取工作区 `public/agent-ui/chat-background.png`，输出两段文字及一张 PNG；用户确认“输出正常。C1验收通过”。据此关闭 C1；本次记录不冒充额外的自动化回归、刷新／多图／第三方 MCP 全矩阵验证。下一开发批次为 C2，本次仅更新验收记录。

## 4. C2：嵌套调用与执行状态

- 涉及 `lib/types.ts`、`hooks/useAgentSession.ts`、`hooks/useTimings.ts`／`lib/timing-store.ts`、`components/MessageView.tsx` 与 `lib/session-reader.ts` 的元数据保留。
- 实时 start／update／end 按 call ID 和 parent ID 建有界索引，支持多层与并行；显示进行中、成功、失败，取消／超时只在有明确依据时标记，不凭 start 事件区分排队与实际执行。索引绑定 session／run，沿用单调 run ID，防止迟到事件串到下一轮或其他会话。
- 不把子调用变成独立 transcript 消息、entryId 或重复的顶层统计。`message_end` 的父工具结果及其 `nestedCalls` 是最终摘要权威；断线缺失状态不猜测成功，最终结果到达后收敛。
- 历史只展示 SDK 已保存的 id、名称、参数（可能缺失）、状态、耗时与有界 error；摘要没有显式 parent ID，只按 SDK `<callerId>/<n>` 规则恢复可证实的层级，缺失父项保留为不完整记录。历史状态为 ok／error／unfinished，不凭 error 猜测取消，不承诺恢复子结果正文。保留 256 次调用、单调用参数 8 KiB／总量 32 KiB 的边界；`complete: false` 不等同执行失败。
- 取消仍调用现有 SDK abort，不建立浏览器执行器或第二套调度器。DOM、滚动、历史分页继续归 viewport hook；高频进度需合并更新，不逐字符重绘整棵树。
- 验收目标：并行／多层、参数省略、错误／权限拒绝、超时／取消、旧 run 事件、SSE 重连与历史摘要恢复；耗时不因事件重放重复累计。

### 4.1 显示方案：父工具卡片内的折叠调用树

所有通过 SDK 发出 `parentToolCallId` 的编排工具都适用，不写 codemode 名称特例。不新增侧栏、独立聊天气泡、分支导航 entry 或第二套执行器。

建议父卡片折叠时保留现有工具名／参数摘要／总耗时，增加“子调用 3 · 进行中 1 · 成功 1 · 失败 1”。没有子调用时维持原样，不显示空面板。计数是已记录的调用数，不是请求量／费用，也不猜测尚未开始的调用。

展开父卡片后按 **输入／脚本 → 子调用 → 父输出** 排列；沿用 C1 的文本、图片、diff 与错误展示。子调用区域独立折叠，不随新事件强制打开父卡片，也不抢滚动／自动切焦点。

```text
▾ codemode 读取项目配置   子调用 3 · 进行中 1 · 成功 1 · 失败 1   4.2s
  ▸ 输入／脚本
  ▾ 子调用（3）
    ▸ ✓ read       config.json          成功      0.2s
    ▸ ● bash       git status           进行中   1.4s
    ▸ ✕ mcp.search query="example"      失败      0.8s
  ▾ 输出
    ……父工具实际返回的文字／图片……
```

每个子行包含展开按钮、状态图标＋文字、工具名、简短参数与耗时。状态不只靠颜色；失败概要可见，完整参数／错误按需展开。同层按观察到的启动顺序稳定排列，完成不重排；兄弟节点不画成串行流水线，多个“进行中”也不等于已证实并行执行。

多层调用按真实 parent ID 缩进，超过三层限制缩进宽度并标明深度／父路径。调用多时首屏最多 20 行，提供“显示更多”，深层后代折叠；移动端参数省略，展开后换行，避免调用树压垮聊天布局。摘要不自动铺开 headers／env／凭据字段。

### 4.2 子行详情：实时可看，刷新不伪造

- **参数**：优先 SDK 已记录参数；省略时显示“参数未记录（N bytes）”，不能用 `{}` 冒充真实参数。
- **状态／耗时**：按用户决定，不显示约等号；实时利用收到的事件与现有 timing 时钟，完成摘要优先 SDK `durationMs`。并行耗时不相加冒充父耗时，没有时钟依据时显示 `—`。
- **错误**：保留错误摘要，完整信息按需查看；工具失败不一定代表父脚本失败，caught／allSettled 的父成功状态不被子失败覆盖。
- **本次结果预览**：只展示本次 SSE 实际收到的 partialResult／result，复用 C1 的小结果展示契约，不构造成 transcript 消息。清楚标记“仅本次连接，刷新后不可恢复”。图片仍使用 C1 安全来源，不新增文件访问；没有更新事件时不造进度条。
- **结果内存建议值**：单子结果最多 2 MiB、单会话运行期预览共 8 MiB；文本单预览最多 64 KiB。结果缓存超限先丢正文，保留名称／状态／SDK 摘要并提示“预览已省略”；图片整体保留或省略，绝不裁切 base64。具体计量需实施时明确，不能通过追加 SDK 持久化数据规避预算。

父输出始终是原始权威结果，不能用子结果拼出替代输出，也不重复计费。models.classify／generateImages、image／text／describe 等非 `ctx.executeTool()` 操作，若 SDK 没有对应子调用事件，就不凭脚本源码虚构节点。

### 4.3 状态与历史的诚实边界

SDK `NestedToolCallRunner` 在等待串行队列、参数／权限管线之前发 start，所以统一称“进行中”（涵盖排队／权限等待／执行），首轮不承诺准确排队状态或百分比进度。历史的 ok／error／unfinished 分别显示成功／失败／未完整结束；unfinished 不显示为仍在运行。

刷新时使用父结果中的 `nestedCalls`，仅按 SDK `<callerId>/<n>` 的可证实关系恢复树。缺失父节点放入“关系不完整”，不移到别的工具下；`complete: false` 显示“记录不完整”，不能推断漏掉的数量或将其等同失败。参数缺失、调用超限和 unfinished 均可能导致此标记。

运行中断线显示“实时状态可能不完整”，已有记录不自动标成功／取消。最终父 `message_end` 到达或历史重载时以其摘要收敛；未保存的子结果正文不恢复。旧会话没有 nestedCalls 时维持 C1 原样，不启动 AgentSession／MCP 来补历史。

### 4.4 实施拆分与计划验收

1. **数据契约与历史树**：在 `lib/types.ts` 表达 SDK nestedCalls；建议用小型 `lib/nested-tool-state.ts` 负责有界索引、纯树投影和快照收敛。既有 normalize／历史投影保留元数据；历史可只依赖已保存摘要，不改 JSONL 或创建新的 child entry。
2. **实时投影**：在 `useAgentSession` 与 SSE 命令边界内处理 child start／update／end，公开只读投影供 ChatWindow／MessageView 传入；不要在组件建立新 SSE 或进入 SDK private internals。节点绑定 session／run／root call／child ID，先校验回调的 run／连接归属及当前已知父调用，不能为迟到事件直接盖上当前 run ID；切会话、切分支、新 run 清理旧瞬态数据。
3. **展示组件**：建议新增 `components/NestedToolCalls.tsx`，输入为投影而非原始事件。计数、父卡片颜色和已记录的 SDK 摘要各自有明确口径；有子调用时才渲染，不改变没有子调用的旧卡片。完成后的参数／状态／SDK 耗时以保存摘要为权威，瞬态结果只能作为额外、可丢弃预览。
4. **收敛与性能**：每父最多 256 节点，溢出保留不完整标记，不臆造更多记录。高频 update 只留最新快照、合并为最多约 10 次／秒的 UI 更新，不把 partialResult 当文本 delta 无条件追加。父摘要收敛后停止现场时钟；计时仍归 useTimings，DOM／滚动仍归 viewport。子调用不污染顶层 phase、工具次数、会话总耗时或 C4 费用。

授权验证后的关键场景：多个父工具并行各自带子树、多层／串行队列、caught 子失败而父成功、明确取消／超时、update 缺失、end 早于观察到的 start、刷新／断线期间的未知状态、256 节点／参数／结果预算超限、长列表／移动端、迟到事件和会话／分支切换。C1 图片与父 diff 不回退；SDK 权限管线不变。

### C2 实施记录

- `lib/types.ts` 补 SDK nestedCalls 契约，另定义仅用于视图的 ToolResultView，不创建子调用消息或 entry；现有历史转换保留 SDK 元数据，不重写 JSONL。
- `lib/nested-tool-state.ts` 维护 session／run／已知 root／child ID 索引和最终摘要收敛；更新／start 重放不能复活已结束调用。纯迭代树投影保持同层顺序、处理缺失父关系及循环防御。
- `useAgentSession` 复用现有 SSE，将 child 事件与顶层 phase 分离；根只从已知 assistant 调用注册，连接实例／session／重连 epoch 校验丢弃旧来源。运行结束、断线、分支切换和新 run 清理或冻结瞬态状态，不把未知状态猜为成功／取消。没有收到 start 的结束记录不补造耗时。
- `NestedToolCalls.tsx` 实现折叠树、行详情、错误摘要、20 行分批展开、三层缩进上限及孤立关系提示；父折叠卡片有计数摘要，输入／子调用／父输出分区。状态同时有图标与文字，子失败不覆盖父状态。
- 用户查看历史后确认需调整顶部预览：codemode（含点分命名空间）卡片改为按既有记录顺序显示 `✓read ✕read ✓grep` 调用轨迹；进行中为 `●`、未完整结束为 `—`。顶部符号与名称统一继承普通文本颜色，不按子调用成功／失败着色，避免与父卡片背景混淆；调用树内部状态颜色保持不变。单行溢出裁掉开头、保留末尾，悬停可读完整状态序列；展开后的输入区仍保留代码，其他工具的参数预览不变。
- 历史 Child calls 缺少结果正文属 SDK 保存契约；Output 独立保留父输出，按 content 块显示，不建立或猜测子调用与段落的映射。
- 按用户要求，子调用结果标签简化为 `Result`／“结果”，无正文时改为 `Result cache has been removed.`／“结果缓存已移除。”；仍在执行且未收到结果时单独提示等待结果，避免误称缓存已被清除。这只是显示文案，不改变结果保存契约。
- codemode 父 Output 新增 `plain / blocks` 切换，默认 blocks，各文本／图片 content 块均为独立、默认关闭的嵌套折叠块；图片与 data URL 只在块展开后挂载。plain 保留文本／图片顺序，不设子折叠框或文本单块滚动，只保留 Output 整体滚动；已有结构化元数据在 plain 平铺、在 blocks 默认折叠。切回 blocks 重置为全折叠；模式仅在当前组件保留。不修改子调用预览与其他工具的既有结果／diff 展示，也不从父输出反推子结果。
- codemode 最前面的 SDK 执行摘要（`Script completed`／`Script failed`、`Wall time … seconds`、`Output:`）始终直接显示，不作为可折叠内容块，也不占正文块序号；兼容摘要与正文合并的首文本块，保留剩余正文及图片顺序。只对 codemode 父 Output 生效，不改原始记录。
- 耗时无约等号：保存值优先，其次现有 timing 观察值，没有依据或中断未结束时显示 `—`。观察值不冒充 SDK 记录，也不相加为父总耗时。
- 预览复用 C1 文本／图片／有界 diff，明确刷新不可恢复；不缓存原始 details、structuredContent 或 usage。最多 256 子节点／父、运行期 64 根；参数 8 KiB／调用和 32 KiB／根。预览字符串按 UTF-16 每 code unit 2 字节计量，单结果 2 MiB、全运行期 8 MiB，文本及单 diff 最多 64 KiB；这是预览 payload 预算，不是浏览器堆内存上限。文本截断复制其有界片段，图片整体保留或省略，状态投影 100ms 合并。
- 当前工作区 `npm run build` 已通过（compiler guard、TS7 typecheck、Next build 与命令自带 npm pack），初版日志 `/tmp/pivot-c2-build.log`，顶部调用轨迹调整后的构建日志 `/tmp/pivot-c2-trail-build.log`、Output 布局与提示语调整后的构建日志 `/tmp/pivot-c2-output-build.log`、执行摘要常显调整后的 `/tmp/pivot-c2-output-header-build.log`、顶部符号中性色调整后的 `/tmp/pivot-c2-neutral-trail-build.log`（均通过）。代理未创建、修改或运行测试，未自行执行浏览器／真实 MCP 专项验收，未控制服务／提交／发布；未开始 C3／C4。
- 用户随后明确反馈“浏览器验收通过”，据此将 C2 浏览器验收记录为通过；此后授权的 1.1.0 自动化回归结果见增量计划第八节。
- **codemode＋MCP 用户验收通过**：用户补充确认“我在此前测试过codemode+MCP，可正常显示，因此可视为验收通过”。据此将真实 MCP 作为嵌套子工具的显示集成场景记为通过，移除“真实 MCP 专项仍未完成”的 C2 待验收表述。此为此前人工测试的补充确认，不是代理新执行的测试，也不推定测试时 SDK 版本；不扩大为所有超时／断连／权限／OAuth 边界均已验证，亦不重开 B2 或阻塞 C3。

## 5. C3：配置与真实能力表达

- 在现有 Tools 中扩展编排配置，复用 `/api/tools`、工作区工具规则、revision／canonical-cwd 锁及 idle reload 协调，不另造工具预设。
- 显示 registered／active／callable／实际声明与 exposure 的区别，沿用 codemode 和 tool_search 各自的启用规则；增加 `on | only` 和非负整数 inlineBudget（含 0），默认保持 SDK 的 on／3000。
- **最新用户调整**：工具 enabled／exposure 支持全局 `<agentDir>/pivot-tools.json` 与受信任项目 `.pi/pivot-tools.json`，按字段工作区 → 全局 → 提供者默认解析；mode／预算使用 SDK 全局／项目 `settings.json`。编辑统一暂存，底部范围下拉框在 Global／Workspace override 间切换显示值和草稿，一个 Save 按钮保存选定范围的编辑字段；保留未知配置，全局保存不删除已有工作区覆盖。不增加 Pack 继承或旧预设。
- 设置在 idle／下一 prompt 边界生效，不改运行中 loadout，不重新启用 owner-hidden、被 Plugins 禁用或被第三方替换的工具。MCP 自动激活不得绕过显式禁用；两个间接入口均禁用时，提示服务器工具可能不可达，不擅自改成 direct。
- 1.0.4 的工具 glob 与单会话 no-mcp 不是首轮必做控件；若以后提供 no-mcp，必须在 resource-loader 层禁用原生 builtin，而非只清空工具名，也不能禁用第三方 replacement。
- 验收目标：on／only 的真实声明及 prompt guidelines、预算、保存冲突、同 cwd 多会话同步、不同 worktree 独立、延后生效、deferred 搜索／权限／owner-withdrawal。SDK 既有恢复后重新 discovery 的限制不冒充 C 或 B2 缺陷。

### C3 实施记录

以下是初版实施记录；后续用户要求移除详情中的能力／Source 区块，并调整为全局／工作区暂存保存，最新行为见“范围下拉框与单一 Save”一节。

- `lib/tool-orchestration.ts` 使用 SDK 合并设置，默认 on／3000；接受预算 0。项目写入复用 canonical-cwd 锁及 SDK 文件锁，以全局／项目原文和信任状态计算 revision，冲突返回 409；恢复继承只删除项目 `mode`／`inlineBudget`，保留其他键和 BOM／缩进／换行格式。
- Tools 的 codemode 详情增加 mode／预算、配置来源、保存／恢复继承及草稿冲突提示。开关／exposure 仍单独保存；不因设置 only 自动切换工具的曝光或绕过权限。
- `rpc-manager` 复用资源变更通知和 idle reload。运行中保持 pending，下一 prompt 等待 reload／扩展绑定；失败不确认资源 revision，显示 failed 并允许空闲重试。启动绑定／重载未完成显示 applying。
- 运行状态只绑定显式选定且 cwd 匹配的现存会话；没有该会话时能力未知，不使用同 cwd 兄弟会话代替，不创建 AgentSession。registered、active、callable 和实际 exposure 使用公开 SDK 信息；实际模型声明无法可靠观测，明确显示未知，不从 active 推断或读取私有字段。
- Tools 每 5 秒及 focus／visibility 刷新；旧 GET／PATCH 不覆盖新 scope。已保存与已应用分开显示；原生 codemode 禁用／替换／owner-hidden 时不给出可用承诺，受信任校验继续生效。两个间接入口都不可用且存在 codemode／deferred 工具时给出提示，不擅自改成 direct。
- **构建通过**：在当前工作区执行完整 `npm run build`（TS7、typecheck、Next、命令自带 npm pack），日志 `/tmp/pivot-c3-build.log`；Pivot 保持 1.2.2，保留 13 条既有追踪警告。
- **验收未执行**：本批未创建／修改／运行测试、lint、浏览器／真实模型验收或控制服务，未提交／发布；之前 538 项回归发生在 C3 前，不作为 C3 证据。仍待授权验证 on／only 的真实 prompt／声明、预算 0、继承／冲突、多会话／worktree、延后应用／失败重试、deferred 搜索及权限／owner-withdrawal。C4 未开始。

### C3 Tools 用户调整：全局／工作区暂存保存

本节记录上一版双按钮方案；后续按用户要求改为范围下拉框与单一 Save，见下节。

- 按用户要求移除详情中的“所选会话能力”和文件 Source 区块；后台能力数据保留，不恢复这两个详情区块。MCP 的编辑布局／凭据控件和独立配置流程未改动。
- 工具开关／exposure 与 Codemode mode／预算统一暂存到弹窗编辑状态；切换工具、标签页和后台轮询不触发保存。底部 Refresh／Close 左侧提供“保存到全局”和“保存为工作区覆盖”，一次保存当前工作区的全部已编辑项。
- 全局工具规则新增 `<agentDir>/pivot-tools.json`，与受信任项目规则按 enabled／exposure 分别合并；未编辑字段不被当前工作区的有效值隐式冻结。Codemode 继续使用 SDK 全局／项目 `settings.json`。界面显示保存来源及全局／默认值；全局保存不移除现有项目覆盖。
- “恢复继承”只是草稿，使用工作区保存才删除对应项目字段；含恢复操作的草稿不能保存到全局。不同 cwd 的草稿独立缓存；关闭、手动 Refresh 和页面离开提示未保存修改；冲突和失败保留草稿。
- `lib/tool-settings-save.ts` 提供 revision 校验、canonical-cwd 锁、同步 SDK 兼容文件锁及两文件写入失败回滚。只合并编辑键，保留未知键、BOM／缩进／换行及文件权限；项目保存继续要求信任。全局保存通知全部现存会话，项目保存只通知该 cwd；运行中仍延后应用，保留 owner-hidden、MCP 原生管理与每轮捕获的权限规则。
- 工作区完整 `npm run build` 通过（TS7、typecheck、Next、命令自带 npm pack），日志 `/tmp/pivot-tools-global-save-build.log`，保留 13 条既有追踪警告。未创建／修改／运行测试或 lint，未做浏览器／真实模型验收、重启服务、提交、升版本或发布；这些行为覆盖仍待授权，C4 未开始。

### C3 Tools 用户调整：范围下拉框与单一 Save

- 底部两个保存按钮替换为 Global／With workspace override 下拉框和一个 Save，仍位于 Refresh／Close 左侧；默认工作区范围。Global 显示全局配置加工具／SDK 默认值，不读取项目覆盖作为显示值；With workspace override 显示全局与可信项目覆盖叠加后的值。工具开关、exposure、Codemode mode／inlineBudget 同步切换范围。
- 草稿按 cwd＋范围分别缓存，切换工具／范围不保存、不丢弃；Save 只提交所选范围的全部已编辑项。按用户后续要求移除 Saved 成功提示区域；保存错误仅在 Save 按钮旁以 alert 显示，并按会话／工作区／设置范围绑定，切换时不显示旧范围的错误。错误／冲突保留草稿，关闭／Refresh／页面离开仍防止静默丢失修改。
- 移除详情中的 enabled／exposure／Codemode 配置来源、全局／默认值旁注、通用暂存／继承帮助及 Restore inheritance 按钮；保留工具描述、参数、选项含义和真实错误／不可用提示。不恢复已移除的会话能力或 Source 文件路径区块，不调整 MCP 编辑流程。
- 全局编辑使用两个全局文件的独立 revision；工作区编辑继续检查全局＋项目组合 revision。工作区覆盖变化不再使纯全局草稿冲突；全局修改仍会使依赖其继承值的工作区草稿提示冲突。现有文件锁／回滚、信任／owner-hidden、通知范围与 idle 应用规则不变。
- 当前工作区完整 `npm run build` 通过（TS7、typecheck、Next、命令自带 npm pack），日志 `/tmp/pivot-tools-scope-selector-build.log`，13 条既有追踪警告保留。未运行测试、lint 或浏览器验收，未重启服务、提交、升版本或发布；C4 未开始。

- 后续 UI 微调（以最新调整为准）：With workspace override 范围下，Enabled、Exposure、Mode、预算标题按当前展示／草稿值与全局／默认值的差异加粗；改回相同值立即取消加粗，`false`／`0` 按实际值比较。Global 范围不加粗。工作区 Save 在文件锁内重新读取全局值，将本次已编辑且与全局／默认值相同的字段从覆盖配置删除，恢复继承；未编辑字段、未知字段和其他配置保留，Global Save 不变。改回全局值的草稿仍保持可保存。兼容的单项工具／Codemode 保存入口同步采用相同规则。本轮 `npm run build` 通过，未运行测试／浏览器行为验收。
- 本次微调完整工作区 `npm run build` 通过，日志 `/tmp/pivot-tools-override-labels-build.log`；仍有 13 条既有追踪警告。未运行测试、lint 或浏览器验收，未控制服务或提交／发布。

## 6. C4：费用与统计

- 涉及 `ToolResultMessage.usage`、`useAgentSession` 的实时／fallback 统计、`rpc-manager` 统计响应及只读历史 entry 聚合；统计辅助逻辑可拆出小模块，避免 UI 重算定价。
- 以父工具结果已汇总的 usage 为权威，不再累加 nestedCalls 或实时子结果；reasoning 已包含于 output，不能再加。保留没有 usage 的历史，不虚构费用。
- 活跃完整会话优先使用 SDK `getSessionStats()`，只读历史不创建 AgentSession；区分当前分支／上下文与完整会话总量，明确 usage entry、压缩／分支摘要及非上下文费用的归属。
- 展示现有 classifier／图片模型经 codemode 产生的工具 usage，不借此新增非 chat 模型工作台、typed catalog 编辑器或 virtual router UI，这些仍归 D。
- 验收目标：父／子不重复计费、重放幂等、失败或取消前已发生的费用、上下文与全会话区别、分支／压缩／恢复／只读历史与 SDK 口径一致。

### C4 实施记录

- `lib/session-usage.ts` 按 SDK 账本入口汇总 assistant、父 toolResult、独立 usage、compaction 与 branch_summary；父结果已含子调用，reasoning 不另加。分类为聊天／工具／其他；普通工具没有 usage 不假定发生模型计费，缺失的模型／摘要费用则保留不完整标记。明确记录的零费用照常显示，缺少记录不冒充零。
- `lib/session-statistics.ts` 和只读 `/api/sessions/[id]/stats` 从全部 entries 与指定 leaf 的祖先路径分别统计，不使用压缩后的展示消息作为账本。已存在的 runtime 优先调用 SDK `getSessionStats()`；历史仅打开 SessionManager，不创建 AgentSession、启动 MCP、调用模型或改写 JSONL。SDK 对旧缺失字段不能给出有限值时保留只读部分记录。
- `useSessionStatistics` 用 session／leaf／run 标识隔离快照，消息完成及运行／压缩状态变化重新读取；运行期每 3 秒、恢复在线／焦点／可见性后收敛。不增量累计临时 SSE 消息，失败保留同范围上次快照并标记；失败读取自动重试，不清零已记录支出。
- 原会话信息面板新增完整会话／当前分支选择，展示对应消息／Token 累计、已记录费用及分类；SDK 当前上下文占用不随范围切换，缺少上下文数据明确标记未记录。工具父卡片仅显示父结果自带的汇总用量，不虚构子费用。说明 SDK 费用并非最终账单。
- 当前工作区 `npm run build` 已通过（编译、typecheck、Next 与命令自带 npm pack），日志 `/tmp/pivot-c4-usage-build.log`，保留 13 条构建追踪警告。本轮未创建或运行测试、浏览器或真实模型验证。没有提交、版本更新、发布或服务控制；C3 未完成的行为专项和 C4 验收均后补，Stage D 未开始。

## 7. 实施与验收安排

这些条目是后续验收计划，不是本轮测试执行授权，也不是已通过证据。

- 每批先完成数据契约和小组件，再接事件／API；保留既有文件访问、信任、权限与运行协调边界。没有活跃会话时，能力状态标记未知或仅展示配置，不为读配置创建会话／连接 MCP。
- 完成代码开发后仅在当前工作区运行 `npm run build`；不额外打包、备份、隔离安装或控制服务。专项测试、浏览器交互、实际模型调用及安装验证须用户明确要求后执行。
- 用户授权专项验证后，优先本地 fixture 验收 C1–C4 行为，再明确哪些真实账户／第三方 MCP／Windows 项目需人工验收；不放宽断言、不改 SDK 安装文件来掩盖差异。
- C1–C4 验收完成后再进入 D；最终集成与统一发布门槛保持不变。本计划不授权提交、升 Pivot 版本或发布。

## 8. 授权自动化补测记录

用户要求为阶段 C 未执行的部分创建和运行测试，通过后提交；另确认全部待提交改动按主题拆分（含 pi 1.1.0 兼容），不推送，不更新 Pivot 1.2.2，不控制服务。

- 新增 40 项测试：`lib/nested-tool-state.test.mjs` 11 项、`lib/session-usage.test.mjs` 7 项、`lib/tool-settings-save.test.mjs` 6 项、`lib/stage-c-routes.test.mjs` 5 项、`components/stage-c.browser.test.mjs` 5 项；`lib/rpc-manager-sdk.test.mjs` 新增 5 项，`lib/workspace-tools.test.mjs` 新增重复模块错误识别 1 项。既有测试同步最新契约，未删除用例或放宽状态码／数值断言。
- C1／C2：图片来源安全、只读图片 API 的 entry／tool／索引／MIME 边界，真实浏览器 blocks 图片懒挂载与 plain 顺序／返回全折叠；嵌套并行根／多层／重放／迟到事件／断线 unknown、保存摘要权威、0ms、循环与 orphan 防御、256 子调用／64 根／参数与预览总预算。
- C3：字段继承（含 false／0）、仅删除已编辑的匹配覆盖、未知字段／BOM／缩进／换行保留、全局／工作区 revision、并发写、失败回滚、通知范围、信任只读与显式授权、active Pack 管理权释放；无头浏览器挂载 editor／trust hooks，检查草稿隔离、错误保留和过期响应。真实 AgentSession＋本地 stream 捕获 on／only 声明和 SDK guideline，运行期 pending、reload 失败重试、同 cwd 双会话及另一 worktree 隔离、codemode 子调用 SDK 权限拦截；既有 deferred 搜索与 owner-withdrawal 回归通过。
- C4：父工具不重复加子费用，reasoning 不重复加 output，全部 entries／压缩前祖先与兄弟分支、独立 usage／摘要、缺少费用／显式零、错误／取消、历史保留 usage、SDK 与只读 API 一致且历史读取不创建 runtime／改写文件；浏览器检查 session／leaf／run 迟到请求、失败保留同范围快照、online、运行轮询与结束／revision 刷新。

- 首轮失败修正：确定性账本 fixture 使用整数费用避免十进制浮点比较歧义，使用 SDK 实际 `branchWithSummary()`；rollback 故障注入在新 Jiti 模块捕获 fs 引用前安装。原生 codemode 默认 inactive，声明／权限用例显式启用它，不通过产品代码擅自激活。旧 Pack fixture 改为 active receipt，禁用后仍断言保留定义与 disabled 覆盖；旧 trust fixture 改为 Trust 按钮契约并断言不弹第二次确认，SettingsManager 假对象改用真实 SDK。
- 修复配置错误在重复模块实例下 `instanceof` 不一致而把 409 返回成 500 的边界：ToolSettingsError 使用稳定 Symbol 品牌及严格 Error／status 范围检查；伪造普通 status 对象不能通过。保留 API 的 stale=409、unknown/native=404、invalid=400 断言。
- 完整回归显式列举 app／components／hooks／lib／scripts 下 `*.test.mjs`：**578 项，574 通过、4 跳过、0 失败／取消**。4 跳过是既有 Windows PTY 3 项和未配置生产目录的页面冒烟 1 项，新增 C 用例没有跳过。`npm run build` 在当前工作区通过，保留 13 条既有 Turbopack 追踪警告；日志 `/tmp/pivot-stage-c-regression.log`、`/tmp/pivot-stage-c-tested-build.log`。

```bash
mapfile -t tests < <(find app components hooks lib scripts -type f -name '*.test.mjs' | sort)
node --test --test-concurrency=2 "${tests[@]}"
npm run build
```

- 这些证据是本地单元、真实 SDK＋假模型和 Chrome fixture，不是付费模型、生产 Next 页面／完整 AppShell 导航、移动端整应用布局或第三方服务器全矩阵验收；真实账户、部署、consumer 安装及 Windows PTY／ACL 门槛保持不变。Stage D 未开始。

## 9. 依据

- pi 1.0.4 的 `docs/sdk.md`、`docs/extensions.md`（嵌套调用／ToolLoadout）、`docs/codemode.md`、`docs/settings.md`、`docs/message-types.md`。
- SDK `core/nested-tool-calls.d.ts`、pi-ai 的 NestedToolCalls／Usage 类型与实际 Pivot 渲染、事件投影、工作区工具规则。
- [1.0.4 release](https://github.com/earendil-works/pi/releases/tag/v1.0.4)；原计划第五、六节及 17.14 的增量评估。
