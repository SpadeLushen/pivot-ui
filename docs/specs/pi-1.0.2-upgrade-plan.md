# Pivot UI 适配 pi 0.99 → 1.0.3 升级计划

> 当前工作流程以 AGENTS.md 为准：仅在当前工作区执行 `npm run build`（包含其自带打包），不再自动建立隔离构建目录、备份或同步运行目录，不停止／重启现有服务。
> 17.8–17.10 是历史实施记录，不再授权其中的隔离构建、备份、同步或 Pack 继承操作。最新实现与验证见 17.11；真实账户、第三方 MCP、Windows Terminal／ACL 的人工验收仍不能由本地自动化代替。
> 项目 SDK 为 1.0.3，Pivot 保持 1.2.2；本次仅按明确要求分组提交，不发布或推送。
> 已确认决策：Pivot UI 跟随 pi 升级到 TypeScript 7，纳入阶段 A 的 P0 范围。
> P0 目标：在已实施的 1.0.2 基础上完成 1.0.3 必要现有功能兼容；代码与隔离自动化已完成，不等同完整实机验收，既有人工验收及部署门槛仍保留。
> P0 边界：不新增功能；假设用户不使用原生 MCP、codemode 等新功能，原生 MCP 共存适配也不在 P0 范围内。
> 发布策略：P0–P2 全部完成并通过验收前不发布；分阶段仅为方便开发、测试和定位问题。
> P1 最新决策：切换原生 MCP 作为 breaking change，不提供任何迁移／导入／目录补全功能；旧方案撤销，见第四节。现已实现原生配置管理及工作区 Tools／Packs 开关，现有用户文件不自动迁移。
> 当前工具策略：移除旧预设控件、忽略旧预设记录；默认使用可用工具并尊重工作区启用／Exposure、owner-hidden 及 SDK 原生 MCP 的激活规则。
> 已实施项与验证结果以文末记录为准；其余仍为计划，不代表已实现或验收通过。

## 待处理的 P0 项目

当前无待处理的 P0 开发项目。已完成的实施与验证记录见 17.8、17.9。

## 一、结论

**此前 1.0.2 阶段已将三个项目 SDK 声明与锁文件同步提升到 `1.0.2`，完成隔离安装、现有功能自动化回归和打包验证，保留原生 TS7 工具链。2026-10-05 已在当前工作区生成 1.0.2 产物，但按用户要求未停止／重启 WinSW；真实 OAuth／MCP／Terminal 验收和运行进程重启仍待完成，因此不宣称完整 P0 实机验收已通过。新能力仍放到 P1/P2。**

**1.0.3 有 P0 项：Azure provider 更名会破坏既有 Azure 凭据／配置／默认模型及旧会话恢复；OAuth refresh 被取消时必须仍持久化已轮换的 refresh token。前者是旧 Azure 用户的兼容阻断，后者是既有 OAuth 的凭据完整性修复。SDK 同步与普通 Shell 输出文件权限纳入 P0 升级／回归；Azure 新模型、codemode 图像和 durable 新环境能力不因此前移到 P0。1.0.3 的代码／隔离验证结果见 17.8，不代表已部署或通过完整人工验收。**

**P0–P2 是开发与测试阶段，不是分批发布计划。全部阶段完成并通过验收后才统一发布，P0 或 P1 完成时均不发布。**

本地验证要同时覆盖 Pivot UI 使用的项目 SDK 依赖和本地 pi 环境：只升级全局 pi CLI 不会自动升级 Pivot UI 固定版本的 SDK。P0 应将项目依赖同步升级，并在现有 adapter／扩展／配置的实际本地环境中验证兼容性。

### P0 范围与前提

- 保持现有功能、交互和配置语义，不借升级新增界面、能力或迁移流程。
- MCP 继续使用现有 `pi-mcp-adapter` 路径，保证已有 MCP Library、Packs 和工作区配置操作可用。
- 不注入原生 MCP、codemode、tool_search 内置扩展，不设计 adapter/native 共存、检测、切换或迁移机制。
- 假设用户及其扩展不使用此次新增能力，包括原生 MCP、codemode、tool_search、虚拟模型、classifier 和图片生成。
- 新 OpenAI ChatGPT 登录接入不在 P0；已有 API key、Codex 等认证必须保持可用。
- 修复升级导致的类型、API、生命周期、持久化、渲染和打包不兼容；仅在恢复既有行为所必需时调整实现。
- 会话落盘补丁是明确的 P0 必做项：主动适配上游首条用户消息落盘机制，处理 `_rewriteFile()`／`flushed` 补丁及相关边界，不以“当前未发现回归”为由后置。
- TypeScript 7 升级仍是已确认的 P0 必做项。
- 第四至十节的新能力方案保留为后续规划，不据此扩张 P0。

此次不是单纯更新依赖版本。主要变化集中在四个方面：

1. **原生 MCP 替代 adapter（breaking change）**：涉及扩展加载、配置格式、认证及后续 Pack 管理，不提供旧数据迁移。
2. **工具编排模型变化**：工具“已注册”“已激活”“可被 codemode 调用”不再是同一个概念。
3. **消息与统计扩展**：新增嵌套调用记录、工具费用，以及虚拟模型的选择／执行分离。
4. **已有集成补丁需要重新评估**：尤其是会话强制落盘、工具预设、空系统提示和纯文本 Theme。

**主要问题及阶段归属**：

| 问题 | P0 处理 | 后续处理 |
|---|---|---|
| 依赖与编译器升级 | SDK 1.0.3 声明／隔离安装与兼容已实施，部署／人工验收待完成；TS7、现有 API、实际 compiler 与构建／运行时一致性 | 新 runtime worker／WASM 执行验收 |
| 新内置扩展不会自动进入 SDK 会话 | 维持现有扩展装配，不注入新内置扩展 | P1 显式装配 MCP、codemode、tool_search |
| ChatGPT 登录缺少 `getDeviceId` | 回归已有认证；不接入新登录方式 | P1 接入新 ChatGPT 登录及 deviceId |
| MCP 配置仍面向 adapter | 保留 adapter schema、状态检查与 Pack 所有权语义 | P1 原生 MCP breaking change，不提供迁移／导入，原生配置管理后续实现 |
| 工具预设与 exposure | 临时统一全部可用工具，移除前端预设，不绕过 hidden／权限扩展 | P1 专项重构能力模型和编排开关 |
| 嵌套调用展示缺失 | 不新增父子调用界面 | P1 实时父子调用及历史恢复 |
| 费用统计 | 保持现有统计、SDK 结果及格式可用 | P1 新工具 usage、嵌套费用和统计口径增强 |
| 虚拟模型 selected/routed 混淆 | 回归现有物理模型选择与恢复 | P1 分开返回 selected/routed model |

## 二、调研范围与判断依据

已完整阅读两份 changelog，并对照：

- Changelog：`I:\pi_changelog_0.99.0.md`、`I:\pi_changelog_0.99.1.md`。
- pi 源码：`I:\pi_git`，初次调研为 `v0.99.1`；2026-10-04 补充调研为 `v1.0.2`。
- 增量依据：官方 [releases](https://github.com/earendil-works/pi/releases) 的 v1.0.0、v1.0.1、v1.0.2，以及 `git diff v0.99.1..v1.0.2`；新增 v1.0.3 release、tag `d78dc83d633229d12f8b79631384c4c2717c399f` 与 `git diff v1.0.2..v1.0.3`，见第十七节。
- 关键版本差异：`v0.87.1 → v0.99.0`。
- Pivot UI 初始 SDK 基线为 `0.87.1`，曾完成 `0.99.1` 适配；当前三个直接 pi 包声明与锁文件均固定为 `1.0.3`；工作区运行依赖／产物也已同步 1.0.3，隔离验证见 17.8、工作区验证见 17.9。
- Pivot UI 的 SDK 会话、工具预设、MCP Library／Packs、认证、模型列表、聊天渲染、会话导出和打包实现。
- pi 的 SDK、MCP、extensions、virtual models、themes、message/session format 等文档与示例。

最初的 0.99 结论来自静态调研；后续代码、自动化和实际生产页面验证见文末记录。实际 OAuth 和 MCP server 连接不能用静态分析或状态 ready 代替验收。

优先级定义：

- **P0**：本地 pi 升级的现有功能兼容阶段（1.0.3 源码／隔离自动化已实施，部署及人工验收待完成），以及已确认的 TS7 升级；不包含新功能、原生 MCP 共存或配置迁移。完成后可在上述前提下本地日常使用，但不发布。
- **P1**：P0 完成后的首轮新功能适配；其前置工作属于 P1，不回溯归入 P0。
- **P2**：后续增强。
- **自动受益**：主要由依赖升级获得，保留回归验收。
- **无需适配**：终端专属变化，不影响 Web 主界面。

## 三、兼容底座升级

### 3.1 依赖、运行环境与发布包

**对应改动**：TypeScript 7、ES2024、Node 原生 type stripping，以及新增 MCP／codemode 依赖。

**计划：P0**

涉及：

- `package.json`、锁文件。
- `tsconfig.json`、类型检查命令、CI 配置及开发文档。
- `next.config.ts`。
- `scripts/pivot-runtime-aliases.js`。
- `scripts/prepare-package-runtime.js`。
- `scripts/restore-package-runtime.js`。
- `bin/pivot-ui.js`。

实施建议：

1. `pi-ai`、`pi-coding-agent`、`pi-tui` 声明／锁文件已一起固定到 `1.0.3`，隔离安装中重跑现有回归；工作区运行依赖／产物已同步 1.0.3，进程运行状态与人工验收单独记录。
2. 保持服务端 SDK externalization，确保现有服务端功能可在源码和发布包中运行。
3. 检查新增传递依赖是否影响安装、模块加载及现有功能；按必要性修复依赖解析，不以此启用新 runtime。
4. QuickJS WASM、codemode worker 的执行和资产路径验收移至 P1；P0 仅处理它们若导致现有启动／构建失败的兼容问题。
5. 继续沿用现有 npm／pnpm runtime aliases 恢复机制，**不要假设所有依赖都在包内的 `node_modules`**。

**已确认：Pivot UI 跟随 pi 升级到 TypeScript 7，作为阶段 A 的 P0 必做项。**

TypeScript 7 实施要求：

1. 更新 TypeScript 编译器依赖和锁文件，统一本地、CI 与构建环境的版本。
2. 审查 `tsconfig.json`，迁移不再支持的选项并修复新版类型诊断，不用扩大类型豁免掩盖问题。
3. 更新类型检查命令、CI 配置及开发文档中的编译器使用说明。
4. 核查 Next.js 的类型检查、TypeScript 配置处理和相关工具链兼容性；如需升级配套依赖，应纳入同一阶段。
5. ES2024 target 和 Node 原生 type stripping 与编译器升级分别评估，不因采用 TS7 自动照搬 pi 的运行方式；Next.js 应用仍沿用自身构建流程。

验收：

- TypeScript 7 类型检查通过，本地、CI 和构建环境使用一致的编译器版本。
- Next.js 开发启动、生产构建及相关测试工具链与 TS7 兼容。
- 源码启动和发布包启动均正常。
- npm、pnpm、跳过安装脚本的安装方式均可运行。
- 发布包中的现有聊天、认证、adapter MCP 和扩展可正常加载运行。
- codemode worker／WASM 和新 ChatGPT 登录的专项验收不作为 P0 门槛。

### 3.2 SDK 扩展加载与诊断

**对应改动**：内置扩展、替代警告、`builtin:<name>` 来源命名、禁用内置扩展。

**计划：P0 保持现有扩展加载、命令和 reload 可用；以下新内置扩展装配与诊断界面属于 P1。**

P0 不注入新内置扩展，不新增 Built-in 配置区域或替代提示；仅修复新 SDK 来源信息、接口变化等对已有扩展和 Plugins 功能造成的回归。原生 MCP 与 adapter 共存不做 P0 调研或实现前置要求。

主要位置：

- `lib/rpc-manager.ts`。
- `app/api/models/route.ts`。
- `app/api/plugins/route.ts`。
- `components/PluginsConfig.tsx`。

pi 文档明确：**SDK 会话不自动加载 CLI 的 MCP、codemode、tool_search 内置扩展。**

建议通过 `createAgentSessionServices()` 的 `resourceLoaderOptions` 注入：

- `createMcpExtension()`。
- `createCodemodeExtension()`。
- `createToolSearchExtension()`。

若希望同时支持 `-builtin:mcp` 等设置和第三方替代行为，应使用具有正确名称、`builtin: true`、相应 `replaceable: true` 的定义，而不是只复制匿名 factory 示例。

同时：

- 把 `services.diagnostics` 和 resource collision warning 展示给用户。
- 区分 `builtin:mcp` 等合成来源与真正文件路径。
- 在 Plugins 中增加独立 Built-in 区域，不把内置扩展伪装成 npm package。
- 内置扩展开关应操作 pi 的 `extensions` 设置，不能复用现有“清空 package resources”逻辑。
- 新建、恢复、reload 必须使用同一套扩展装配规则。

验收：

- 用户禁用的内置扩展不会被 Pivot UI 强行重新启用。
- 第三方扩展替代内置 MCP 时有明确提示。
- reload 后命令、工具和 Provider 能力一致。
- 只查询模型列表时不会启动 MCP 子进程。

### 3.3 会话落盘补丁

**对应改动**：首条用户消息到达时保存会话，不再等待 assistant 回复。

**计划：P0 必做，主动处理现有补丁，不仅在发现回归后才处理。**

当前 `lib/rpc-manager.ts` 为绕过旧版“等首条 assistant 回复才落盘”的行为，仍调用：

```text
sessionManager._rewriteFile()
sessionManager.flushed = true
```

pi 0.99 已改为首条用户消息到达时落盘。P0 应接入这个机制，移除或替换重复的强制落盘补丁，避免继续把上述私有字段操作作为常规新会话创建路径。

实施要求：

1. 审查新建、`ensure_session`、首条发送和 Fork 的完整持久化流程，区分“运行时已创建”和“会话文件已存在”。
2. 普通首条用户消息的落盘交给新版 SDK；同步处理文件路径缓存、会话列表刷新和 Sidebar 可见性，保持既有功能与交互。
3. 空会话或空分支若仍需特殊持久化，明确其必要性和实现边界，优先使用公开接口；如必须保留局部兼容方案，应单独隔离并说明依据，不能无条件沿用旧补丁。
4. 处理 `ensure_session` 只查询命令、首条输入被 extension 消费等无普通用户消息的场景。
5. 确保首条回复失败／中止时用户消息已经持久化。
6. 处理首条用户消息前的 Fork：不能假定返回路径已落盘后立即重新 open，须保证新 session ID、文件和 parentSession 关系一致。

**不能仅删除补丁就算完成**，也不能借处理补丁新增产品功能或随意改变空会话的现有可见性。与此无关的生命周期重构仍可后置。

验收：

- 首条用户消息无需等待 assistant 回复即已保存，失败／中止后重新打开仍可恢复。
- 新建、Sidebar 刷新和会话路径解析无回归。
- `ensure_session`、extension 消费输入和空会话行为符合既有约定。
- 首消息前／后的 Fork 均可继续使用，session ID 和父链正确。
- 不产生重复 header、`EEXIST` 或丢失／重复消息。
- 常规新会话路径不再依赖旧强制落盘补丁；任何保留的例外都有明确依据和测试覆盖。

## 四、原生 MCP 切换：breaking change，不提供迁移

**用户最新决策取代此前全部迁移／目录补全方案。** 原生 MCP 是 breaking change，不提供自动或手动迁移、导入、补全、旧版本基线判定或恢复功能。文档其余章节中的旧阶段验证只作历史记录，不再构成产品要求；Pivot 版本号不因此自动修改。

### 4.1 原生加载与用户配置

- SDK 会话显式装配 MCP、codemode、tool_search 内置扩展；保留 trust、权限 hooks、hidden/exposure 和正常 SDK prompt。
- 全局配置位于 `<agentDir>/mcp.json`（默认 `~/.pi/agent/mcp.json`），受信任项目配置位于 `<cwd>/.pi/mcp.json`。仅支持 pi 原生格式，不导入旧 `.mcp.json`、adapter 专用配置、Library 定义或 Pack receipt。
- 已有原生配置继续按 SDK 规则加载；旧 adapter 设置、Library、凭据、迁移标记和备份不自动删除、恢复或改写，不重算哈希。用户自行重建所需原生配置及认证。
- 第三方接管 `/mcp` 仍按 SDK replacement warning 报告；不擅自禁用插件，用户通过 Plugins 自行处理。

### 4.2 不提供兼容迁移

- 删除迁移 API、全局提示、手动导入／补全入口、来源快照、状态文件读写、迁移事务及专用服务加载屏障。
- 新建／已有会话的 prompt、steer、follow-up 不再查询迁移状态，不存在迁移决策的 409 拦截。
- MCP 菜单仅提供 breaking-change 与配置路径说明，不在启动时自动弹出，不包含迁移动作。
- 原生配置编辑、Library/Packs 的 MCP 配置管理仍在后续阶段。旧 adapter 写入接口固定返回 `501 NATIVE_MCP_CONFIGURATION_UNAVAILABLE`，与旧标记无关；含 MCP 变化的 Pack 操作被服务端拒绝，纯 Skills 操作保留。

### 4.3 验收与交付

验证无旧标记、待决标记及已成功旧标记均不阻断发送，不显示迁移提示，不改写已有配置；删除的迁移 API 返回 404。继续验收真实原生 MCP 调用、codemode worker、权限拒绝、未信任项目不执行、SDK 替代诊断、子进程关闭、类型检查／回归／隔离构建及打包。
最终依赖及生产产物按约定备份、同步运行工作区，不自动停止／重启服务。不发布、提交或修改 Pivot 版本号。

最新验证：完整回归 440 项，436 通过、4 跳过、0 失败；聚焦测试 27 项通过。全新隔离目录重新 typegen、typecheck、`npm run build`／pack 成功；lint 为原有 9 条 warning。真实浏览器覆盖无旧标记、待决标记、已成功标记和干净安装，旧 API 的 GET／POST 均为 404，prompt／steer／follow-up 无迁移拦截，原生工具和 codemode 可用，旧文件字节不变。npm／pnpm 跳过 install scripts 的消费包启动通过。

已备份、同步完整生产产物及包：1227 个文件逐文件 hash 与隔离构建一致，四个 aliases 恢复、SDK／真实 SWC 核对一致，确认无迁移路由或遗留路由产物。tarball SHA-256：`9221503c646ab807c21f16fe4e2c5be72fde4e90c0b7b7ce09e3f4beefb661ee`。备份：`F:/MyWorkspace/Node_Workspace/pivot-ui-build-backups/before-mcp-b1-2026-10-06T18-38-32.502Z`。运行工作区新起隔离测试进程通过浏览器、原生加载及待决旧标记不拦截验证；工作区 typecheck 通过。WinSW 仍为 Started，未重启；真实 MCP 配置、旧标记和备份未处理，需用户手动重启加载新产物。

## 五、codemode、tool_search 与工具预设

**最新优先级：codemode 已随原生 MCP 启用，后续实现优先级提升为 MCP 之后的下一项，先完善 codemode 使用体验，再开展工具能力选择专项重构及其他 P1/P2 新能力。独立的小型展示优化可先落地，不等待完整编排配置界面。**

### 5.1 重构工具能力模型

**计划：P1 专项重构，启用编排前完成。按最新决定，P0 临时统一使用全部可用工具，并移除前端预设选项；不再维护 none/default/full 切换兼容，不新增 exposure-aware 配置。旧记录保留但忽略，不清空 system prompt，不注入新的原生扩展 factories。**

主要位置：

- `lib/tool-presets.ts`。
- `lib/pi-types.ts`。
- `lib/rpc-manager.ts` 的 `get_tools`／`set_tools`。
- ChatInput 工具选择界面。

需要分别表达：

1. registered：工具已注册。
2. active：工具进入活动集合。
3. callable：可通过 `ctx.executeTool()` 调用。
4. exposure：direct、model-only、codemode、deferred、hidden。
5. 实际声明：还可能被 `prepareLoadout()` 隐藏。

原 `withExtensionTools()` 会激活所有非 builtin 工具，现已退出运行路径。临时“全部工具”策略也不提供延迟声明／token 节省优化；P0 假设不使用新编排能力，P1 必须重新设计 exposure、默认激活和权限边界，不能把临时策略当作最终能力模型。hidden 工具仍不得激活。

同时，`builtin` 将包含内置扩展工具，不能继续把 `source === "builtin"` 等同于“八个文件／Shell 工具”。

建议：

- 是否恢复 `none/default/full` 或采用其他能力选择模型，由专项重构确认；当前不保留前端选项。
- codemode 和 tool_search 单独控制。
- 尊重 extension 的 exposure 和默认激活状态。
- 默认预设与 pi `defaultTools` 的优先级明确化。
- 用户配置 `["+codemode"]` 时，不被 Pivot 的固定 default 预设悄悄覆盖。

### 5.2 “无工具”模式的兼容与后续强化

**当前 P0 不提供无工具模式**：新建、恢复、Fork、reload、旧客户端预设请求均不能将会话限制为 none/default；使用全部可用工具与正常 SDK prompt。旧预设元数据和偏好不删除、不应用。正在进行的模型请求不强制换 loadout，空闲后的下一次操作应用统一策略。

**P1**：以下原生 MCP／codemode 异步激活、嵌套调用及编排入口控制，在启用新能力前完成，不属于 P0。

原生 MCP 连接后可能自动启用 codemode／tool_search；codemode/deferred 工具也可能在未 active 时仍可被嵌套调用。

因此，“活动工具数组为空”不能当成完整禁用策略。

建议：

- 禁用所有编排入口。
- 防止异步注册和连接完成后重新激活。
- 对禁用期间的工具执行设置明确策略。
- 覆盖新建、恢复、reload、切换预设场景。

“无工具清空 system prompt”的旧补丁已移出当前运行路径；P0 只验证正常 SDK prompt 和工具声明。若专项重构重新引入无工具模式，应使用受支持的 SDK 边界并核查实际请求，不能写只读 `agent.state.systemPrompt`。

### 5.3 codemode 配置界面

**计划：P1**

首轮支持：

- 开关。
- `mode: "on" | "only"`。
- `inlineBudget`。
- tool_search 开关。
- 显示脚本、运行状态、输出和失败信息。

先以 `on` 模式为默认；`only` 作为高级选项，避免改变已有用户的全部调用路径。

无需在浏览器运行脚本。QuickJS sandbox 保持在 Node 服务端，调用仍通过 pi 的工具权限管线。

验收：

- 非 MCP 工具也可并行调用。
- deferred 工具搜索后可调用，并在当前分支保持加载状态。
- abort 会终止脚本及其嵌套工作。
- 中途报错保留部分输出。
- 权限扩展仍能拦截每个子调用，而非只审批最外层 codemode。

## 六、嵌套调用、结果渲染与费用

### 6.1 嵌套工具调用

**对应改动**：`ctx.executeTool()`、`parentToolCallId`、`nestedCalls`。

**计划：P1，随 MCP 之后优先开展的 codemode 增强实现；codemode 运行入口已启用，完整嵌套展示仍待实现。P0 不新增嵌套调用展示。**

涉及：

- `lib/types.ts`。
- `lib/pi-types.ts`。
- `hooks/useAgentSession.ts`。
- `components/MessageView.tsx`。
- timing／duration helpers。

设计：

- 实时事件按 `parentToolCallId` 归属到调用父项。
- 子调用不伪造独立 transcript message 或 entryId。
- 父项显示并行执行的子调用、状态和耗时。
- 完成后以父 tool result 的 `nestedCalls` 恢复历史展示。
- `complete: false` 显示“记录不完整”，不是执行失败。

pi 的历史记录限制是：

- 最多 256 个调用。
- 单调用参数最多 8 KiB。
- 参数总量最多 32 KiB。
- **不记录子调用结果正文**。

因此，刷新后只能恢复调用摘要，不能承诺恢复完整子结果。

### 6.2 通用结果与 MCP 图片

**对应改动**：arguments 展示、`structuredContent`、`outputSchema`、`isError`。

**计划：P1**

Pivot 已有通用参数和文本结果展示，不必照搬 TUI 的五行折叠方式。建议增强：

- MCP 标题显示 `server/tool`，保留真实工具名用于关联。
- **已实现的小优化**：展开 tool block 时，若参数仅有一个字符串 `code`，只显示其值；JSON 通道已解码换行／引号，直接显示字符串，不再次 stringify 或二次反转义。其他参数保持完整 JSON 展示。
- `isError: true` 的返回值显示为错误，不以“没有 throw”判断成功。
- 不将 `structuredContent` 误当成模型可见文本。
- 对大 JSON 按需展开，避免全量渲染。

当前 `ToolCallBlock` 的 paired result 只提取文本。需要补齐图片 block 展示，否则 MCP 图片、codemode `image()` 等结果可能在 Web 里不可见。

### 6.3 Shell 结构化输出

**对应改动**：bash／powershell 的 structured output 上限变为 1 MiB，新增 `truncated`、`full_output_path`，空输出为 `""`。

**计划：P0 回归现有 Shell 调用和结果展示；新增结构化输出体验属于 P1。**

- P0 保持普通模型可见输出的截断、空输出、错误及已有完整输出链接行为。
- 不把 1 MiB structured output 自动铺进聊天 DOM。
- 新的 structured output 字段展示或文件入口增强留到 P1，不作为 P0 门槛。

当前 `MessageView.tsx` 已同时接受空字符串和 `(no output)`，这一点不需要另写兼容层。

### 6.4 费用与 token 统计

**对应改动**：嵌套调用 usage 汇总到父结果；codemode classifier usage 计入费用。

**计划：P0 仅确保现有统计读取、计算及展示兼容新版 SDK；以下新费用来源和统计口径增强属于 P1。**

P0 不新增嵌套／classifier 费用明细，不扩大统计范围或修复与本次兼容无关的既有统计偏差。

当前前端统计 fallback 跳过所有非 assistant 消息，会遗漏工具 usage。

建议：

- 扩展 `ToolResultMessage` 的 `usage` 类型。
- 实时统计纳入父 tool result usage。
- **不要再次累加 nestedCalls，避免重复计费。**
- 全会话统计优先使用 SDK 的统计口径。
- 只读历史统计不创建 AgentSession，应从 session entries 聚合。
- 明确区分“当前上下文费用”和“完整会话费用”。
- 完整统计同时容纳 usage entries、compaction 和 branch summary usage。

后面这些不是全部首次出现在 0.99，作为 P1 统计增强一并评估，不阻塞 P0。

## 七、Prompt／Steer／Follow-up 回执

**对应改动**：输入 disposition。

**计划：P0 适配必要的 SDK 签名和行为变化，确保现有发送、排队、撤回、队列切换及取消可用；完整新回执接入和行为增强属于 P1。**

SDK 新语义：

- `steer()`／`followUp()` 返回 `"queued"` 或 `"handled"`。
- `prompt()` 通过 `preflightResult` 回调提供 `"started"`、`"queued"`、`"handled"`。
- `prompt()` Promise 仍是整个运行结束后才完成，不能用它充当即时接收回执。

当前 wrapper 都返回 `null`，并且 prompt 路径在运行中直接抛 `AgentBusyError`，没有利用 streamingBehavior 区分排队。

P0 保持现有 API 和界面语义；若新版返回语义导致消息丢失、重复或错误排队，只做恢复既有行为所需的最小适配。不能把扩展 HTTP 回执、新 UI 状态或额外排队能力作为 P0 前置条件。

P1 完整接入方案：

1. 将 disposition 从 wrapper 传给 API 和前端。
2. `handled` 不制造用户消息或队列项。
3. `queued` 以 `queue_update` 为队列权威状态。
4. `started` 才进入正常 run 展示。
5. 区分“忙时普通 prompt”与“明确 steer/follow-up prompt”。
6. preflight 之前的失败也要使 HTTP 请求及时结束。
7. 将本地结构类型从 `Promise<void>` 更新到新版返回类型。

另外，队列切换依赖的私有字段仍存在于新版源码，不能断言已失效；但应继续隔离在兼容适配层，保留重复文本、转换输入及 drain race 验收。

`RpcClient` listener unsubscribe 修复主要是自动受益：Pivot 主聊天走的是自建 HTTP/SSE wrapper，不直接使用该客户端。

## 八、ChatGPT 登录

**计划：P1。新的 OpenAI ChatGPT 登录和 deviceId 接入不在 P0 范围内。**

P0 只确保现有 API key、OpenAI Codex 等认证的登录、注销、取消、凭据存储和刷新在新版 SDK 下可用；不新增登录入口或调整 Provider 分组来承接新能力。

主要位置：

- `app/api/auth/login/[provider]/route.ts`。
- `app/api/auth/providers/route.ts`。
- `lib/model-runtime.ts`。
- `components/ModelsConfig.tsx`。
- 中英文文案。

### P1 接入必改事项

1. 调用 `runtime.login()` 时传入：

   ```text
   getDeviceId: () => globalSettingsManager.getOrCreateDeviceId()
   ```

   当前路由没有这个参数；源码中的 ChatGPT flow 会拒绝缺少有效 UUID 的登录。

2. UI 使用认证方法的 label，明确区分：
   - OpenAI API key。
   - OpenAI 的 Sign in with ChatGPT。
   - OpenAI Codex legacy。
3. 移除当前将 `openai-codex` 强制显示为普通 “ChatGPT Plus/Pro” 的混淆文案。
4. `deviceId` 由服务端全局保存，不放在 browser localStorage，也不由项目设置覆盖。
5. 手工回调必须允许粘贴**完整 callback URL**；不能简化为仅输入 code，因为新版还需要 state 和 issued client ID。
6. 保留旧 Codex 凭据和既有会话，不自动迁移或删除。

验收：

- 本机回调。
- 浏览器与服务器异机。
- 1455 端口被占用。
- 用户拒绝授权。
- 取消／断线／重复登录。
- token refresh。
- 发布包内 OAuth 模块可加载。

`0.99.1` 修复了 bundled release 缺少 `openai-chatgpt.js` 的问题，因此**不建议最终停在 `0.99.0`**。

## 九、虚拟模型

**计划：P1，在基础兼容后单独开发和测试，不单独发布**

现有模型列表通过 services 创建，已经适合承接 extension 注册的虚拟模型；无需另造路由框架。

但要修正显示和状态契约：

- **selected model**：用户选择的 virtual model。
- **routed model**：最近一次实际执行的 physical model。

当前历史读取使用 `buildSessionContext().model`。源码会根据 assistant message 更新该值，因此虚拟选择可能被最后执行的物理模型覆盖。不能把这个字段直接当作用户选择。

涉及：

- `lib/session-reader.ts`。
- `lib/types.ts`。
- `lib/pi-types.ts`。
- `app/api/models/route.ts`。
- `lib/rpc-manager.ts` 的 `get_state`。
- ChatInput 和会话统计界面。

实施：

1. 从分支 model selection metadata 读取 selected model。
2. live state 增加 `routedModel`。
3. 保留 assistant 的物理 provider/model 和 `thinkingLevel`。
4. 模型选择器对 virtual model 加标记。
5. 不假设 contextWindow／maxTokens 永远已知。
6. Thinking 选项使用 virtual model 自己声明的列表。
7. 统计按实际模型归类，不能把费用全归到 router。
8. 保留 `pi.virtual-model-state` custom entries，不转成聊天消息。

无需首轮开发“图形化 router 编辑器”；先保证已有扩展注册的虚拟模型可选、可恢复、可解释。

验收：

- 每轮路由至不同物理模型。
- reload、resume、Fork、分支切换和 compaction。
- router 被移除后的 fallback。
- routed model 上下文不足时的自动压缩。
- 路由失败和取消。

## 十、Classifier 与图片生成

### 10.1 Classifier models

**计划：P1 runtime 支持，P2 专门 UI**

覆盖：

- TypeSafe `jev-latest`。
- OpenRouter、Cloudflare、Vercel、OpenCode 的 Jev。
- llama.cpp classifier。
- codemode `models.classify()`。
- virtual router 调用 classifier。

建议：

- classifier 不进入聊天模型选择器。
- Provider 认证配置可支持 classifier-only Provider。
- 显示 codemode classifier usage。
- 使用同一 ModelRuntime 解析认证、headers 和模型。
- 专门的 classifier 测试界面后置。

注意：classifier 输出是模型判断，不应当作权限安全边界；不能因为某个分类结果是“安全”就跳过工具审批。

### 10.2 Image generation

**计划：P1 保持配置兼容，P2 产品功能**

新 API 包括 typed model accessors 和 `generateImages()`，但不代表 Pivot UI 应立即新增图片创作工作台。

首轮要求：

- chat picker 继续读取 chat-facing 模型列表。
- `models.json` 编辑／保存保留 model type 和未知字段。
- 按 `(type, provider, id)` 区分同 ID 的 chat/image/classifier。
- 模型测试不能把 image／classifier 一律送入 `completeSimple()`。
- extension 提供完整 model list 时，提示它可能替换整个 Provider 多操作 catalog。

后续若增加图片生成工具：

- 使用 `ModelRuntime.generateImages()`，不另做一套 API key 解析。
- 明确取消、超时、图片保存和费用记录。
- 通过右面板工具 registry 接入，避免往 AppShell 增加特例。

## 十一、Theme、导出与调试

### 11.1 System theme 和新颜色 API

**计划：Web 配色无需同步；P0 仅修复现有 extension UI／Theme bridge 的构造、调用、纯文本输出及交互回归。完整新颜色 API 支持属于 P1。**

Pivot 使用自己的 CSS 变量和共享 theme preference，不应直接换成终端 palette。

后续完整适配 `PlainTextTheme` 时需要支持：

- `theme.style()`。
- `theme.colors`。
- `theme.appearance`。

当前只覆盖 fg/bg 等方法；新增 `style()` 可能重新生成 ANSI，稀疏 token 初始化也不足以保证扩展做颜色计算时正常工作。

P0 若发现现有扩展或 custom UI 因 Theme API 变化报错、泄漏 ANSI，应做必要修复；否则完整 token、style、colors、appearance 支持留到 P1。多浏览器使用不同 Web theme 时，不要通过修改进程全局 Theme 来回切换。

新 `#rgb`、OKLCH、OKHSL 和 appearance 文件字段由 SDK 处理即可，不必在 Pivot 重写颜色解析器。

### 11.2 HTML 导出隐藏消息

**计划：自动受益＋P0 回归**

上游新增：

- `H` 显示／隐藏 `display: false` 消息。
- Sidebar 跳转时显示目标隐藏消息。
- nestedCalls 展示。

现有导出直接使用 pi exporter，原则上自动获得。

但 `app/api/sessions/[id]/export/route.ts` 依赖精确文本替换三个递归 helper。静态对比显示这些 helper 仍存在，此次新增主要位于其他区域，**不能因此免除实际导出回归**。

P0 保留深会话迭代补丁，验收已有 HTML 导出及深树处理；上游自动附带的隐藏消息开关可做基本回归，但不新增 Web 开关或嵌套调用界面，其专项验收放到后续阶段。Web 聊天本身是否增加隐藏消息开关可以放到 P2。

### 11.3 Provider stream events

**计划：P2**

`provider_stream_event` 是 extension notification，并非应直接透传所有原始数据的普通 SSE 事件。

建议：

- 默认关闭。
- 先支持现有 debug extension。
- 后续提供脱敏、有容量限制的诊断面板。
- 避免逐事件 React 更新。
- 不默认写入持久日志或导出报告。

慢 handler 会拖慢上游流消费，应避免同步重处理。

## 十二、其余 changelog 改动的处理清单

### 12.1 自动受益，但需要有针对性的回归

| 改动 | Pivot UI 升级计划 |
|---|---|
| Claude Sonnet 5.5、adaptive thinking、1M context | 使用 SDK 元数据；验收 thinking 选项和 context 展示 |
| Fireworks、OpenCode Go、Together 默认改为 Kimi K3 | 更新模型目录后验收新会话默认与旧会话失效提示 |
| `read` 的 null offset/limit | 验收参数预览，不再把 null 当作显式第一行 |
| llama.cpp autoload context window 修复 | 验收 contextUsage 不被训练上下文错误覆盖 |
| git package 不自动安装 Pi peers | P0 回归已有安装行为；新增 warning 展示属于 P1 |
| 固定 git ref 扩展更新 | 回归 Plugins update 和 reload，不另写 checkout 管理 |
| 长会话 streaming CPU 优化 | 后端自动受益；P1 新并行／嵌套调用展示需控制更新量 |
| `sanitizeBinaryOutput()` 优化 | 自动受益，无需迁移 |
| Anthropic 1h cache 经 Vercel 的定价 | 使用 SDK cost，不在前端重算价格 |
| OpenAI Fast mode 定价 | 同上 |
| model-level `samplingParams` 的直接调用修复 | 回归模型测试路由；保存配置时保留字段 |
| Mistral 空 delta ThinkChunk 错误 | 验收正常响应／错误展示，不添加 provider 特例 |
| Mistral reasoning level 被忽略 | 使用 SDK 能力映射，验收 thinking 设置 |
| OpenCode Qwen thinking 被错误重放 | 回归第二轮对话，不改写历史 thinking 为文本 |
| OpenAI Responses 缺失 `output_index` | 正确展示 SDK error，避免残留 running 工具 |
| Anthropic／Codex 授权错误和端口冲突 | 回归错误结束与取消，不允许页面无限等待 |
| Copilot Opus 5.5 不支持的 thinking level | 以 SDK supported levels 为准 |
| RpcClient listener unsubscribe 修复 | 主聊天不是该路径；有 subprocess client 时回归 |
| 嵌套工具 usage 修复 | P1 启用新能力时完成统计适配，不阻塞 P0 |

### 12.2 终端专属，Web 主界面无需适配

以下不需要复制到 Pivot 聊天界面：

- startup banner 删除 Themes 区域。
- pi logo／版本 header。
- 内置 dark/light 颜色更新。
- 终端 appearance 检测和首次设置变化。
- `TERM=*-direct` truecolor 检测。
- `fullscreenWheelScrollLines`。
- X11 clipboard 图片误识别。
- Finder 文件粘贴误取图标和 bash quoting。
- Kitty 图片拉伸。
- overlay shutdown 后 shell cursor 隐藏。
- `/settings` 鼠标点击后的键盘丢失。
- theme 切换后旧 header／notice 颜色。
- custom theme 忽略终端 capability。
- 终端主题 preview 缓存。
- `/skill` autocomplete 和终端路径／`@` wrapper autocomplete。

Pivot 自己的 autocomplete、浏览器 clipboard 和滚动逻辑不会因为这些上游修复自动获得同样变化。若未来追求功能一致，应作为独立 Web 功能，而不是兼容阻断项。

内嵌 Terminal 中若运行的是外部 pi，其版本也独立于 Pivot 的 SDK 依赖版本。

### 12.3 `0.99.1`

- `gpt-6.1-sol`：模型目录自动获得；验收三个 Provider 的可见性。
- Codex 默认模型改变：不应擅自覆盖用户保存的 default 或既有会话选择。
- ChatGPT OAuth bundled module 修复：纳入 P1 新登录的发布包验收，不阻塞 P0。

## 十三、推荐开发与测试顺序

所有阶段均在本地逐步实现和验收，不分阶段发布。阶段 A 的成果用于放心升级本地 pi 并继续使用现有功能；阶段 B/C/D 在此基础上验证新能力。

| 阶段 | 范围 | 阶段验收目标 |
|---|---|---|
| **A：P0 本地现有功能兼容** | 1.0.3 源码／自动化／隔离构建已实施；Azure 旧身份只读别名、OAuth 轮换持久化及输出权限自动化回归已完成，人工验收／部署待完成；保留 TS7、构建匹配、既有会话／工具／认证／adapter MCP／Packs／扩展／渲染／统计／导出／打包验收 | 本地升级 pi 后现有功能全部可用，TS7 类型检查与 Next.js 构建通过；不依赖新功能适配，不发布 |
| **B1：P1 原生 MCP 加载（breaking change）** | 原生扩展装配、SDK 替代诊断、trust、权限与加载／调用；不提供迁移功能 | 原生工具可加载调用，旧标记不影响发送，旧数据不自动处理；配置功能另行实现 |
| **B2：P1 原生 MCP 配置（后续）** | B1 完成后实现原生配置管理、Library／Packs 管理、来源／连接管理、OAuth 及资源功能 | 原生配置功能专项验收通过，不保留 adapter 配置功能 |
| **C：P1 codemode 优先增强与工具编排** | 紧随 MCP 完善 codemode 展示、执行状态、嵌套调用、图片结果及费用；随后开展工具能力选择专项重构、exposure-aware 模型和 tool_search 控制 | 权限管线覆盖子调用；若引入禁用模式，须验证不被异步激活绕过 |
| **D：P1/P2 其他新能力** | 新 ChatGPT 登录／deviceId、完整 disposition、新 Theme API、virtual model、typed catalog、classifier、图片生成、debug | 按各节要求完成本地专项验收，不阻塞阶段 A 的兼容验收 |

阶段 A 单独测试和验收，假设用户不使用新能力；阶段 B/C/D 的设计、实现和验收不作为阶段 A 本地兼容目标的前置条件，但全部阶段都是最终统一发布的前置条件。

**先完成 B1 的原生加载（不提供迁移），再实现 B2 的原生配置功能；紧接 MCP 优先开展阶段 C 的 codemode 增强，再处理其他编排及 P1/P2 新能力，不再将 codemode 留到其他新能力之后。** 原生默认 exposure 是 codemode；MCP 必需的扩展装配、权限与调用入口随 B1 完成，不能交付不可调用的服务器，也不能无提示地把全部配置改为 direct。原生配置功能、完整工具选择、编排配置和增强展示不作为 B1 的前置条件。

### 统一发布条件

- P0、P1、P2 全部完成并通过各自验收。
- 在最终集成状态下重新回归 P0 的全部现有功能，确认新能力接入没有破坏旧功能。
- 完成完整构建、打包和安装验证后再统一发布；阶段性构建／本地安装仅用于测试，不执行发布。

## 十四、验收与回滚策略

### P0 本地兼容验收：升级 pi 后现有功能全部可用

当前补差目标是项目 SDK 与本地 CLI 同为 pi 1.0.2 后，仍能继续日常使用现有功能；此前 0.99.1 验证不能直接替代 1.0.2 验收。这不是发布验收。以升级前已有功能为基线，在实际本地 adapter、扩展和配置环境中验证，不只验收核心聊天路径：

- 旧会话浏览、搜索、命名、删除、恢复、发送、Fork、分支导航、压缩及 reload。
- 新会话创建、首次失败／中止／被现有 extension 消费，持久化及 Sidebar 状态。
- 消息流、thinking、现有工具／图片结果、附件、错误展示、SSE 重连、运行状态与完成通知。
- steer／follow-up、排队、队列模式切换、撤回、取消和重试。
- 全部可用工具策略：新建、旧 none/default 会话、两种 Fork、恢复、reload、旧客户端请求；普通 extension／adapter 工具、正常 prompt 和权限交互。
- 现有物理模型列表、选择、thinking level、默认值、模型配置与测试。
- 已有 API key／OAuth（包括 Codex）的登录、注销、取消、凭据存储和刷新。
- `pi-mcp-adapter` 下的状态检查、已有 server 调用及工作区配置操作。
- Skills、Plugins、Library、Packs 的安装／更新／开关、预览、应用／移除、冲突保护和运行中延迟 reload。
- 现有 extension 命令、dialog、widget、statusline 和 custom UI。
- 现有 token／费用、耗时统计，HTML 导出和深会话补丁。
- 工作区与偏好管理、文件访问／编辑预览、Git review／worktrees、内嵌 Terminal 等已有功能无回归。
- TS7 类型检查、相关测试、lint、Next.js 构建；npm／pnpm 发布包的安装、启动和现有能力运行。

### P1/P2 新能力专项验收

- B1 验收原生扩展装配、SDK 替代诊断、trust、权限、原生加载调用，以及无迁移提示／API／发送拦截且旧数据不自动处理；原生配置功能在 B2 另行验收。
- native／disabled／replaced 状态、MCP OAuth 与资源。
- 新 ChatGPT 登录、本机／异机回调、deviceId 和模块加载。
- codemode 并行、失败、abort、权限拒绝、记录截断、worker／WASM。
- 嵌套调用、图片结果及新费用来源。
- 虚拟模型 selected/routed、typed catalog、classifier、图片生成和调试。

这些专项验收不作为 P0 本地兼容阶段的门槛，但必须在最终统一发布前完成。后续阶段完成后仍需回归全部既有功能，不能以 P0 曾经通过为由跳过最终集成验收。

代码实施后按项目要求进行类型检查、相关测试、lint 和 `npm run build`；构建应在隔离环境中完成，避免污染正在运行的开发 `.next`。生成本地测试包不代表发布，P0–P2 全部完成前不执行发布操作。

### 回滚原则

- P0 一般仅涉及代码、依赖和工具链兼容；不迁移 MCP Library／Pack schema、ownership receipt 或凭据内容，不重算配置哈希。1.0.3 的既有 Azure provider 键兼容是限定例外：只恢复旧身份引用，保留 secret 内容，须备份和阻断冲突，不能借此迁移认证类型或 MCP schema（见 17.3）。
- P0 回退代码、依赖和必要工具链配置；升级前备份会话及现有配置，避免 SDK 持久化变化影响恢复。
- 以下配置迁移及后端切换回滚要求适用于 P1/P2。
- 依赖升级与配置迁移分开提交。
- 配置迁移前备份 Library、Pack 定义、workspace receipt 和 MCP 文件。
- 不自动删除旧 adapter 包、旧凭据或团队 `.mcp.json`。
- runtime 切换应在 idle 时进行，并沿用现有 deferred reload 协调。
- 数据迁移与代码回退要成对恢复；仅降级 npm 依赖不足以恢复旧 schema。

**最终安排**：以已实施的 1.0.2＋TS7 为基线，纳入第十七节的 1.0.3 必要兼容并保留完整 P0 验收：“现有功能兼容，不新增功能”。随后先完成原生 MCP breaking-change 加载（不提供迁移），再实现并验收原生配置功能，之后开发和测试 P1/P2 的完整 codemode 编排及其他新功能；它们不构成 P0 本地兼容验收的前置条件。**P0–P2 全部完成并通过最终集成验收后才统一发布。**

### P0 实施及自动化验证记录（早期 0.99.1 阶段）

以下是历史阶段证据；1.0.2 的当前状态见 16.6，不以历史记录替代最新验收。

- pi 三个直接依赖锁定 `0.99.1`；TypeScript 原生编译器锁定 `7.0.2`，不保留 TS6／`@typescript/typescript6`／native alias 兼容依赖。
- Next.js 升级到 `16.3.8`，显式启用 `experimental.useTypeScriptCli`；`npm run build` 先执行原生 TS7 typecheck，再构建和打包，不跳过类型错误。
- 根据用户确认，移除依赖旧 TS JS API 的 `eslint-config-next`／typescript-eslint 解析方案，改用原生 Oxc 语法解析。保留 Next、React、Hooks、无障碍规则，以及未使用变量、未使用表达式、显式 any 检查；不宣称与原 typescript-eslint 推荐规则完全等价：例如 ban-ts-comment、no-namespace、no-empty-object-type、no-duplicate-enum-values、no-unsafe-declaration-merging、prefer-as-const 等专属语法／风格规则未迁移；类型正确性仍由 TS7 检查，但不把它宣称为这些 lint 规则的等价替代。React Compiler 未启用，其优化专用检查保持关闭。ESLint 使用兼容现有插件的最新 9.x `9.39.4`；React/import/a11y 插件尚未声明支持 ESLint 10，因此未强行升级到 10。
- 旧测试的 `transpileModule` 改为 SWC；TS7 显式加载语法高亮声明。移动端产品源码和原有断言不变，未提交的移动端测试仅调整转译器。
- 移除 `_rewriteFile()`／`flushed` 私有字段补丁。`lib/session-persistence.ts` 用公开 SessionManager API 保存空会话／空 Fork，并在首次发送前保存延迟的模型及预设元数据；有 user/assistant 后由 SDK 持久化，不重写会话。首次 user 的 `message_end` 立即失效 Sidebar 缓存。
- 真实 SDK 测试发现 `agent.state.systemPrompt` 已只读，修复 none 预设为公开 `transformContext` 请求投影；验证 reload、恢复和 default 切换。steer/follow-up/prompt 的结构类型接受新版 disposition，不扩展 HTTP/UI 功能。
- 全量测试：373 项，370 通过、0 失败、3 项 Terminal 测试按环境跳过。包含真实 SDK 本地模拟 Provider／扩展、首次失败与 abort、队列切换、空 Fork、浏览器文本选择以及 lint 规则探针。
- 原生 TS7 typecheck、lint 均通过；lint 保留 9 条 warning。隔离目录 `npm run build` 成功；Next 提示 11 条动态文件追踪 warning，未扩大到无关代码整改。
- 本地包分别用 npm／pnpm 安装，特意跳过 install scripts，验证 launcher 恢复 hashed runtime aliases、启动、网关登录、models/auth/sessions API 和 none 运行时创建均通过。工作区 adapter 状态为 ready，版本 `2.36.0`；未添加原生 MCP/codemode/tool_search factories。
- 未提交、未升 Pivot 版本、未发布。以上不替代实际账户的 OAuth 登录／刷新、真实 MCP server 调用、交互式 Terminal、人工端到端验收；这些仍需本地验收，不能仅凭自动化结果宣称现有功能已全部验收。

## 十六、2026-10-04 生产页面修复与 pi 1.0.2 补充计划

### 16.1 此次首页 500：已修复，不是 SDK 1.0.2 升级

- WinSW 配置运行 `next start --port 30131`。服务及 node_modules 的 Next 为 `16.3.8`、项目 SDK 为 `0.99.1`，但原 `.next/diagnostics/framework.json` 为 `16.2.9`，`required-server-files.json` 的 pi SDK 为 `0.87.1`，构建时间为 9 月 30 日；旧构建与新框架／SDK 混用导致 `this.load is not a function`、`renderToPipeableStream is not implemented`。旧服务 `/login` 实测 HTTP 500。
- 上次只在隔离目录构建，未替换此 WinSW 服务使用的 `.next`。修复不能仅凭升级 CLI、重启服务或通过 API JSON 冒烟测试完成；HTML/RSC 渲染也必须验证。
- 新增 `scripts/pivot-build-runtime.js`，在 launcher 和 Next 的 production-server 配置阶段检查构建与已安装 Next／项目 SDK 的版本；不匹配时提示停止服务、重新构建和重启，而非让浏览器收到隐蔽的 500。SDK 元数据解析支持 import-only exports 和依赖 hoisting，不加载 SDK 本体。
- 完成隔离 `npm run build` 和真实登录页／登录后首页／客户端资源回归后，受控停止 WinSW，部署匹配产物、恢复 runtime aliases，再启动服务。原 `.next` 备份为 `F:/MyWorkspace/Node_Workspace/pivot-ui-build-backups/next-before-recovery-20261004`，未删除会话或凭据；无开发服务运行，也未用 build 覆盖运行中的 dev 目录。
- 实际服务 `30131` 验证：`/login`、登录后 `/`、客户端 JS 资源、`/api/sessions`、`/api/models`、`/api/auth/providers` 均为 200；WinSW 为 Started，重启后的请求未新增对应错误日志。
- 新的启动防护测试 6 项通过；全量测试 380 项：376 通过、0 失败、4 跳过（3 项 Terminal 环境门槛、1 项需要生产构建目录的页面测试）。后者单独指定 `PIVOT_TEST_PRODUCTION_DIR` 已通过。TS7 typecheck、lint 和隔离 build 通过；lint 9 条 warning。
- 当次恢复部署的项目 SDK 仍是 `0.99.1`，本地 CLI／源码为 `1.0.2`；以上只证明网页和所列 API 已恢复，不能宣称已完成 SDK 1.0.2 或真实 MCP／OAuth／Terminal 验收。没有提交、发布或修改 Pivot 版本号。

### 16.2 SDK 1.0.2 的 P0 补差清单

依据官方 [v1.0.0](https://github.com/earendil-works/pi/releases/tag/v1.0.0)、[v1.0.1](https://github.com/earendil-works/pi/releases/tag/v1.0.1)、[v1.0.2](https://github.com/earendil-works/pi/releases/tag/v1.0.2) 发布说明和本地 tag 源码。源码／隔离验证证据见 16.6；清单中的生产部署与人工验收仍待完成：

1. **依赖与部署**：三个 SDK 包同步固定到 1.0.2，锁文件可复现，保留 TS7 7.0.2／Next 16.3.8／无 TS6 lint 路径。1.0.1 移除 SDK 发布包的 npm-shrinkwrap，需额外核查传递依赖与 override、npm/pnpm hoisting；managed CLI 安装器、Nix flake 不代替 Pivot 项目依赖安装。隔离构建通过后，部署生产产物并重跑实际 HTML、RSC/client assets 和 API，而非仅重启旧服务。
2. **已有 Anthropic OAuth：强制检查新 select 回调**。1.0.0 的 `anthropicOAuth.login()` 在启动浏览器登录前新增 `interaction.prompt({ type: "select", options: [...] })`，不能当成普通 manual_code 文本，否则已有浏览器登录会失败。检查登录 SSE／短期 callback token／取消／默认 browser 选择；必须保证现有浏览器流程。copy_code 的独立 UI 可留 P1，但新增选择回调对旧登录的影响必须在 P0 处理。已有 API key、Codex 登录与刷新也需回归；不得重写用户凭据来掩盖失败。
3. **会话和全部工具策略**：以 1.0.2 重跑首次发送、失败、abort、空会话、Fork、父链、压缩、resume/reload、排队撤回和队列模式切换；验证旧预设不生效、正常 prompt 不被清空。增量未修改 SessionManager，但公开 API 落盘仍需回归。
4. **defaultTools／动态注册工具**：源码新增 `usesDefaultTools` 与 `_pendingToolNames`。不维护旧预设优先级，统一启用已注册且非 hidden 的工具；检查 Pack reload、session_start 后注册、settings 的部分默认列表及 adapter 工具不会缩减可用集合。不访问新私有字段，不启用未加载的 native MCP/tool_search factories，不绕过权限 hooks。
5. **模型配置／thinking**：1.0.2 的 `samplingParamsByThinkingLevel` 增加 model 定义及 `provider.modelOverrides` 中的配置和采样参数选择。ModelsConfig 读取、编辑、保存、测试和默认模型 API 必须保留该字段，不过滤未知键；测试 off 与已有 thinking 级别、继承和覆盖，验证 OpenAI-compatible completions/responses/Azure 的有效请求值。配置兼容属 P0，新增专用采样编辑 UI 属 P1。
6. **Provider runtime／重试／统计**：native extension Provider 注册新增 provisional configured 状态；检查扩展模型在初次选择、恢复与刷新前不会被误判为不可用。回归 SDK 对 capacity 错误和非有限 retry-after 的处理，避免 Web running 状态卡住；Bedrock 长上下文 pricing tiers、thinking 签名重放，以及 Anthropic mid-conversation inline tool definitions 更新要覆盖既有 token/cost、请求和会话恢复，不新增费用 UI。
7. **扩展加载／运行兼容（非新增 Web renderer）**：1.0.1 增加 `pi.registerToolRenderer()`；升级 SDK 后检查使用该 API 的扩展能正常注册，其工具、命令、事件、权限 hooks 和 reload 仍可用。Pivot Chat 使用自己的 React renderer，不执行该 resolver；当前导出走 CLI `--export`／`exportFromFile()`，也不加载活跃会话的 renderer。P0 验证现有结果展示、文件导出和深树补丁不回归；TUI→Web 转换或改变导出加载路径属于 P1，详见 16.5。
8. **完成门槛**：再次通过原生 typecheck、lint、全量测试、真实 SDK、生产 HTML／静态资源、npm/pnpm 发布包启动；在实际本地配置中验收已有 OAuth、adapter MCP server 调用、Packs、文件访问、Git 和 Terminal。重新校验生产 build/runtime 版本、备份与受控部署。仅此补差验收后才能把 P0 基线标为 1.0.2；仍不发布。

### 16.3 1.0.x 新能力／终端变更的阶段归属

- **P1 原生 MCP**：项目对全局服务器的 enabled/exposure/toolExposure override（无 command/url）、`oauth.authServerMetadataUrl`、RFC 9207 issuer 校验、按 server 名称＋URL 存储凭据、step-up scopes 保留、可选 CIMD clientRegistration。需扩充 Library／Pack schema、ownership 和迁移事务方案；保留现有 adapter 配置，不在 P0 将这些 native 条目误当 adapter server 改写或删除。
- **P1 codemode／模型**：精简 prompt、错误恢复提示、`models.generateImages()`、新的 Cloudflare Clef classifiers，以及打印超 16 Mi 字符或 100000 items 的输出限制。更新执行、安全取消、图片展示和费用专项验收；原工具探测脚本须改用 `"name" in tools`，不能依赖 `typeof tools.name`。P0 仍不注入新 factories。
- **P1 认证增强**：Anthropic 独立 copy-code UI、Radius 登录＋配置 MCP 的一体化向导、MCP/CIMD 登录以及新的 ChatGPT 回调端口冲突处理；仅已有认证受影响的 select/cancel/credential 回归属于 P0。
- **终端专属／无需 Web 仿制**：默认 fullscreen TUI、`quietStartup: "header"`、OAuth URL copy key、非 PNG Image/Kitty/WezTerm 修复、配色和 transcript 内存优化。Pivot 的 EXTENSION_MODE／Web layout 不跟随终端默认值改成 fullscreen；现有 custom UI 若受影响则只做兼容修复。
- **发布约束不变**：A（含 SDK 1.0.2 补差）、B/C/D 全部实施并通过最终集成验收后才统一发布；本次页面恢复不是发布，也不是原生 MCP 或新能力验收完成。

### 16.4 临时全部工具策略：源码已实施

- 前端 ChatInput／ChatWindow／useAgentSession 移除预设选项、状态、偏好读取与切换请求。共享偏好及历史 `pivot-ui:tool-preset` 数据保留，不删除、不应用；遗留 helper 仅供历史数据／未来重构使用。
- `lib/active-tools.ts` 从实际 SDK registry 选择全部非 hidden 工具，包含内置、已加载 extension 和 adapter 工具；在启动、扩展绑定后、reload 和空闲后的 prompt／工具查询时应用。旧 `toolNames`／`toolPreset`／`set_tools` 不缩减工具集合，不再清空 system prompt。运行中的请求不强制切换 loadout。
- 不加载原生 MCP／codemode／tool_search factories；不绕过 tool_call 权限扩展，不重新启用 extension 所有者标记为 hidden 的工具。此策略不承诺延迟声明／token 优化，其产品模型仍待专项重构。
- 当前 SDK 0.99.1 的真实回归覆盖新建、历史 none、两种 Fork、resume/reload、受限 defaultTools、session_start 动态 extension 工具及旧切换请求。原有 RPC UI 测试补齐 registry mock，队列／UI 应答不做无关 loadout 修改，断言未放宽。
- 全量测试 385 项：381 通过、0 失败、4 跳过；typecheck、lint（9 warning）、隔离 `npm run build` 通过。生产页面测试单独通过，含 legacy none 的 HTTP 新建与切换请求仍启用全部工具。以上为 0.99.1 阶段结果；SDK 1.0.2 对应回归已完成，见 16.6。
- 本次未替换运行中 WinSW 的生产产物；新行为需部署本次构建后在该服务生效。未提交、未升版本、未发布。

### 16.5 扩展兼容的精确边界

`registerToolRenderer()` 的出现不等于 Pivot 要增加一套 Web 工具 renderer。必须区分注册／执行和呈现路径。

**API 本身**：1.0.1 新增 `pi.registerToolRenderer((toolName, next) => renderers)`。原先 `registerTool()` 可自带 renderCall/renderResult；新 API 可独立为内置、动态或历史工具选择 renderer，不需要重新注册 execute。resolver 按扩展加载顺序组成链，next() 查询后续 resolver，再回退到已注册工具的 renderer；renderers 包含 renderShell/renderCall/renderResult，返回的是 pi-tui Component（render(width) 输出终端文本／ANSI），不是 React 元素。它不改变工具参数、执行结果或权限 hooks。

**对 Pivot 的影响**：

| 路径 | 当前实现 | P0 范围 |
|---|---|---|
| 扩展加载 | SDK resource loader 执行扩展 factory，rpc-manager 绑定生命周期及 browser UI bridge | SDK 1.0.2 提供真实注册 API；检查 load diagnostics、工具／命令／Provider 注册和 session_start/reload；不能用静默 no-op 掩盖加载失败 |
| 工具执行 | SDK 执行 execute，SSE 转发 content/details/isError，权限扩展仍参与 | 注册 renderer 不应导致工具消失、结果丢失或权限失效；使用本地 mock 扩展覆盖，实际 adapter 另验收 |
| 聊天页面 | MessageView 自有 React ToolCallBlock，根据标准结果展示文本、图片、diff 等 | 保持既有通用展示和历史恢复；当前不调用 SDK resolver，不承诺复刻终端定制卡片 |
| 当前文件导出 | route 调用 SDK CLI --export，fallback 为 exportFromFile；读取 JSONL，不创建活跃 AgentSession | 回归通用 HTML、文件路径解析和深树迭代补丁；不存在必须接入新增 resolver 的现有调用点 |
| SDK 活跃会话导出 | AgentSession.exportToHtml 使用 resolveToolRenderers，并将 TUI 文本转成 HTML | Pivot 当前不走此路径；若以后接入，属 P1 设计与专项验收 |

**最小验收**：在 SDK 1.0.2 的本地 fixture 扩展注册一个普通工具／命令、一个 tool_call 权限 hook，以及覆盖工具名的 renderer。验证加载无错误、命令／UI／工具执行／拒绝／reload／历史通用展示可用；另对已有文件导出回归。测试应证明 renderer 可以注册，不应要求 Web 像终端一样展示。SDK 1.0.2 的本地 fixture 已通过上述注册／执行／权限／reload 检查，见 16.6；不据此替代实际 adapter 调用或人工 UI 验收。

**明确不在 P0**：建立通用 TUI→React／浏览器 ANSI 工具 renderer bridge、在 SSE 传输终端 Component、为了 renderer 改成活跃会话导出、为导出自动加载第三方扩展。后两者会额外执行用户扩展 factory，改变只读浏览／导出的生命周期和安全边界，不能作为小型兼容修复顺带实施。

### 16.6 SDK 1.0.2 P0 执行结果：源码／隔离验证完成，实机验收未完成

**依赖与运行环境**：三个直接 SDK 包及锁文件已锁定 1.0.2；保留 TS7 7.0.2、Next 16.3.8、Oxc lint。隔离目录为 `C:/Users/spade/AppData/Local/Temp/pivot-p0-102-W6GSla`，通过 `npm install --include=dev` 安装。构建前对全部 Git 管理及未忽略源码逐文件 SHA-256 比对，与工作区完全一致。工作区 node_modules、运行中 WinSW 和生产 `.next` 未改变；旧恢复部署不包含本次 SDK／全部工具新行为。

**兼容补差与新增证据**：

- OAuth 路由保留 generic `select_request` 前端，不新增认证入口。短期 token 改为 UUID，绑定 provider 与允许的 option id；非法选择／错 provider 返回 400，已使用或撤销 token 返回 404。运行时初始化期间或等待选择时断开，不创建／遗留 pending token；select 与后续 manual-code 使用不同的一次性 token。`lib/oauth-login.test.mjs` 四项通过；它是 mock runtime 交互测试，不代表真实 Anthropic 登录成功。
- `ModelsConfig` 类型保留 `samplingParams`／`samplingParamsByThinkingLevel`，不新增专用编辑 UI。`lib/models-config-sdk.test.mjs` 验证 GET/PUT、现有编辑 callback 的对象保留、catalog modelOverrides 以及已有 model-test POST 的 SDK reply／off 采样参数；真实 SDK＋本地 fetch stub 验证 completions／responses／Azure 下 off、high、max 降级和请求覆盖的有效采样值。HTTP stub 不发外部模型请求；也未宣称新增采样 UI。
- 同一模型测试覆盖非有限 `retry-after-ms: Infinity` 的 503→成功重试、长上下文 cost tiers 与现有 cost totals。`lib/auth-store-sdk.test.mjs` 验证真实 SDK 能读取既有 API-key 格式及未过期 Codex OAuth 格式，删除 key 不改动 OAuth；使用 dummy 凭据，不做真实登录／刷新。
- `lib/rpc-manager-sdk.test.mjs` 在 1.0.2 下六项通过：startup／resume／reload／旧 none／两种 Fork／defaultTools 局部列表、扩展 Provider 首次选择与恢复、权限 hook／renderer 注册和 reload、容量错误 retry 后 running 结束、首条失败与 abort／handled／队列模式切换。renderer 注册成功、工具详情保留、权限能拒绝，Web 路径不执行终端 renderer。会话公开 API 落盘与无 hidden 激活继续纳入全量测试。
- `lib/session-export-sdk.test.mjs` 通过真实 SDK CLI 文件导出：5100 条用户消息、普通历史 adapter-tool 调用／结果保留在嵌入数据中；从实际产物提取三个迭代逻辑并运行于 5101 层树，节点映射和 active 标记正确，无递归溢出。不改为 active-session export，不为 renderer 加载第三方扩展。

**最终自动化结果**：

- 全量 `node --test lib/*.test.mjs hooks/*.test.mjs components/*.test.mjs app/*.test.mjs scripts/*.test.mjs`：402 项，398 通过、0 失败、4 跳过。3 项 PTY 集成测试因 Windows 固定跳过；生产页面项因默认未设置构建目录跳过，之后单独指定目录执行并通过。
- 新增模型／凭据／真实 SDK／导出用例单独复跑：17 项全部通过；OAuth 四项也已纳入全量成功结果。
- `npm run typecheck`、`npm run lint` 通过；lint 保留 9 条已有 warning。隔离 `npm run build` 成功，产生 `sincw-pivot-ui-1.2.2.tgz`（873 文件）。日志位于隔离目录的 `full-tests-102.log`、`final-targeted-102.log`、`lint-102.log`、`build-102.log`。
- 指定隔离产物运行 `scripts/production-pages.test.mjs`：登录页、认证首页 HTML、客户端资产、旧 none 请求的新建／set_tools 后全部工具激活均通过。
- npm 与 pnpm 10 分别用 `--ignore-scripts` 安装该本地测试包，经 launcher 恢复 hashed aliases，登录页／首页／JS、models/auth/sessions API、正常 SDK prompt 和全部工具均通过。对应 `tmp/ts7-tooling/{npm,pnpm}-smoke-102.log`；只生成／安装测试包，没有发布。

**尚未完成，不能据此宣称完整 P0 实机验收通过**：

1. 未部署本次 1.0.2／全部工具产物；运行中的 WinSW 仍是前次恢复的 0.99.1 版本。后续需在受控停止后更新依赖与匹配产物、恢复 aliases、校验 build/runtime 再启动；不能只复制新 `.next` 到旧 SDK 上。
2. 真实账户的 Anthropic／Codex 浏览器登录、取消及过期 token refresh；本次 mock／未过期 dummy token 证据不替代真实服务验收。
3. 实际 adapter MCP server 工具调用、用户真实 Packs／扩展 UI、交互式 Terminal 及人工端到端验收。本次检查到全局安装的 adapter 为 5.0.0，但未启动用户服务器；历史 2.36.0 ready 记录也不能替代真实调用证据。
4. Provider-specific thinking 签名重放、Anthropic mid-conversation inline tools、真实 Bedrock 定价场景只按 SDK 公共契约／现有回归覆盖，未进行真实云请求验收。

没有提交、没有改 Pivot 版本号、没有发布；不实现 P1/P2 新能力。

### 16.7 2026-10-05 当前工作区直接构建（按用户要求不停止服务）

- 用户明确要求直接构建，并禁止停止运行中的服务。未执行 stop／restart；WinSW 状态仍为 Started，原服务 Node PID 31240、创建时间 20:13:57 保持不变。
- 复制备份原 `.next`（不含 cache/dev）及旧 SDK 三个包到 `F:/MyWorkspace/Node_Workspace/pivot-ui-build-backups/before-direct-102-2026-10-05T12-19-20-217Z`，未移动服务目录。
- 工作区执行 `npm install --include=dev`、`npm run build` 成功；三个实际 SDK 包及新构建的 `NEXT_PUBLIC_PI_VERSION` 均为 1.0.2。恢复 4 个 runtime aliases，build/runtime guard 通过。
- 当前目录产物为 `F:/MyWorkspace/Node_Workspace/pivot-ui/sincw-pivot-ui-1.2.2.tgz`（868 文件、9.7 MB）。构建含原生 TS7 typecheck；指定当前构建目录启动独立临时端口的生产页面／静态资源／全部工具回归通过。
- 安装／构建日志：`tmp/ts7-tooling/direct-102-install.log`、`tmp/ts7-tooling/direct-102-build.log`。构建覆盖在线 `.next` 的风险已告知用户；验证的是新产物的新进程，不把它当作原 WinSW 进程已升级的证据。用户需自行重启服务以完整加载新版本；没有发布或改 Pivot 版本号。

### 16.8 2026-10-05 浏览器加载失败：实际 SWC 16.2.9 残留

- WinSW 无服务端异常并不能证明客户端正常。直接构建产物在 Chrome 中重现 `Instant validation boundaries should never appear in browser bundles`，报错 chunk 与用户一致。此前 HTTP 200／HTML／JS 下载检查遗漏了 hydration，不能作为浏览器加载成功的证据。
- Next 和原生包 manifest 都显示 16.3.8，但本地 `.node` 文件 SHA-256 为 `283e25268bf10faf562e9cf62dd6765f51605ff83251e4bfd8dbb06ee7fa2c4c`，与已有干净 16.2.9 包完全一致，且缺少 `projectFeatureUsage`。16.3.8 干净安装的文件为 `8426bdb9a428960a919c89713ed5d5caf17f4aafc4985e1639e16c9130c471a0`。根因是 JS／native compiler 混版本，不是 pi API 或单纯浏览器缓存。
- 新增 `scripts/pivot-build-compiler.js`，`npm run build` 在 typecheck／构建前检查 native Turbopack 接口，阻断仅 manifest 正确、实际二进制错误的情况；三项 guard 测试通过。不修改 Next 源码、不屏蔽 invariant。
- `scripts/production-pages.test.mjs` 新增 `PIVOT_TEST_BROWSER=1` 模式，通过隔离 Chrome profile/CDP 捕获 uncaught exception，实际输入 token、启用 React 登录按钮、点击登录并等待首页 composer；错误原产物会失败，正确产物在隔离和当前工作区均通过。没有放宽异常断言。
- 同步当前源码到隔离目录，以正确 compiler 重新执行 `npm run build`。全量 405 项：401 通过、0 失败、4 跳过；lint 0 error／9 warning，浏览器＋guard 单独四项通过。新 browser bundle 不含错误 boundary。
- 备份到 `F:/MyWorkspace/Node_Workspace/pivot-ui-build-backups/browser-swc-fix-2026-10-05T13-28-12-676Z`，保留错误 compiler／旧 .next／旧 tarball；替换本地 native 包、已验证 .next 和同名本地 tarball，恢复 4 个 aliases。compiler 与 build/runtime checks 均通过。
- 未停止／重启 WinSW，状态仍为 Started。验证针对新产物的独立进程；用户仍需重启服务刷新旧进程的 manifest／module cache，尚不宣称当前线上进程已恢复。日志：`tmp/ts7-tooling/browser-bad-bundle.log`、`browser-fixed-workspace.log`，隔离目录的 `browser-fix-{build,tests,full-tests,lint}.log`。没有发布、提交或改 Pivot 版本号。

## 十七、pi 1.0.3 增量：调研计划与后续实施记录

17.1–17.7 保留初始静态调研时的判断与验收设计；后续代码／测试结果以 17.8 为准。

### 17.1 拉取依据及本次边界

- 官方 [v1.0.3 发布说明](https://github.com/earendil-works/pi/releases/tag/v1.0.3)，发布时间 `2026-10-05T08:38:23Z`。已在 `I:/pi_git` 执行 `git fetch origin tag v1.0.3`，tag commit 为 `d78dc83d633229d12f8b79631384c4c2717c399f`；未 checkout 或改动该源码工作区。
- 对照 `v1.0.2..v1.0.3`：122 个文件，覆盖 ai、coding-agent、tui、durable 的 changelog、实际源码与上游测试。原始 release／差异保存在 `tmp/ts7-tooling/pi-release-1.0.3.{json,md}`、`pi103-{changelog,p0-source,extra-source,durable-source}-diff.txt`；源码 tag 已归档到隔离临时目录供只读调研。
- 本次仅修改适配计划，不改项目三个 SDK 包／锁文件、不安装新依赖、不运行测试或 build、不改服务状态，也不读取或迁移用户凭据。项目基线仍是 1.0.2；下面的验收用例均为待执行计划，上游已有测试不是 Pivot 已通过的证明。

### 17.2 逐项阶段判断

| 1.0.3 更新 | Pivot 影响与阶段 |
|---|---|
| Azure provider `azure-openai-responses` → `azure`；旧导出模块／符号更名 | **P0（已有 Azure 用户）**：认证键、配置、默认／enabled／thinking 引用及旧会话恢复会受影响；不是新增 Azure 模型 UI |
| OAuth refresh 已启动后不再随请求取消丢弃轮换 token | **P0 现有认证／凭据完整性**：SDK 自动受益，但必须回归取消、superseded refresh、持久化及下次请求；不新增 ChatGPT 登录 |
| 普通 Shell 完整输出文件改为 `0600`、独占 `wx` 创建 | **P0 安全及兼容回归**：保留私密输出的读取和现有截断语义；不扩大文件访问 allow-list |
| Azure Foundry Chat Completions、`azure/deepseek-v4-pro`，两种 API 共用 endpoint／deployment mapping | catalog 可自动获得；新部署能力及专项 UI 属 **P1**，不能与旧 Azure 更名的 P0 混为一项 |
| codemode `image()` 增加保存路径文字，图片落入临时文件 | **P1**：结合图片结果、路径权限、保存失败及重复图像处理；不启用原生 codemode 来获取这项修复 |
| codemode 在 pnpm 更新／删除运行安装后继续工作，CLI 错误后提示重启 | **P1／CLI 自动受益**：worker／WASM 仍留专项验收；该提示在 InteractiveMode，不会自动进入 Web，更不能解决 Next 在线构建混用 |
| TUI Home/End、Ctrl+Home/Ctrl+End 重新分工；死 tty 的 EIO/ENOTTY 正常退出 | **终端专属**：不改 Web 输入框／滚动键、不向进程内 AgentSession 注入 CLI 退出逻辑；外部 pi 或 custom UI 有需求时另验 |
| durable 有界 reader、argv／stream info、watch、progress 间隔、window/skipped 与 BOM／flush 修复 | **非当前 P0**：Pivot 走 coding-agent AgentSession，并未依赖或实现 durable ExecutionEnv；未来 backend／custom-env 支持见 17.6 |

### 17.3 P0-A：既有 Azure 身份兼容（破坏性变更）

**必须区分三个名称**：

- provider id：`azure-openai-responses` **改为** `azure`。
- Responses API id：`api: "azure-openai-responses"` **不变**，不得全文替换成 `api: "azure"`。
- `AZURE_OPENAI_*` 环境变量 **不变**；新增 Foundry 模型使用 `api: "openai-completions"`，不是给旧 Responses 配置更换 API。

官方要求更新 `auth.json` provider key、`models.json` provider key、`settings.json` 的 `defaultProvider`、`enabledModels` pattern、`modelThinkingLevels` key；旧 Azure 会话在 SDK 中会 fallback 到其他模型，prompt cache 不再复用。源码同时删除 `providers/azure-openai-responses` 导出，改用 `providers/azure` 的 `azureProvider`／`AZURE_MODELS`，并改变 KnownProvider、env-key 查找与默认模型 provider。

**Pivot 实际受影响位置**：

- `app/api/models/route.ts` 比较 exact provider/model 引用，旧 defaultProvider 将无法命中新 catalog；enabled 引用也需检查，不能让不匹配后返回全部模型掩盖旧 Azure 失效。
- `app/api/models/defaults/route.ts` 和 `lib/rpc-manager.ts` 的 set_model／启动恢复用 `getModel(provider, id)`；旧 id 不可假定能 alias 到新 id。`lib/session-reader.ts`／前端还读取历史 provider 元数据，须区分历史记录与下一次实际选择。
- `components/ModelsConfig.tsx` 图标表只有旧 id，应为新 id 补既有 Azure 标识并保留历史展示；图标本身不是核心阻断，但不能把更名当新 Provider 功能上线。
- 项目源码没有直接 import 旧 provider 模块；用户既有扩展若 import 旧模块／符号仍会 load 失败，需要条件性 P0 检查，不能用 no-op 掩盖。

**适配约束／待验收**：

1. 明确选择运行时兼容读取或备份后受控键迁移；只针对内置 Azure 身份。新旧键同时存在时核对差异并阻断冲突，不覆盖新凭据、不删除任一有效配置；自定义同名 Provider／扩展不得被不加判断地改名。本次不执行用户数据迁移。
2. 此项是恢复旧 Azure 功能的必要身份兼容例外，不是 P1 的 MCP schema／receipt 迁移。默认模型、thinking、enabled 引用及全局／项目 settings 一起核对；保留其他未知字段、credential env／headers、base URL 和部署映射。
3. 旧会话恢复／Fork／reload 后确认实际选中预期 Azure 模型；如不能无损恢复，必须明确提示重新选择，不悄悄把非 Azure fallback 当成功。不批量改写历史 assistant provider、tool-call id 或 prompt-cache 标识；接受官方声明的缓存失效。
4. 用 1.0.2 Azure fixture 做升级、旧键／新键／冲突、环境变量认证、模型测试／默认设置／thinking、含历史工具结果的继续对话回归。API id 不变，已有 `lib/models-config-sdk.test.mjs` 的 Azure API 路径仍有效，但它的 provider 是自定义 local，不能替代内置 Azure 更名验收。

### 17.4 P0-B：OAuth refresh 取消后的 token 完整性

[源码 `auth/resolve.ts`](https://github.com/earendil-works/pi/blob/v1.0.3/packages/ai/src/auth/resolve.ts) 新增 `refreshStoredOAuthCredential()`，`models.ts` 的请求认证和模型 refresh 共用它。信号只取消等待 credential-store lock；刷新已经开始后，provider 可能已使旧 refresh token 失效，因此必须完成并保存新 token，再释放锁。刷新本身仍受 15 秒 timeout 限制；取消调用方的等待与取消这项已启动的持久化工作不是同一个动作。

**为何是 P0**：虽然 release 以新 ChatGPT 订阅登录为例，改动位于共享 OAuth resolution，也影响已有 Codex／Anthropic 等使用轮换 token 的认证路径；不能因新 ChatGPT 登录留在 P1 就把凭据丢失修复也后置。SDK 本身修复，Pivot 不应重复实现 OAuth refresh 或移植私有逻辑。

**Pivot 路径与待验收**：

- `ModelRuntime.create()`／`createAgentSessionServices()` 默认使用 SDK 的文件-backed AuthStorage／RuntimeCredentials；`lib/auth-store.ts` 是 API-key 保存／删除路径，不能仅用该 helper 的 dummy credential 测试证明 SDK refresh 持久化正确。
- 在真实 SDK＋临时 auth 文件＋mock OAuth provider 下覆盖：等待锁时取消不发 refresh；refresh 已启动后取消 prompt／getAuth／模型 refresh 或被下一次 refresh supersede，新 token 最终仍落盘；并发调用只刷新必要次数，后续新 runtime 读取新 token 能继续认证。
- caller／Web running 状态须按既有语义结束，不能恢复 stale run；但不得让 SSE cleanup、wrapper destroy 或全局 Promise catch 撤销后台凭据保存。覆盖注销与刷新竞争，保证锁顺序下注销不被迟到写入恢复；写盘失败应显示错误，不强迫删除／重登来掩盖。
- 1.0.2 已有的选择／一次性 token／cancel 测试继续保留；它们不覆盖此场景。上游 `models-runtime.test.ts` 新增 request cancel、model-refresh cancel 后持久化测试，仅为待移植回归的依据，不是本项目已通过的证据。
- 实际账户登录／过期 token refresh 仍需人工验收；不新增 deviceId、新 ChatGPT 入口或 credential 迁移。

### 17.5 P0-C：依赖基线及普通 Shell 输出权限回归

- 后续实施时三个直接 SDK 包一起固定到 **1.0.3** 并更新锁文件，核对传递包与 external aliases。保留 TS7 7.0.2／Next 16.3.8；1.0.3 没有要求升级 Next，也不能消除第 16.8 节的伪版本 SWC 二进制问题。必须继续检查实际 compiler 接口和真实浏览器 hydration。
- [`output-files.ts`](https://github.com/earendil-works/pi/blob/v1.0.3/packages/coding-agent/src/utils/output-files.ts) 统一输出文件创建，使用 POSIX `0600` 与 `wx`。已加载的普通 bash 输出累积／完整截断日志也改用此 helper，所以不只是 P1 的 codemode／native MCP 改动。
- P0 验证长输出、非零退出、空输出、完整文件读取及文件创建失败不回归；以真实服务运行账户检查目录权限和所有权。Windows 的 mode 不等同完整 NTFS ACL，不能仅凭 `0600` 宣称 Windows 跨账户隔离已验收。
- `lib/file-access.ts` 不默认放行整个 OS temp；不能为新 SDK 文件路径放开整个临时目录／取消 symlink 限制，也不能 chmod 为全员可读来恢复页面访问。只保持既有获准读取语义，既有 temp 预览缺口不借升级扩大为新功能。

### 17.6 其余更新纳入后续计划，不扩张 P0

- **Azure 新能力／P1**：`azureProvider()` 同时分发 Responses 和 `openai-completions`，DeepSeek V4 Pro 进入 catalog；新 Foundry deployment、base URL 规范化、`azureDeploymentName`／`AZURE_OPENAI_DEPLOYMENT_NAME_MAP` 对两种 API 的应用另做专项回归。不为新模型新增 P0 页面。
- **Codemode 图像／P1**：`image()` 前插入 `[Image saved to ...]` 文字、同一次输出按内容去重，保存失败仍返回图像并给出原因；PNG/JPEG/GIF/WebP 均须保持 text/image 顺序与路径关联。结合已有图片、费用、权限方案验收，不在 P0 启用 native factories／全临时目录文件入口。
- **Codemode 热更新／P1**：SDK 缓存 WASM 路径，bundled-node 的 worker 改从内存 data URL 启动；仅对对应 runtime 适用，SDK unbundled 路径不等同 CLI bundle。包／worker／WASM 测试仍是后续专项，InteractiveMode 的 install-change 重启提示不会自动成为 Web 提示。任何升级都仍需匹配构建、依赖和运行进程。
- **TUI／无需 Web 仿制**：Home/End 保留编辑器行首／行尾，Ctrl+Home/Ctrl+End 改为 fullscreen transcript 首／尾；stdin/stdout/stderr 失去 tty 的 EIO／ENOTTY 等走正常退出。外部 Terminal 的 pi 自动受益，不把 `process.exit` 或信号处理复制进 Next 进程；有用户 custom UI 时仅核查其键位／纯文本桥接是否回归。
- **durable／未来 backend 专项**：当前不是 Pivot 的运行后端，coding-agent package 也未新增 durable 依赖。其破坏性接口不能误写成当前 AgentSession 的 read／bash API 变化：FileSystem 新增 `openBinaryReader`、`openDirReader`、`watch`，BinaryReader 新增 `scanLines`；Shell.exec 接受 argv，onOutput 多一个 `{ stream, skipped? }` 参数。
- durable 的有界 read／分页目录、progress 两种 commit 间隔（默认 100 ms）、tail window／skipped 计数、分块 U+FEFF 保留、Windows 目录 flush 错误修复均进入未来后端计划；Windows watch 用 polling 避免打开目录句柄阻止父目录 rename，网络／FUSE polling 和 macOS watch 启动后 rescan 也不能借此重构当前 WorkspaceFileTree watcher。
- 若用户既有扩展确实依赖 durable 并实现自定义 ExecutionEnv，才追加**条件性 P0 扩展兼容**：补必需接口及 argv／stream／skip 语义，用上游 env-conformance 检查；转换／过滤 output 的 wrapper 必须禁用或重设 outputWindow，不能让 skipped 绕过安全变换。本次没有证明任何当前用户扩展使用该后端，不预先实现。

### 17.7 1.0.3 实施顺序、完成门槛与最终判断

1. 先备份配置并盘点旧 Azure 身份、冲突和用户扩展旧模块 import；明确迁移／兼容方案，不直接升级后接受隐式 fallback。
2. 三包／锁文件同步 1.0.3，做必要 Azure 兼容；接收上游 OAuth／output-file 修复，不重写 refresh、Shell 或会话持久化。
3. 添加 Azure／取消 refresh 轮换持久化／普通 Shell 输出权限 fixture；重跑既有全部工具、hidden／权限 hook、startup/resume/Fork/reload、排队／abort、Packs／adapter／导出回归，继续不注入新 native factories。
4. 实施后再 typecheck、lint、全量测试、隔离 `npm run build`；检查实际 Next native compiler、版本 guard、npm/pnpm 包 aliases，运行真实浏览器登录／首页 hydration，而非只检查 HTTP 200。已验证的最新依赖与产物默认同步运行工作区；不自动停止／重启服务，服务控制仍须用户明确指示。
5. 真实 Azure／现有 OAuth 账户、MCP server、Packs、Terminal 等人工验收仍保留；1.0.2 的通过记录不自动等价为 1.0.3 已通过。不给本次静态调研添加测试成功／生产恢复结论。

**结论：存在 P0。** Azure 更名是有旧 Azure 数据／调用时必须处理的兼容阻断；OAuth refresh 取消后的轮换持久化是非 Azure 用户也可能受影响的现有认证完整性修复。三 SDK 升级及普通输出权限作为 P0 接收／回归项。其余 Azure 新模型、codemode／durable 能力保持 P1／后续 backend 专项，TUI 变化不复制到 Web。**调研当时仅更新计划；后续 1.0.3 开发／验证见 17.8，仍未部署、提交或发布。**

### 17.8 1.0.3 P0 实施记录：源码／自动化完成，未部署

**依赖与隔离边界**：三个 SDK 声明及锁文件固定为 1.0.3，同步相关 pi 传递包；新增直接 `proper-lockfile@4.1.2` 和开发类型 `@types/proper-lockfile@4.1.4`。其余框架／工具链版本未变，Pivot 仍为 1.2.2。安装、测试、build／pack 均在 `C:/Users/spade/AppData/Local/Temp/pivot-p0-103-MRd5TA`，没有覆盖当前工作区 `.next`、`node_modules` 或 tarball；用户既有移动端和其他未提交改动原样参与隔离验证，未撤销或提交。

**Azure 采用只读旧身份别名，不迁移配置**：

- `lib/model-runtime.ts` 统一创建 Pivot ModelRuntime／services，按旧凭据、旧配置、默认／enabled 引用或显式旧会话需求注册 legacy 身份，复用 1.0.3 的 Azure Responses 实现与 catalog metadata；无旧身份需求时不增加 legacy catalog。legacy 别名只包含 Responses，不新增 Foundry UI／专项能力。自定义同名但不同 API 的 provider 保留原实现；用户扩展在 services 加载阶段仍可注册自己的 provider。
- 新旧身份分别使用自身 credential／models 配置，新旧键内容不同也不相互覆盖、合并或自动 fallback。这是 17.3 的运行时兼容读取方案；“迁移时阻断冲突”仍适用于未来受控迁移，不对当前别名方案执行迁移。
- 模型列表／defaults、API-key status／provider list、模型测试和 RPC startup／set_model 均接入；新 `azure` 图标与历史 id 图标并存。全局／项目 settings、thinking、API id、env、未知配置字段和历史 message provider 均保留。
- 旧会话无法恢复时，在 SDK 创建 session 前拒绝 fallback，避免给原文件追加错误模型。用户明确发出有效 `set_model` 请求时可恢复，并按原有 persist 语义保存新选择；普通 prompt 不隐式切换。resume／reload／Fork、凭据不串用、配置不迁移及 Web API 查询／恢复由 `lib/azure-compat-sdk.test.mjs` 覆盖；API-key 更新另保留原 credential env。

**OAuth 接收 SDK 修复，并补齐 Pivot 文件锁**：

- 没有复制 OAuth refresh 实现；`lib/oauth-refresh-sdk.test.mjs` 使用真实 pi-ai Models 和 SDK 的文件-backed AuthStorage，覆盖 request cancel、model-refresh cancel、supersede、并发单次刷新、取消锁等待、重新读取 token 和注销竞争。
- 发现 `lib/auth-store.ts` 旧进程内 promise chain 与 SDK 锁不互通，API-key 读改写可能覆盖 SDK 刚轮换的 token。现使用同一 `auth.json.lock`／`realpath: false`／30 秒 stale 协议，原 promise chain 保留；等待锁可取消，刷新进入 callback 后的持久化不因调用方取消丢弃。进程间写入回归用独立 Node 子进程，不仅测试同一模块内的队列。
- 原子 tmp＋rename 和 `0600` 保留，锁内取最新数据；无效／不可读 auth 文件不再当作空对象覆盖，错误不显示可能含秘密的 JSON parser 片段。没有读取、迁移或替换真实用户凭据。

**普通输出权限与边界**：`lib/shell-output-sdk.test.mjs` 使用实际 SDK accumulator／bash executor／output-file helper，验证完整长输出、空输出、非零状态、`wx` 失败不覆盖现有文件，以及获准路径／越界 temp 的判定。不放开 temp 根、不修改 SDK 文件 mode。Windows 上 POSIX mode 断言不执行，实际 ACL、服务账户及真实磁盘写入异常仍留实机验收。

**最终验证结果**：

| 检查 | 结果 |
|---|---|
| typecheck／实际 SWC compiler guard | 隔离 `npm run build` 前置检查通过 |
| 全量测试 | **428 tests / 424 pass / 4 skipped / 0 fail**；`node --experimental-vm-modules --test --test-concurrency=4`，包含 17 项新增 Azure／OAuth／输出回归 |
| lint | **0 errors / 9 既有 warnings**，无新增警告 |
| build／pack | 隔离 `npm run build` 成功；1.2.2 tarball 共 876 文件，约 11.7 MB；SDK build metadata 为 1.0.3 |
| 生产页面／浏览器＋构建 guard | **10/10 pass**；真实 Chrome 登录／composer／hydration、API-key 保存／读取／删除、旧 Azure status、全部工具均通过 |
| npm／pnpm consumer 安装 | 均以 `--ignore-scripts` 安装本地最终 tarball；launcher 恢复 aliases，HTML/assets/models/auth/sessions/all-tools 与 API-key 写入／旧 Azure 读取通过 |

全量的 4 个 skip 是 Windows 上的 3 个 Terminal 集成测试及未设置 production-dir 时的页面测试；页面测试已在独立真实浏览器验证中执行成功，Terminal 三项仍待人工。`app/api/cwd/browse/route.test.mjs` 的旧 `/tmp` fixture 改用平台 `tmpdir()`，保留路径穿越断言；RPC 源码测试改为检查兼容 helper 仍先调用 SDK services、再创建 session，没有删除检查。跨进程测试的启动等待改为 10 秒，全量并行限制为 4，避免并行导入争用导致原 2 秒启动等待误报。

**最终产物与证据**：

- tarball：`C:/Users/spade/AppData/Local/Temp/pivot-p0-103-MRd5TA/sincw-pivot-ui-1.2.2.tgz`，SHA-256 `7a9e614f744945e8bbb5da1b624070ee1c802e5aa738918bed9e895b60d6917a`。
- 隔离日志：`install-103.log`、`full-tests-103.log`、`lint-103.log`、`build-103.log`、`browser-103.log`；目录索引为 `tmp/ts7-tooling/p0-103-path.txt`。consumer 日志：`tmp/ts7-tooling/{npm,pnpm}-smoke-103.log`。
- 最后一次 browser／consumer 验证均发生在 API-key env 保留及显式模型恢复修改后的重新构建之后；最终两个 consumer 与隔离 build 的 **488 个 JS／BUILD_ID 文件逐一哈希一致**，不是只检查同名包／版本号。工作区交付源码／锁文件与隔离副本无差异（文档记录除外），`git diff --check` 通过。
- 最后只读检查 WinSW 为 `Started`；工作区安装 SDK／build metadata 均仍为 1.0.2，隔离 build 为 1.0.3。未对服务执行停止／重启，未部署、提交、发布或修改 Pivot 版本号。

**当时剩余 P0 不作完成声明**：真实 Anthropic／Codex 等认证／refresh、真实 adapter MCP／Packs／用户扩展（含旧 Azure 模块 import）、Windows Terminal、工作区完整端到端、服务账户输出权限／ACL／真实磁盘写入失败演练，以及匹配产物的受控部署／实机回归。工作区同步随后按用户要求执行，见 17.9；人工验收状态仍按实际证据记录。

### 17.9 运行工作区默认同步：1.0.3 已更新，不重启服务

用户明确约定：升级／修复后默认更新运行工作区到当次已验证最新版本，**不停止或重启服务，不需再次提醒**。已写入 `AGENTS.md` 的“运行工作区更新约定”；后续隔离构建不能代替最终工作区同步。此约定不授权发布、提交或修改 Pivot 版本号。

本次执行：

1. 备份旧生产产物、tarball、pi 安装包及正确 SWC 至 `F:/MyWorkspace/Node_Workspace/pivot-ui-build-backups/before-workspace-103-2026-10-05T17-58-26-225Z`；旧完整 `.next` 保留在该目录的 `live-next`，没有丢弃原 cache／dev 目录。
2. 工作区运行 `npm install --include=dev --ignore-scripts`，增量安装锁文件对应依赖，避免安装阶段改旧构建别名；三个 SDK 实装均为 1.0.3，锁文件与隔离版一致。SWC SHA-256 保持已验证的 `8426bdb9a428960a919c89713ed5d5caf17f4aafc4985e1639e16c9130c471a0`，实际 compiler guard 通过。
3. 将隔离验证的完整生产产物暂存、恢复本地 aliases并校验，再替换工作区 `.next` 和 `sincw-pivot-ui-1.2.2.tgz`；未在运行目录执行 Next build。**1199 个生产构建文件逐一哈希一致**，tarball SHA-256 与 17.8 最终验证包一致，四个 aliases 全部指向工作区 `node_modules`，不依赖隔离目录。
4. 工作区针对 Azure／OAuth／Shell／compiler／runtime 的回归，加独立测试进程和真实 Chrome 页面验证：**27/27 pass，0 fail，0 skip**。测试进程使用临时 agentDir／网关凭据／独立端口；不重启或替换现有 WinSW 进程，不以旧服务 HTTP 返回替代新版验证。
5. 同步前后只读 `winsw.exe status` 均为 **Started**。仅确认磁盘更新及新启动时的可用性，不宣称原进程已完整热切换版本；实际运行进程验收仍遵守服务控制要求。

安装／验证日志：`tmp/ts7-tooling/workspace-103-{install,verify}.log`；备份索引：`tmp/ts7-tooling/workspace-103-backup.txt`。未停止／重启服务、未改用户凭据或会话、未提交／发布或修改 Pivot 版本号。

### 17.10 原生 MCP breaking change：新会话 Pack 自动继承修复

根因：新会话沿用上次会话的 Pack 选择；历史选择含 MCP 时，自动 apply 被尚未开放的原生 MCP 配置管理保护拒绝，导致打开聊天报错并阻止首次发送。这不是纯 Skills apply 无条件调用 MCP guard。

修复：自动继承只选择 `mcpServerCount === 0` 的 Packs；含 MCP／混合 Pack 整包跳过并显示中英文信息提示，不转换定义、不拆分 Pack 或伪造 Skills-only receipt。全部候选被跳过时保留原浏览器选择，不创建目标 receipt。预览及 apply 期间出现 MCP 变化也安全跳过，仅处理明确的 `501 NATIVE_MCP_CONFIGURATION_UNAVAILABLE`；其他错误仍报告。手动 MCP apply／移除保护保持不变，历史工作区、Library、标记及 MCP 文件不自动改写。

验证：针对性 **54/54 pass**；全量 **448 tests / 444 pass / 4 skipped / 0 fail**；typecheck 通过、lint 为 0 errors／9 既有 warnings；全新隔离目录 `C:/Users/spade/AppData/Local/Temp/pivot-mcp-b1-pLq9GO` 完成 `npm ci --include=dev --ignore-scripts`、typegen、`npm run build` 及 pack。真实 Chrome 覆盖旧标记 absent／pending／succeeded 和干净环境；前三种均验证新建默认工作区、跳过历史混合 Pack、首次发送成功且原 Pack 配置字节不变。npm／pnpm consumer smoke 均通过；npm 首次并行安装达到 180 秒超时，单独重试同一 tarball 后成功，没有修改业务代码或跳过安装检查。

证据：`tmp/ts7-tooling/pack-inheritance-{focused,full,typecheck,lint,browser-absent,browser-pending,browser-succeeded,browser-clean,npm-retry,pnpm}.log`；隔离构建日志为 `mcp-b1-{install,typegen,build}.log`。运行工作区同步：备份 `F:/MyWorkspace/Node_Workspace/pivot-ui-build-backups/before-mcp-b1-2026-10-06T19-38-01.041Z`，完整 `.next` 的 **1227 个文件逐一哈希一致**，四个 aliases 恢复且无 missing；SDK／Next／TS7／SWC 与隔离目录一致，依赖未变无需重装。tarball SHA-256 为 `b14684f0316902f2f28a07d86697e4633fb827127881c7e7453396316ace9414`。同步后工作区 typecheck 和独立端口真实浏览器／首次发送再验证通过，日志 `pack-inheritance-workspace-{browser,typecheck}.log`。WinSW 同步前后均为 Started，未停止或重启；磁盘更新不代表现有进程已加载。未提交、发布或修改 Pivot 版本号。

### 17.11 当前工作区回归与分组提交

当前实现已替代 17.10 的自动继承方案：Packs 为同 cwd 会话共享的启停开关；新目录不继承，不提供原生 MCP 迁移或定义部署。Tools 管理工作区工具策略及 SDK 原生 MCP；MCP 弹框使用无损表单，保留隐藏字段和脱敏凭据，仅 sparse override 的连接编辑仍指向全局定义。

本次补齐行为测试：stdio／HTTP 表单切换、隐藏字段保留、凭据占位符移动拒绝、配置版本冲突、Pack 保护、信任和 symlink 边界；工具锁定写入、Exposure、owner-withdrawal、SDK discovery 与进行中任务延期；代码字符串的换行和反斜杠保真。真实 Chrome 操作新增／编辑／工作区覆盖移除／删除、工具开关及 Packs 数量与首次发送，使用临时用户目录和独立端口，不操作现有服务。

SDK 1.0.3 的工厂在恢复会话时按默认配置初始化工具；发现记录仍保存在 system transcript，但 deferred 工具需重新通过 tool_search 发现。集成测试严格检查恢复前后未提前声明、发现后声明及真实执行；不修改 node_modules，也不把“已注册”误当作“已声明”。

全量回归发现 Windows 删除锁目录期间 mkdir 短暂 EPERM；CredentialStore 仅对此锁目录竞争重试最多五次，持续权限失败和取消请求仍拒绝写入，并有故障注入测试。测试／browser smoke 脚本不进入 npm 包。

最终验证：91 个测试文件，开启当前生产构建／真实 Chrome／native MCP 的全量运行 **494 tests / 491 pass / 3 skipped / 0 fail**。三项 skip 仅为测试已明确排除的 Windows PTY 集成用例；生产页面、MCP 表单、工具与 Packs 浏览器回归实际执行通过。当前工作区 `npm run build`（编译、typecheck、Next build、自带 npm pack）通过，Pivot 仍为 1.2.2。真实账户／第三方服务器及 Windows PTY／ACL 的人工验收仍待用户执行；不据此宣称生产部署完成。
