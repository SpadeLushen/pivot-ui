# Pivot UI：pi 1.4.0 → 1.5.0 升级适配规划

状态：**依赖升级及必要适配已实施，工作区构建通过；行为验收待授权**。继续保留 `pivot-models.json`；实施记录见第 6 节。

## 1. 基线与目标

- 上游仓库：<https://github.com/earendil-works/pi>。
- 已在 `I:\pi_git` 执行 `git fetch origin tag v1.5.0`，并切换至 detached `v1.5.0`。
- 目标提交：`f9a26365568127461c47a07a37dcb42c140a3ac5`（Release v1.5.0）。
- 对照基线：`v1.4.0`，`4a080252f06caf63a525d7873c5d94d3c23887e0`。
- 标签间差异：308 commits、1578 个文件、211745 行新增、14707 行删除。比较见 [v1.4.0…v1.5.0](https://github.com/earendil-works/pi/compare/v1.4.0...v1.5.0)；其中 Chord/Durable 等变化不属于 Pivot 当前宿主。
- Pivot 基线：`lushen-custom`，`8c4a243b805538f3550f5f56aa6692c63661b211`，版本 `3.6.3`；三个直接 SDK 包均为 `1.4.0`。
- npm 元数据确认 `pi-ai`、`pi-coding-agent`、`pi-tui`、`pi-schema` 已发布 `1.5.0`；coding-agent 的 Node 要求仍为 `>=22.19.0`。

规划阶段仅获取、阅读源码并形成规划，未安装新依赖、修改实现或用户模型配置，也未执行构建、测试、lint 或服务控制。上游原有未跟踪 `.pi/mcp.json`、`.pi/skill-packs.json` 保留。

## 2. models.json 能否替代 pivot-models.json

**结论：1.5.0 仍不能在原生 `models.json` 中新增 classifier 决策模型，因此本轮不安排自动合并或删除 `pivot-models.json`。**

| 能力 | v1.5.0 实际支持情况 |
|---|---|
| 同一 Provider 同时提供 chat 与 classifier | 支持。运行时按模型类型区分；扩展注册支持混合模型列表及 `classifiers` 实现。 |
| 在 `models.json` 配置已有 classifier 所属 Provider | 支持部分共享配置，如 baseUrl、凭据及适用的 Provider compat；不等于新增 classifier 定义。 |
| 在 `providers.<name>.models[]` 写 `type: "classifier"` 创建新决策模型 | 不支持；这条读取路径始终构造 chat 模型。 |
| 删除 Pivot 的 typed 文件与注册层 | 尚不具备条件；自定义 classifier/image 仍需扩展注册。 |

判断依据取自目标标签的实际读取链：

1. `packages/coding-agent/src/core/model-config.ts:49` 的 `ModelDefinitionSchema` 和 `:72` 的 `ModelOverrideSchema` 没有模型 `type` 分支。
2. `src/core/provider-composer.ts:212` 的 `modelFromJson()` 返回 chat 形状，不读取 `definition.type`；`:337` 只查找同 ID 的 chat 模型，再将 JSON 定义加入目录。即使额外字段通过 JSON 校验，也不会因此变成 classifier。
3. 同文件 `extensionModelFromDefinition()` 才显式处理 `type: "classifier"` / `"image"`；`extensionClassifiers` 再接入相应执行器。
4. `applyModelsJson()` 对**已有** classifier 合并 Provider compat，是配置覆盖能力，不能作为支持新建 typed 模型的证据。文档 `docs/models-configuration.md` 的 Models 字段表与代码一致。

Pivot 已通过 `lib/typed-model-runtime.ts` 合并 Provider 原有目录和自定义 typed 模型。应继续允许同一个内置或自定义 Provider 同时拥有 chat/classifier，共用该 Provider 的认证。第三方扩展已占用同名 Provider 时，沿用现有冲突提示，不能覆盖其注册。

本轮保持以下存储契约：

- `lib/model-config-store.ts` 继续把 chat/Provider 配置写入 `models.json`，classifier/image 定义写入同目录的 `pivot-models.json`。
- 保留双文件锁、原子替换与失败回滚；`lib/model-catalog-refresh.ts` 继续监听两个文件；运行时保留 typed 注册、reload 和 OpenRouter 目录刷新合并。
- 保留 `assertSdkChatConfiguration()`，避免将 typed 定义误加载为 chat；不增加启动或 GET 时的合并、迁移、删除副作用。

以后重新评估合并的准入条件：SDK 的 JSON schema、模型构造、同 Provider 混合目录、classifier 执行及刷新恢复均原生支持。满足后再设计冲突处理、原子合并、运行时回读与旧文件删除；当前仅把数组搬入 `models.json` 会丢失类型语义。

## 3. 必要适配

### U1. 精确升级 SDK 与运行时资产

修改 `package.json`、`package-lock.json`，将 `@earendil-works/pi-ai`、`pi-coding-agent`、`pi-tui` 同时固定到 `1.5.0`。核对 agent-core/codemode/mcp/telemetry/schema 的解析版本，保持同一发布系列；不连带升级 Next/React 或 Pivot 自身版本。

继续使用既有 `next.config.ts` externalization、runtime aliases 和构建身份保护。安装后核对原生 MCP 内部 `dist` 模块、HTML 模板/vendor、typed lazy API、codemode worker、QuickJS/Photon WASM 的发布包位置，维护 npm/pnpm 提升依赖时的向上解析。

**Schema 破坏性变更**：pi-ai/agent-core 的工具参数校验转向 `@earendil-works/pi-schema`；pi-ai 不再导出 TypeBox 的 `Type`、`Static`、`TSchema`。新入口使用 `compile(schema, { coerce: true }).parse()`；普通 JSON Schema 也参与强制转换，错误格式随之变化。

当前 Pivot 生产源码未发现上述 TypeBox 导入、`appendGrammarToolInputJsonDelta()` 或自建流式 JSON parser 调用，故不预设大规模迁移，也不为了依赖升级直接添加未使用的 `pi-schema`。若实施编译发现直接消费点，则改用新包并声明直接依赖。不要把 coding-agent 仍用于自身配置的 TypeBox 一并删除。

Pi 扩展加载器为 `@earendil-works/pi-ai` 提供兼容视图，旧扩展从该入口导入 `Type`、`Static`、`TSchema` 仍可用；直接消费发布包的新代码应从 `typebox` 导入。使用 `Type.Refine/BigInt/Undefined/Void/Codec/Format.Set` 的扩展仍需单独检查并适配：工具参数校验不执行 refine、codec 解码或自定义 format，JSON 不支持的类型也无法接收参数。工具参数错误文案应按新内容展示，避免依赖旧 TypeBox 英文错误字符串。

### U2. 删除已被上游修复替代的 HTML 导出补丁

落点：`app/api/sessions/[id]/export/route.ts`。

升级前的 `patchExportHtml()` 强制匹配旧模板的 `sortChildren`、`mapNodes`、`markActive` 三处递归片段。1.5.0 已将这些遍历改成迭代，旧片段不再存在；继续调用会抛出 `Failed to patch exported HTML`，使导出返回错误。这是已从两侧源码确认的升级阻断点，尚未运行复现。

处理方式：

- 删除三处字符串补丁及其调用，直接返回 SDK 导出内容；不继续为新模板维护另一套正则/字符串替换。
- 保留 CLI `--export`、内部导出器兜底、离线环境、超时、临时文件清理和下载文件名处理。
- 同步修改 `AGENTS.md` 的 Exported session HTML 说明，记录深树遍历由 1.5.0 导出器负责。
- 上游新增 system prompt/tools 历史渲染及 `cost.total` 优先计算一并保留，不覆盖新版模板。

现有 `lib/session-export-sdk.test.mjs` 断言 Pivot 补丁注释、函数名和实现片段，不能原样当作新版验收依据。用户明确授权测试后，改为验收深树加载/选择、消息完整性与活动路径；保留其 5100 层场景，解除对旧补丁实现的绑定。

## 4. SDK 边界复核与继承行为

这些项目按当前实际调用点判断；只有发现签名或行为不兼容才修改实现。

### 原生 MCP OAuth

默认 `oauth.clientRegistration` 从 DCR 改为 `auto`：服务端支持公有客户端的 Client ID Metadata Document 时优先使用，否则走 DCR。显式选项为 `auto | dcr | cimd`；`clientName` 或不符合文档的回调地址会令 auto 走 DCR，显式 `clientId` 沿用指定客户端。显式 cimd 在服务端不支持时仍报错；auto 可以继续使用已存储且兼容的 DCR 客户端。

Pivot `lib/native-mcp-config.ts` 调用 SDK 纯校验器，`native-mcp-oauth.ts` 从连接取得 settings 后传给 worker，当前没有另写 clientRegistration 枚举。优先继承 SDK；复核 editor 的字段往返、worker 参数与回调解析，不自动重写 `mcp.json` 或清除授权。继续维护 workspace trust、Pack ownership、revision 检查和运行中延迟 reload。

### 费用与实际响应模型

SDK 新增 `usage.cost.totalFromProvider?: boolean`，标记总费用是否来自 Provider；合并 usage 时只有各部分均为 true 才保留 true。Provider 总额可能与按 tokens 算出的分量之和不同。

`lib/session-usage.ts` 的 `recordedCost()` 已读取记录中的 `cost.total`，无需改为重新求和或重算价格。保留缺失费用与记录零费用的区别、父 usage 已含嵌套调用的约定。若 DTO 新增该标记，只透传来源信息，不将它用于筛除 false/缺失的既有费用；本批无需新增费用来源界面。

pi-messages 协议开始透传 `responseModel`。它是 Provider 报告的模型字符串，与 Pivot 的“用户所选模型”“虚拟路由最终物理模型”不同；不据此替换持久化模型身份或把历史费用重新归类。`lib/response-model.ts`、`lib/session-models.ts` 的选择/路由契约保持；展示 Provider 原始模型名可另作增强。

### 流式工具、执行与会话结束

- 上游引入 `StreamingJsonParser` / `ToolCallArgumentsStream`，改善大型工具参数的重复解析开销，并调整 grammar JSON delta 接口。Pivot 继续消费 SDK 的标准事件与归一化参数，不再解析第二遍流式 JSON。
- `pi.exec()` 新增 `maxBuffer` 与返回值 `truncated`。默认 stdout/stderr 合计上限 256 MiB，并受运行时字符串上限约束；超限会终止命令，返回非零 code、killed/truncated。这个限制属于 SDK exec，不替代 Pivot 独立终端或其他 child_process 调用的限制。
- SDK 修复 Claude 中途 system 消息处理、压缩/分支摘要的 OAuth 解析和工具顺序保留。继续通过 SDK 执行；Pivot 不预解析 OAuth token 再当作显式 API key 传入摘要请求。
- 保持 AgentRun 的 finish/对账、SSE 重连、abort、源保持 Fork 及工具权限规则；流式优化和重试不能使旧 run 事件重新激活已完成状态。

### 目录与扩展 UI

模型目录生成改用 models.dev v2，Provider 规则迁入 `packages/ai/catalog/providers/`；realtime/image 模型不再被误归入 chat，openai 默认从 gpt-5.5 调整为 gpt-6.1-sol。Pivot 读取 SDK 目录，按类型筛选，并继续按所选模型能力限制 thinking。不要把目录默认值写回用户明确保存的默认模型，也不要从 typed overlay 的旧快照复活上游已移除的条目。

扩展 UI 增加 `custom()` 的 `blocked` 选项、Markdown transform 的可选 messageId/timestamp，以及渲染回调中的宿主 keyText/keyHint。Pivot 自建 Web bridge 不会自动获得终端 OSC 状态或新回调元数据。当前没有直接调用上述自定义 renderer/transformer；保留已完成的询问栈、重连快照和 `mode: "tui"` 声明，核对类型即可，不借本轮重做界面模式。

`PI_SELF_UPDATE_COMMAND`、扩展 changelog、终端渲染和 Chord/Durable 的新功能不改变 Pivot 的发布/会话存储路径。本轮无数据库或 JSONL 数据迁移项。

## 5. 推荐同批小项：设备登录提示

SDK `device_code` 事件新增 `openBrowserOnConfirm`、`copyCodeOnConfirm`，缺省均为 true；打开浏览器提示允许客户端忽略。Pivot 当前 SSE 丢弃这两个字段，Models 总是显示“复制并打开”。

落点：`app/api/auth/login/[provider]/route.ts`、`components/ModelsConfig.tsx`、`lib/i18n/{zh,en}.ts`。

建议透传并在前端状态中保留这两个可选布尔值。保持旧 Provider 的默认行为；显式 `copyCodeOnConfirm: false` 时不改剪贴板，显式 `openBrowserOnConfirm: false` 时不自动触发打开。按有效动作显示按钮文案，保留可手动访问的验证链接及设备码。所有复制/打开仍由用户点击触发；不由 SSE 自动操作浏览器。

这是交互完整性改进，不是 SDK 升级的编译前置条件，也不扩展为 classifier 图片测试、新认证平台或模型配置文件迁移。

## 6. 实施顺序与验收边界

推荐顺序：**U1 依赖 → U2 导出 → 第四节 SDK 边界复核 → 设备登录提示 → 关联文档 → 工作区构建**。

实施时以当时的工作区 diff 为准，保留其他改动。代码完成后按仓库约定，在当前工作区执行一次 `npm run build`，包含命令自带 compiler/typecheck/Next build/npm pack；不拆分重复执行，不创建隔离构建目录或额外备份/同步。该操作会更新 `.next`；不自动停止/重启服务，遇文件占用不强杀。不修改 Pivot 版本号、提交或发布。

本次规划未授权测试。下表是后续用户明确要求测试时的验收清单，不代表已执行或已通过。

| 范围 | 完成条件 | 优先复用入口 |
|---|---|---|
| HTML 导出 | 普通及 5100 层会话可导出；浏览器打开、选中深层节点和切换活动路径正常；system/tools 记录、通用 toolResult、费用保留。更新旧补丁断言。 | `lib/session-export-sdk.test.mjs`，实际导出 HTML |
| 同 Provider 模型 | 一个 Provider 的 chat/classifier 均可发现并分别调用；保存、刷新、reload 后类型、认证与 compat 不丢；双文件写入失败可回滚；没有合并/删除副作用。 | `lib/stage-d-models.test.mjs`、`lib/models-config-sdk.test.mjs`、`lib/pi-120-models-sdk.test.mjs` |
| MCP OAuth | auto 的 CIMD/DCR 选择、显式 dcr/cimd、已存客户端复用、手动回调及取消按 SDK 契约工作；配置往返保留新增字段。 | `lib/native-mcp-management.test.mjs`、`lib/native-mcp-editor.test.mjs` |
| 费用 | Provider total 与分量和不同时采用 total；标记缺失、false、true 均不改变旧账；父/子 usage 不重复计费。 | `lib/session-usage.test.mjs` |
| 设备登录 | 缺省保持原行为；两个显式 false 分别生效；文案与点击动作一致；取消/断连后旧事件无效。 | `lib/oauth-login.test.mjs`、Models 实际界面 |
| SDK 关键路径 | 工具参数/结果流式投影、compact/摘要、结束对账及取消可继续；目录刷新不混入错误模型类型，已保存默认选择不被覆盖。 | `lib/rpc-manager-sdk.test.mjs`、`lib/pi-120-models-sdk.test.mjs` |

以同一候选版本的工作区构建记录和获准执行的行为结果分别交付；源码阅读或编译成功不能代替浏览器导出/登录交互证据。无需重跑无关全套。

### 本次实施记录

- 已将三个直接 SDK 依赖及其解析到的 pi 组件升级至 `1.5.0`，删除旧导出补丁，接入设备登录的两个动作提示，并完成第四节边界复核。模型配置保持双文件契约。
- 首次工作区构建因环境设置 `NODE_ENV=production`、npm 省略已有开发依赖而在类型检查中断；使用 `npm install --include=dev` 恢复锁文件中已有的开发依赖后，完整 `npm run build` 通过，包括类型检查、Next 构建和自带的 `npm pack`。构建报告 14 条动态文件访问导致整体追踪的 Turbopack 警告。
- 未执行或修改测试；`lib/session-export-sdk.test.mjs` 仍绑定旧补丁，授权测试时需按上表改为行为验收。未控制服务、修改 Pivot 版本号、提交或发布。

如果需要回退，成组还原本批依赖声明、锁文件和对应适配，再重建一致的运行产物；导出代码与 SDK 版本必须一起回退。保留会话及模型配置，不以单独替换 node_modules 或硬重置处理。服务切换由后续明确授权的运行操作完成。

## 7. 关键源码索引

上游均固定至 `v1.5.0`，本地位于 `I:\pi_git`。判断以代码为主，CHANGELOG 和文档用于交叉核对。

- [models.json schema](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/src/core/model-config.ts)；[Provider 组合与模型构造](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/src/core/provider-composer.ts)；[模型配置文档](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/docs/models-configuration.md)。
- [导出模板](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/src/core/export-html/template.js)；[导出器入口](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/src/core/export-html/index.ts)。
- [pi-schema](https://github.com/earendil-works/pi/tree/v1.5.0/packages/schema)；[pi-ai 变更](https://github.com/earendil-works/pi/blob/v1.5.0/packages/ai/CHANGELOG.md)；[coding-agent 变更](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/CHANGELOG.md)。
- [MCP 配置校验](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/src/core/mcp-servers.ts)；[MCP OAuth](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/src/extensions/mcp/oauth.ts)。
- 其他上游定位：`packages/ai/src/{types.ts,auth/types.ts,api/pi-messages.ts}`；`packages/coding-agent/src/core/{exec.ts,usage-totals.ts,sdk.ts,extensions/types.ts}`；`packages/ai/catalog/`。
- Pivot 核心落点：`package.json`、`package-lock.json`、`app/api/sessions/[id]/export/route.ts`、`AGENTS.md`；模型存储/注册为 `lib/{model-config-store,typed-model-config,typed-model-runtime,model-runtime,model-catalog-refresh}.ts`。
- 当前模型存储设计背景：[runtime stage D 技术方案](runtime-stage-d-technical.md)；前一轮实施记录：[pi 1.4.0 适配](pi-1.4.0-upgrade-plan.md)。
