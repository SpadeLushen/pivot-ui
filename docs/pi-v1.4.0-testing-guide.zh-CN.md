# Pivot 的 pi 1.4.0 适配测试指南

## 1. 先测什么，怎样才算完成

推荐顺序：**隔离本地回归 → 补齐适配专项 → 浏览器检查 → 按需真实服务/安装验证**。先执行 P0，再处理 P1；不要一开始就使用真实密钥跑整套。

对象是当前工作区的最终代码：Pivot **3.2.1**，pi-ai/pi-coding-agent/pi-tui 及 agent-core/codemode/mcp/telemetry **1.4.0**，界面声明保持 `mode: "tui"`。最终代码已包含后续底部询问面板，测试不能再以“扩展询问应弹出遮罩”为预期。

**当前证据只有两阶段构建通过，尚无本轮行为测试结果**。本指南的编写没有执行测试、安装、重建或启动服务。第一阶段日志为 `%TEMP%\pivot-pi140-build.log`，最终日志为 `%TEMP%\pivot-inline-interaction-build.log`；最终产物 `sincw-pivot-ui-3.2.1.tgz`。两个构建均有 16 条动态文件追踪 warning，不计作测试失败，也不隐藏它们。

完成条件：P0 用例实际通过、P1 的执行/跳过原因记录清楚；本地 fixture、浏览器、真实账户证据分别列出。测试数以实际输出为准，不沿用旧版通过数量。构建、目录文件存在或 HTTP 200 均不能代替关键行为检查。

## 2. 测试前的隔离

- 仅在明确授权的测试阶段执行下文命令；本指南不启动这些操作。
- 使用临时 agentDir、临时工作区、假 Provider 与本地 MCP。不要复制真实 auth.json，也不要对正在使用的会话做压缩、分支、工具执行或 Pack 切换。
- 在导入 SDK 前设置 `PI_CODING_AGENT_DIR`；测试进程清除继承的 Provider/云凭据，避免使用 ambient credentials。
- `PI_OFFLINE=1` 只限制自动联网，**不阻止显式模型请求**。fixture 必须只允许指定本地请求或 mock URL，其他目标直接失败；真实请求不得以“无密钥”作为唯一阻断手段。
- 测试账户、客户端日志和请求快照不得输出 Authorization、cookies、token、图片 base64 或私人会话内容。用固定计数器、非敏感标记及脱敏错误断言。
- 默认 worker 上限为 2；在独立测试进程内固定该值，不修改现有服务环境。不要用忙循环占 worker，也不要强杀现有服务。
- 不创建隔离构建目录。源码改变后按仓库约定在当前工作区运行 `npm run build`；未改变源码且已有匹配构建时无需重复构建。不要拆开重复 typecheck/Next build/npm pack。

## 3. 现有回归入口与运行命令

先核对实际依赖，而不是系统全局 pi CLI：

```bash
npm ls @earendil-works/pi-ai @earendil-works/pi-coding-agent \
  @earendil-works/pi-tui @earendil-works/pi-agent-core \
  @earendil-works/pi-codemode @earendil-works/pi-mcp \
  @earendil-works/pi-telemetry --depth=2
```

下面是获准后可执行的 Git Bash 示例。在仓库根目录运行；临时目录仅放测试配置，不是另一份安装或构建工作区。回归会启动它自己的本地 fixture 进程。

```bash
(
  set -eu
  agent_dir="$(mktemp -d)"
  trap 'rm -rf -- "$agent_dir"' EXIT
  if command -v cygpath >/dev/null 2>&1; then
    export PI_CODING_AGENT_DIR="$(cygpath -w "$agent_dir")"
  else
    export PI_CODING_AGENT_DIR="$agent_dir"
  fi
  while IFS= read -r name; do
    case "$name" in
      *_API_KEY|*_TOKEN|AWS_*|AZURE_*|GOOGLE_*|ANTHROPIC_*|OPENAI_*)
        unset "$name" ;;
    esac
  done < <(compgen -e)
  unset PI_CODING_AGENT_SESSION_DIR PI_PACKAGE_DIR
  unset PIVOT_TEST_PRODUCTION_DIR PIVOT_TEST_BROWSER PIVOT_TEST_NATIVE_MCP
  export PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0
  export PI_CODEMODE_MAX_WORKERS=2 AWS_EC2_METADATA_DISABLED=true
  log="${TMPDIR:-/tmp}/pivot-pi140-local-$(date +%Y%m%d-%H%M%S).log"
  status=0
  node --test --test-concurrency=1 \
    lib/active-tools.test.mjs lib/agent-run-state.test.mjs \
    lib/rpc-manager.test.mjs lib/rpc-manager-sdk.test.mjs \
    lib/native-mcp-sdk.test.mjs lib/native-mcp-editor.test.mjs \
    lib/workspace-pack-switch.test.mjs lib/models-config-sdk.test.mjs \
    lib/stage-d-models.test.mjs lib/session-export-sdk.test.mjs \
    > "$log" 2>&1 || status=$?
  printf 'Exit: %s\nLog: %s\n' "$status" "$log"
  exit "$status"
)
```

串行是为了便于定位状态污染、共享 worker 和子进程清理；不是性能基准。结束后确认 fixture 子进程退出，不能靠杀掉其他 Node/Chrome 进程清理。

### 现有文件覆盖的是回归底座，不等于 1.4.0 专项已覆盖

| 入口 | 可复用内容 | 仍需补齐 |
|---|---|---|
| `lib/rpc-manager-sdk.test.mjs` | 真 SDK、假模型流、resume/reload、权限、队列、Fork、busy/abort | 同进程 worker 排队；新交互快照与并发状态 |
| `lib/rpc-manager.test.mjs` | wrapper 对话框、状态重播 | 请求顺序、超时、重复/混合响应、custom 异步 factory、销毁 |
| `lib/native-mcp-editor.test.mjs`、`lib/workspace-pack-switch.test.mjs` | CRUD、trust、凭据遮罩、ownership、revision/回滚 | BOM、CRLF 与原文恢复 |
| `lib/stage-d-models.test.mjs`、`lib/models-config-sdk.test.mjs` | typed 分文件、真实本地分类协议、取消、采样和字段保留 | 三种图片 wire 格式、compat 优先级与 false |
| `components/MessageView.test.mjs` | 工具展示的若干辅助行为 | 新旧四类 worker 失败提示；不能只查源码关键字 |
| `lib/session-export-sdk.test.mjs` | 5100 层树、通用工具结果和导出补丁函数 | CJK 实际浏览器渲染、树点击及 vendor 加载 |

补充回归可在同样隔离条件下显式选择 `lib/session-reader.test.mjs`、`lib/session-usage.test.mjs`、`lib/session-persistence.test.mjs`、`lib/pi-120-models-sdk.test.mjs`、`lib/tool-settings-save.test.mjs`、`lib/workspace-tools.test.mjs` 和 `scripts/pivot-build-runtime.test.mjs`。文件名带 120 仍可作目录回归，但不是 1.4.0 结果。

**两处容易误读的现状**：

- `rpc-manager-sdk` 中的 `capacity retry finishes…` 模拟的是 Provider 的 `model is at capacity`，不是 codemode worker 容量；即使通过，也不证明新排队行为正确。
- 静态阅读发现 `components/ChatWindow.test.mjs` 的 notice-details 用例要求 `NoticeDetailsDialog` 内直接有 `createPortal()`，而当前通过 `SessionDialog` 委托。尚未运行该用例；若失败，先区分结构断言失配与实际模态行为，不删除“通知详情仍为对话框”的要求。

新增专项应在后续获准的测试任务中补入真实 wrapper/hook/组件入口，使用 fake Provider/受控本地服务；本文没有创建任何测试文件或测试扩展。

不要执行裸 `node --test` 或假设存在 `npm test`。本项目无 test 脚本，自动发现还可能混入 `/api/models-config/test/route.ts`。全量回归需另行明确选择范围；上游 `I:\pi_git` 的测试也不属于上述命令。

## 4. P0：适配专项必须通过

### A. 依赖与 worker admission

**A1｜运行资产**：版本检查应全部为 1.4.0，不能出现另一份被实际调用的 1.3.0。实际创建 codemode worker 并调用一个本地工具；生成一份 HTML 导出。预期无模块/WASM/vendor 缺失，worker 正常退出。只找到文件不算通过。

**A2｜第三个脚本等待**：在同一 Node 进程内创建多个 wrapper，以受控本地工具的未完成 Promise 占住两个 worker，再提交第三个脚本。记录脚本入口与工具副作用计数。

预期：第三个不立即报 capacity；释放一个名额后才运行，且只执行一次。追加第四个时，等待者按到达顺序取得名额。分开启动三个服务进程不能验证这个全进程共享上限。

**A3｜等待的三个终态**：分别让等待者连续 60 秒无名额且不设置更短 deadline、带更短的 `timeout_ms`、以及等待中 abort。预期依次为容量等待失败、脚本等待超时、等待取消；均说明脚本未开始，副作用计数为 0。随后释放 worker 并发送新消息，UI 能继续，wrapper 不残留 busy。60 秒路径至少保留一条真实边界用例，不能用更短超时冒充。

**A4｜真正退出才释放**：取消一个仍在退出的 worker，观察实际 worker exit 与后续脚本启动顺序。预期调用返回不等于名额已释放，不超过上限；无自动重跑、额外全局队列。变更 `PI_CODEMODE_MAX_WORKERS` 只在测试子进程内进行，结束后不影响其他服务。

### B. 询问状态、权限与重连

使用真实 AgentSessionWrapper 的 UI bindings 发请求，直接观察 `extension_ui_snapshot`；hook/浏览器再消费同样快照。快照包含 `sessionId/runtimeId/revision/requests`，requests 按旧到新排序，最后一项为当前询问。

**B1｜并发与嵌套**：先打开 A input 并输入草稿，再打开 B confirm；另测 custom 的 async factory 尚未返回组件就发出 confirm，以及隐藏 custom 重绘。预期 B 在前，回答后恢复 A 及输入；父 custom 挂载/重绘不抢占 B。每个 Promise 完成一次。

**B2｜拒绝误授权**：取消、Escape、非栈顶响应、非法选项、重复响应和混合 `{ cancelled: true, confirmed: true }` 分别送入 fixture。预期取消返回 false/undefined；无工具执行；非法响应不能推进其他询问，重复响应无重复副作用。普通 input/editor 的文字不得成为新聊天消息。

**B3｜关闭与错误**：让隐藏请求先超时，分别触发 signal abort、停止 run、reload、wrapper destroy、custom done。预期快照删除相应请求，恢复时不再出现。模拟“请求发送前失败”及“服务端已处理但 HTTP 回包丢失”：前者保留输入可重试，后者通过权威快照收敛，不能重复执行；custom 按键失败不自动重发。

**B4｜迟到与跨客户端**：重连、刷新、切换 A/B 会话、两个客户端回答同一题；注入较小 revision 和已退休 runtime 的旧快照。预期只接受匹配会话的新状态，不复活旧询问；当前标签页内返回会话可恢复仍待答输入。完整刷新页面不要求恢复未持久化的询问草稿，但待答题本身应恢复。无输入时也验证 SSE 致命断线后的恢复。

### C. MCP BOM：加载、编辑、Pack 三条路径一致

**C1｜格式往返**：在临时 agentDir 和临时受信工作区分别建立 `mcp.json`，组合 BOM/无 BOM、LF/CRLF、global 定义/project override。放入未知顶层字段和假凭据；服务器默认禁用。

步骤：读取 SDK 配置 → Tools GET → 编辑描述并保存 → 重开。预期三条读取路径都识别服务器；GET 前后文件原文相同；保存保持开头 BOM、换行、未知字段和未编辑凭据，浏览器只收到遮罩。定义校验/编辑不能启动服务器或执行凭据命令。另用损坏 JSON/非对象输入，仍须明确拒绝，不能当成空配置覆盖。

**C2｜Pack 与失败回滚**：让测试 Pack 引用已有的本地 native server，执行 on/off；注入 receipt 写入失败及外部并发编辑。预期只改变归属范围内 enabled，保留定义与格式；旧 revision 拒绝。失败回滚恢复精确原文；遇并发编辑报告冲突并保留外部修改。用本地计数和文本比较，不需要额外计算摘要。

**C3｜保护不回退**：未信任工作区、symlink 路径、被启用 Pack 管理的字段仍不能越权修改；禁用最后一个 owner 后允许原有合法编辑，但不删除定义或全局凭据。检查临时 mcp-auth.json 的 sentinel 不变。

### D. classifier 图片 compat：检查实际请求体

用 `createPivotModelRuntime`/会话真实注册路径，将配置保存、重开、refresh/reload 后向受控本地端点发送一张小测试图片。每种格式都验证请求体，不能只断言结果为 200。

| 配置 `imageInput` | 请求应具备的特征 |
|---|---|
| `assets` | 图片在 assets 映射中，state 引用对应资产；Jev 使用 PNG/JPEG |
| `images` | Clef 的 images 数据 URL 列表；PNG/JPEG/WebP，最多四张 |
| `state-image-urls` | state 中的 image_url 内容位于 JSON state 前；不偷偷改发 assets |

**D1｜优先级与 false**：分别仅设置 Provider compat、增加模型级覆盖、使用 base 目录元数据；覆盖 `sendImageOptInHeader: false`。预期模型 > Provider > base > 自动检测，false 不丢；TypeSafe 需要 opt-in 时有对应头，显式关闭时没有。用名称/URL 无法推断上游的自定义代理，确认 Provider 字段确实到达请求。

**D2｜边界与保存**：错误 imageInput 类型/枚举、错误布尔字段明确报配置错误，不发模型请求；不适用的 Decisions/llama.cpp/image/chat 不注入 System One 字段。已有纯文字调用、typed 分文件、同 ID 不同类型、未知配置字段、取消及 usage 口径不变。

**D3｜现有测试入口仍限文字**：`/api/models-config/test` 对 classifier images 继续返回输入错误，对 image 生成返回不支持，均无收费请求。图片分类通过 SDK/codemode 专项验证，不把这条已有入口强改成图片上传功能。

## 5. P1：SDK 行为与原有契约回归

**E1｜工具恢复**：resume、tree 和压缩后恢复旧会话，再加入历史从未记录的新扩展工具。按 Pivot 的“全可用 + global/workspace override”契约验证；disabled/hidden、owner 撤回、MCP deferred/codemode、权限 hook 均不能被绕开。在途保存 Tools 不改变本轮规则，下一轮才生效。不要把 SDK 的 defaultActive 规则机械套成 Pivot 新默认。

**E2｜摘要预算与指令**：fake Provider 记录实际摘要请求参数。长推理摘要不再受旧 4096 或 reserveTokens 固定输出帽限制；`/compact 重点保留部署步骤` 的要求应进入 split-turn 前缀摘要。压缩失败/取消后可以继续；不要仅测试 `parseCompactionSummary()`，那只覆盖显示解析，不覆盖摘要请求。

**E3｜截断恢复与账单**：构造含截断 toolCall 及对应 toolResult 的失败尝试，分别在当前运行与重新打开后恢复。下一次 Provider 上下文中二者成对省略，不出现孤立结果；原 JSONL 与历史费用保留。父工具已包含的嵌套模型 usage 不重复累计，缺失费用不当作 0。

**E4｜重试、溢出与终态**：本地端点模拟 HTTP 413、代理 stream disconnected、临时网络失败、Business workspace 限额及包含 503 等数字的请求编号。前者进入对应恢复/重试，限额与普通数字不造成错误重试。中间 agent_end 不结束整个 AgentRun，最终按 agent_settled/对账收敛；无幽灵消息、重复声音或残留 busy。

**E5｜请求身份**：在 fake transport 最终请求边界检查 User-Agent 和归因头，而不是只看 before_provider_headers 的输入。SDK session 遵循 `PI_TELEMETRY`/enableInstallTelemetry；关闭归因不等于移除 User-Agent。null 头能删除默认归因，显式配置头优先；自定义 OpenCode endpoint 的 session header 正确。直接 ModelRuntime 不应被误测为自动继承聊天 session identity；不要求 Pivot 新增遥测上报。

**E6｜模型目录**：MiniMax-M3.1-Flash 无 off、Grok 4.3/4.5 有 xhigh；retired 模型不会被 typed overlay 混回。用户显式默认选择不自动改写；已不可用时给清楚提示。历史费用不按新目录重价，OpenRouter 个性化目录刷新仍保留 typed 模型。

**E7｜Fork、导出与安装资产**：Fork 在源 idle/running/compacting 时不销毁或改写源 wrapper；新分支独立。导出中文标点旁的粗体/斜体正确，5000+ 层树可打开、点击和导航，无递归溢出，CJK vendor 不缺失。原生 MCP 能调用并关闭自己的进程；worker/WASM/lazy API 实际可用。Windows 内置 shell 发现与 `rg --no-config` 分别验证，不拿独立终端面板替代工具路径。

## 6. 浏览器：在最终底部面板上验证适配

### 先复用浏览器回归，再验证新的交互

在第三节同样的隔离环境中，将测试文件列表替换为以下入口。需要已有 Chrome/Chromium；可通过 `CHROME_PATH` 指定真实可执行文件路径，Windows 示例为 `C:/Program Files/Google/Chrome/Application/chrome.exe`。

```bash
node --test --test-concurrency=1 \
  components/stage-d.browser.test.mjs \
  components/useChatViewport.browser.test.mjs
```

这些入口使用自身的临时页面/本地服务和 Chrome profile，不要求停止 30141 服务。现有 stage-d fixture 主要验证发送、终态与迟到回执；没有新询问快照覆盖。现有 viewport fixture 也不能证明新增 workspaceRef/手机高度链已经通过。它们是回归底座，不是完整应用截图验收。

新交互专项应加载真实 hook、ChatInput、ChatWindow/dock 和应用 CSS，使用本地 fake Provider/测试扩展确定性触发询问。当前尚无本轮专用 fixture，需由后续测试任务补齐；不要用真实危险工具命令或让收费模型随机生成询问来替代。

需要启动完整 Pivot 时，先确认有匹配构建、临时配置和空闲端口，使用单独本地进程与测试浏览器 profile；不使用或重启现有 WinSW 服务。只清理本次创建的进程。不得将新测试 profile 连到真实账户后继续称为离线验收。

### 操作清单

**F1｜五类面板与草稿**：先在聊天输入区输入文字、选中部分内容、添加附件并留一个上传中任务。依次触发 select/confirm/input/editor/custom。预期输入区收起但不卸载，面板铺满当前会话列的可用宽度，消息可滚动/复制；全部请求结束后草稿、附件和光标保留。询问文字不被发成聊天消息。

**F2｜权限与输入法**：默认焦点不能落在危险确认上。中文候选 Enter 不提交、不授权；input 用 Enter、editor 用 Ctrl/Cmd+Enter；Escape/取消按原语义返回。custom 的关闭/按键仍由扩展处理，不能因 UI 消失就视作批准。

**F3｜网络与双客户端**：对回复 POST 模拟失败/回包丢失，在第二标签页回答同一题，再断网重连。预期失败可见、答案不丢、重复点击不重复执行，两端最终都关闭已答题；迟到快照不会恢复它。custom 输入失败提示检查状态，不自动重发按键。

**F4｜窗口和软键盘**：桌面宽/窄列、右侧工具面板展开、手机竖/横屏、软键盘弹出。长标题、说明、选项与 editor/custom 均可滚动，确认/取消始终能到达；不盖住历史，不出现全页遮罩或标题拖动。检查浅色、深色、护眼主题与键盘 Tab 导航。

**F5｜滚动与焦点**：在底部跟随时打开/关闭询问，末尾仍可见；浏览历史或选中文字时，不强拉到底。面板重绘不抢焦点；用户已点击侧栏/历史后关闭询问，不强制聚焦输入框。分页和 minimap 不复位。

**F6｜控制与提示**：普通输入区隐藏后，停止生成/压缩仍可点击；等待者取消后可再次发送。错误、重试、待处理数与排队消息信息仍可见。分别展示旧 capacity、60 秒无名额、等待超时、等待取消结果；普通执行错误不能错误归类为排队失败，也不显示伪造队列位置。

**F7｜未改动的界面**：通知详情仍是独立对话框；Models、Tools、Packs 和登录等应用界面不迁入 dock。`mode: "tui"` 的扩展可运行，不能因改成底部区域丢失权限询问。

记录桌面/手机关键截图、屏幕尺寸、浏览器版本及对应 case ID；网络/协议只保留脱敏证据。

## 7. 按需执行：真实 Provider 与安装产物

这些检查会涉及网络、可能收费或启动额外进程，必须单独确认范围；不能从“编写指南”推导出执行授权。

- **真实图片分类**：指定 Provider、模型、代理地址、请求数和费用上限，使用公开或合成的小测试图片。比较明确受图片影响的结果；同时确认输入格式正确。请求成功或文字问题回答正确，不证明图片被模型读取。不要发送私人截图。
- **真实目录/鉴权**：按需检查退役模型、受限 OpenRouter key 和 ChatGPT Business 限额的实际提示。不要为测试限额主动耗尽账户；无可用场景时记录未覆盖，不伪造通过。
- **真实长对话压缩**：只在专用测试会话进行，先确认计费与可接受耗时；真实旧会话只读浏览不应触发模型/MCP。不要用生产会话验证恢复副作用。
- **npm/pnpm consumer**：针对最终 tgz，分别验证 hoisted 安装、运行时 aliases、worker/WASM、导出 vendor 与启动身份保护。安装需确认生命周期脚本范围；测试安装目录不作为另一份源码构建目录，不额外 npm pack 或发布。
- **生产构建冒烟**：已有入口 `scripts/production-pages.test.mjs` 需 `PIVOT_TEST_PRODUCTION_DIR` 指向待测应用根目录；未设置会跳过。该文件会启动自己的 Next 服务并清理其进程，`PIVOT_TEST_BROWSER`/`PIVOT_TEST_NATIVE_MCP` 会扩大覆盖，不能悄悄开启。只使用匹配产物，不能关闭版本保护来让旧 `.next` 配新 SDK 启动。

没有相应账户、浏览器或安装授权时，记录“未执行及原因”；不把跳过写成成功。测试范围不包含新增遥测平台、Durable/Chord 迁移、全局升级 pi CLI 或开放 Models 图片测试功能。

## 8. 报告、失败处理与交付门槛

每项至少记录：**case ID、候选代码状态、实际依赖/Node/浏览器版本、fixture 或真实服务、步骤/输入、预期、实际、通过/失败/跳过、日志位置**。不要求为普通文件额外计算哈希；工作区尚未提交时，记录所测 diff 范围，不能只写当前 HEAD 当作完整候选身份。

建议报告结构：

```text
候选：Pivot 3.2.1 / SDK 1.4.0；工作区改动范围：…
本地回归：…通过 / …失败 / …跳过；日志：…
P0：A1–D3 各项结果与证据：…
P1：E1–E7 各项结果或未覆盖原因：…
浏览器：F1–F7；桌面/手机与截图：…
真实服务/consumer：执行范围及费用，或未执行原因：…
缺陷：case ID → 实际影响 → 修复/后续负责人
结论：可交付 / 有条件交付 / 不通过；剩余边界：…
```

**立即判失败**：误授权或重复工具副作用、真实凭据/配置被测试改写、跨会话串题、丢失草稿、旧请求复活、worker 超过上限、无法停止/再次发送、孤立 toolResult 导致会话不能继续、回滚覆盖外部修改、历史费用漏记/重复累计、运行包缺关键资产。

发生失败时，先区分产品缺陷、fixture 不完整、静态断言过时和环境缺失。修正应回到对应契约：例如通知详情允许委托 Portal 实现，但仍须保持对话框行为；不能删掉安全断言、跳过失败用例或修改默认工具策略来“适配测试”。保留脱敏日志和最小复现，修复后只重跑受影响专项及必要回归；产品代码变化后再执行完整 `npm run build`。

只有通过 A–D 的 P0 及必要 SDK 回归，才能宣称本轮适配的关键行为已验证。仅本地通过时，结论写明“本地验证通过，真实服务/安装未覆盖”；底部布局、手机焦点尚未实测时，不宣称 Web 体验已验收。

参考：[适配与构建记录](specs/pi-1.4.0-upgrade-plan.md) · [底部面板方案与完成记录](specs/session-inline-interaction-plan.zh-CN.md) · [用户变更说明](pi-v1.4.0-user-changes.zh-CN.md)。
