# Pivot UI：Pi 1.5.0 → 1.6.0 升级适配规划

**建议升级，但不要只改版本号。** 发布前先修 MCP 浏览器登录的 store 契约和 `auth.json` 共锁；再收拢扩展重载与退出清理，处理空闲预热的费用刷新。无需迁移会话、模型或 Packs。

基线：Pivot `3.9.4`（`f00562f`），`package.json` 和 npm 锁内的 Pi 组件均为 `1.5.0`。目标：`I:\pi_git` 的 `v1.6.0`（`faac58588`，2026-11-20）。比较的是 [v1.5.0…v1.6.0](https://github.com/earendil-works/pi/compare/v1.5.0...v1.6.0)，含 1.5.1、1.5.2；以下风险分析以升级前的 Pivot 调用点和上游标签源码为基线。

**实施状态**：三个直接依赖及相关 Pi 间接依赖已锁定为 `1.6.0`。下列凭据、会话生命周期、预热统计及默认模型适配已落地。当前工作区的 `npm run build` 已通过类型检查、Next.js 编译和打包，产物为 `sincw-pivot-ui-3.9.4.tgz`。文末的运行时发布验收尚未执行。

## 发布前必须处理

1. **MCP OAuth 会在打开授权页之前失败。** `lib/native-mcp-oauth-worker.ts` 把只有 `load/save` 的内存 store 交给 `signInMcpServer()`。1.6 的 `packages/mcp/src/oauth/sign-in.ts` 在普通登录（非 `insufficient_scope`）中先调用 `store.withRefreshLock()`，然后才在锁内检查 refresh token。所以即使首次登录、或 Pivot 已清空临时 tokens，也会缺方法。worker 是字符串，类型检查覆盖不到。保留每次登录的内存暂存，让 store 的 `withRefreshLock(fn)` 委托给同一 `nativeStore`；不要在外层持锁运行整个登录或等待用户。授权成功后仍在原生锁中提交，取消不覆盖原凭据。SDK 新的 `startMcpSignIn/completeMcpSignIn` 可支持另一种 Web 架构，不是修复的前提。
2. **让 UI 与 SDK 真正锁住同一份凭据。** 上游 `core/auth-storage.ts` 已按真实文件路径加锁；`lib/auth-store.ts` 仍用 `realpath: false`，原子替换还可能把 `auth.json` 符号链接替换成普通文件。先按原规则初始化不存在的文件，再针对同一解析目标加锁、读取、创建同目录临时文件和 rename；同步 Windows 锁路径重试判断。保留权限、损坏文件拒写、修改单个 Provider 的语义。影响 API key 保存、登录和退出；不需要重写用户凭据，也不要改无关配置锁。
3. **一次重载只启动一次扩展。** 对照上游 `core/agent-session.ts` 的 `bindExtensions()`、`reload()` 与 Pivot `lib/rpc-manager.ts` 的 `reloadResources()`：成功绑定后，SDK 重载已经执行 `beforeSessionStart → session_start → resources_discover`；Pivot 却在 reload 前清空自己的绑定标记，reload 后再次 bind，会重复启动。这个风险在 1.5 使用非空 bindings 时已经存在；1.6 将是否启动改为显式记录。首次创建保留先订阅后绑定；已绑定的 reload 交由 SDK 启动。将扩展命令 reload 与 Packs/Tools 资源重载共用准备逻辑，保留 typed 模型在启动事件前注册、UI 桥接、信任刷新、失败可重试和成功后的工具规则。流式或压缩中不清 UI、不应用新配置；后台请求推迟到空闲。
4. **等待关闭，不直接套 RPC 模式的修复。** Pivot 持有 `AgentSession` 而非 `AgentSessionRuntime`。对齐上游 `core/agent-session-runtime.ts` 的顺序：等待 abort/在途工具结果 → `session_shutdown` → `dispose()` → `modelRuntime.settleCredentialWrites()`。`dispose()` 已释放 provider session 资源、取消预热；无需再清理一次。`destroyAndWait()`、同 ID 重开和可等待的停机入口共用一次清理完成信号；不能靠 Node 的 `exit` 回调等待异步写入。保持 Fork 不销毁源会话。

## 用户会看到的变化与取舍

| 上游变化 | Pivot 处理 |
|---|---|
| 1.5.1 起全局 `cacheWarming` 默认由 `streaming` 改为 `idle`，符合条件时两轮之间最多预热 30 分钟，可能产生费用。 | 尊重用户已有 `off/streaming/idle`。SDK 写入 `type: usage, kind: cache_warm` 并发出 `entry_appended`。`lib/session-usage.ts` 已计入 other，不造第二笔账。让已打开页面在可收到事件时失效并重读统计快照，断线或重开读持久记录；明确区分预热事件和用户活动，不让它反复重置 wrapper 的 10 分钟空闲回收。无需延长 wrapper 寿命或新增设置页。 |
| 1.6 为 OpenAI、Azure、OpenAI Codex 增加 GPT-6.2 Astra/Sol，三者的 Provider 默认是 Sol，两模型不支持 `off`。Qwen Token Plan 更新网关/模型并移除 Team 的两个旧 ID；Copilot 新增 Microsoft-Decision-1 classifier。 | `app/api/models/route.ts` 已按 Provider 返回 SDK 上下文上限与思考档位，保留记忆档位的约束，不硬编码模型表。区分 SDK 默认与 Web 选择：无有效显式默认时 `useAgentSession.ts` 当前取排序首项，不等于 Sol。若要跟随 SDK，应让 SDK 决定无预选的新会话，再回显实际选择；保留用户显式默认和模型范围。旧模型不可用时提示实际 fallback，保留原 Azure 严格恢复策略。 |
| MCP 延迟工具在恢复/reload 时不再因扩展停用自身另一个工具而丢失；中断批量工具时，尚未执行的调用会有中止结果。 | 沿用 SDK 恢复及结果，不自行补造；`lib/active-tools.ts` 的 workspace 禁用、hidden 和按需激活优先级不变。MCP 校验部分下沉至 `pi-mcp`，仍用 coding-agent 层校验 Pi 特有的 exposure/override。 |
| TUI `Component.render()` 返回 `readonly string[]`，Container 会复用数组。 | 将 `rpc-manager.ts` 中 `CustomUiComponent.render` 的本地签名改为只读；现有 `.map(normalizeTerminalLine)` 已产生新数组，不必处处复制。第三方扩展若原地改 `super.render()` 结果，需要在扩展侧先复制。React Markdown 不继承终端 Mermaid/滚动修复。 |
| Anthropic 官方域名默认使用 message threads；OpenAI 系兼容请求、工具 schema、重试和 Codex 长连接/缓存修复；`undici` 升至 8.12.4。 | 由 SDK 接管。旧兼容代理若要求有工具历史时仍传 `tools: []`，按模型设 `compat.requiresToolsWithToolHistory: true`，不要全局强开。OpenAI 丢弃 reasoning 的诊断如需在 Web 展示，另做展示层，并遵守 `showCacheMissNotices`；不要当作会话损坏。 |
| `find` 的带 `/` 模式相对搜索目录，跨层用 `**/src/*.ts`；grep 的上下文来自 ripgrep，不再调用自定义 `GrepOperations.readFile`。`read` 改为流式，大文件、Windows 路径与工具取消均有修复。 | 使用上游工具，无需重写。HTML 导出已修复终端链接，继续使用 SDK 模板。1.5.1 的 CLI 登录、1.5.2 的缺失 cwd 交互 Fork、1.6 的 TUI 修复不自动变成 Web 功能。 |

`core/model-config.ts` 在标签间未改，`provider-composer.ts` 未新增 JSON classifier/image 构造分支。内置 classifier 增多不等于可从 `models.json` 新建任意 classifier；保留 `models.json` + `pivot-models.json`。会话格式仍为 v3。`AgentSessionRuntime.takeUnreportedDiagnostics()` 只属于 runtime；当前工厂返回的 `modelFallbackMessage` 即可用于恢复提示，不为一个通知替换整套 wrapper。

## 实施与验收顺序

1. 在当前 worktree 把 `pi-ai`、`pi-coding-agent`、`pi-tui` 同时精确锁为 `1.6.0`，更新 `package-lock.json`；核对 agent-core、codemode、mcp、schema、telemetry 同版。coding-agent 的 Node 最低要求仍为 `22.19.0`。以 npm 锁为准，历史 `bun.lock` 不是本次基线。不联动 Pivot、Next 或 React 的版本。
2. 先完成上述凭据与生命周期修改，再接统计刷新和只读渲染类型。保留 runtime aliases、原生 MCP 内部 `dist` 路径与导出器 fallback；这些动态加载路径不会全部由 TypeScript 覆盖。实施完成后按项目约定，在当前工作区运行一次 `npm run build`（含 typecheck、Next 构建、npm pack）。
3. **发布验收场景**：首次 MCP 登录能出现链接，取消重登保留旧授权，成功回调后可使用资源；链接路径与真实路径并发保存不同 Provider 不丢更新。一次 Packs/扩展重载仅收到一次 start/discover，延迟 MCP 工具和 typed 模型可用；运行中变更延后，关闭过程不中断凭据写回。空闲预热只计费一次且不延长空闲回收；GPT-6.2 不暴露 `off`，用户指定默认不变；旧会话恢复、源会话运行中 Fork 和 HTML 导出仍正常。构建通过不能替代这些行为证据。

上游依据：[coding-agent 发布记录](https://github.com/earendil-works/pi/blob/v1.6.0/packages/coding-agent/CHANGELOG.md)、[pi-ai 发布记录](https://github.com/earendil-works/pi/blob/v1.6.0/packages/ai/CHANGELOG.md)、[MCP 登录调用顺序](https://github.com/earendil-works/pi/blob/v1.6.0/packages/mcp/src/oauth/sign-in.ts)、[会话绑定与重载](https://github.com/earendil-works/pi/blob/v1.6.0/packages/coding-agent/src/core/agent-session.ts)、[退出顺序](https://github.com/earendil-works/pi/blob/v1.6.0/packages/coding-agent/src/core/agent-session-runtime.ts)。

