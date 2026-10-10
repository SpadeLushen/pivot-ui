# 阶段 D 技术附录

> 面向开发者：保留技术范围、约束与历史实施证据。日常查看进度和待决事项，请读[阶段 D 易读计划](runtime-stage-d-plan.md)。
> 第 2 节是开工前的缺口盘点，第 9 节的首批建议是当时的规划；不代表当前仍未实施。最新开发记录见第 12–17 节，当前验证状态以易读计划为入口。

## 技术计划与记录

状态：**D1／D2／D2b／D3／D4 已实施，当前工作区完整构建通过。D1 普通发送人工验收通过，其余自动化已安排、尚未执行；D2 第 1／3 项人工验收通过，第 2／4／5 项跳过。D2b 界面已确认，实际调用因缺少 API 资源暂未验收，扩展 API 自动发现暂不实现。D3 行为验收待补；D4 字段保留链路静态核对及最小修改完成，实际往返保存验收待补。D5a／D5b 已按顺序实施并构建通过，行为验收待补；D6–D8 未实施，P2 首版范围待确认**。规划、实施与验证安排见第十一至十七节。未提交、推送、发布、改版本或控制服务。

基线：Pivot 1.2.2／pi SDK 1.1.0，阶段 C 已完成实现、构建及授权自动化补测；既有用户验收保留。总范围依据 [升级总计划](pi-1.0.2-upgrade-plan.md) 第 3.2、七、九至十一节、16.2，以及 [1.1.0 增量计划](pi-1.1.0-upgrade-plan.md) 第四节。本计划细化 D，不重开 A／B／C。

## 1. 范围与执行原则

- **D1–D5：P1 核心闭环**。发送回执、typed catalog／认证及类型安全测试、虚拟模型、手写 JSON 采样参数保留（不新增界面）、Theme 与内置扩展管理／诊断。
- **D6–D8：P2 产品增强待办**。Classifier 专用界面、图片生成界面、provider-stream 调试；以下首版范围为建议，需确认后实施，暂缓不等于完成。
- Web 隐藏消息开关只做产品评估，是否实施另行确认；HTML 导出已有开关不是新的 Web 功能。
- 每批独立实现并记录构建、授权测试和人工验收状态，不分批发布。仅工作区构建通过不能标为行为验收通过。
- 不复制 SDK router、分类／生成执行器、OAuth executor 或颜色解析器；不新增凭据迁移、MCP adapter／Library 部署、旧工具预设。
- 不改变现有信任、owner-hidden、权限 hooks、Pack ownership 或运行中延后 reload 规则。Classifier 判断不构成权限边界。

## 2. 现有基础与实际缺口

| 项目 | 已有基础 | D 增量／待确认 |
|---|---|---|
| 发送与队列 | run id、settled、SSE 对账和 SDK 队列 | prompt 返回 null；steer／follow-up 丢弃 SDK disposition；前端先乐观进入运行 |
| 模型目录／认证 | 共用 ModelRuntime，聊天 picker、Provider 登录 | 目录与 API-key Provider 枚举偏向 chat；缺 typed 身份与 classifier-only Provider 闭环 |
| 模型测试／配置 | models.json 整体保存，采样字段已有类型 | 测试按 chat 执行；缺类型安全 dispatch 与非 chat 编辑契约 |
| 虚拟模型 | services 可承接扩展注册模型 | live 只给 model；历史用 context.model，未分 selected／routed |
| 采样参数保留 | samplingParams、按 thinking 覆盖可保留 | 用户不要求专用界面；仅核对手写 JSON 后的界面修改／保存不丢字段 |
| 扩展与 Theme | 原生 factories、MCP replacement 提示、纯文本 Theme | 不重新注入；补通用 Built-in 管理／诊断及完整颜色／style 契约 |
| P2 界面 | C1 图片结果、C4 usage、右面板 registry | 不重复做图片显示／费用账本；独立调用与调试产品范围待确认 |

以上为静态核对，不是新测试证据。已有 Plugins package diagnostics 不等于 SDK services／resource collision diagnostics 全覆盖。

## 3. D1：完整输入 disposition（推荐先做）

**用户价值**：输入被扩展处理、进入队列或真正启动时，界面给出正确状态，不产生幽灵消息或假运行。

范围：
- 定义前后端共享的输入回执：prompt 的 started／queued／handled；steer／follow-up 使用 SDK 实际返回值。错误独立处理，不能伪造 accepted。
- 当前 SDK prompt 仍返回 Promise<void>；使用 SDK 为 RPC 提供的 preflightResult 观察 dispatch，不等待整轮结束才返回 HTTP 回执，也不调用私有 preflight 方法。
- 将“请求发送中”和“模型正在运行”区分；乐观消息只在真实持久消息到达后确认，被 handled／拒绝时回滚或重新加载，不自行写 JSONL。
- handled 不保证没有模型调用：扩展命令可能自行启动 run，以 SSE／状态对账为准，不因收到 handled 强行结束其他 run。
- HTTP 回执、先到 SSE、延迟输入 hook、切会话、取消和旧请求均按 run／请求身份归属，不能复活已结束的状态。
- agent_end 仍非最终结束；维持 agent_settled／aborted、完成音和断线对账口径。保留客户端兼容路径，不把旧 null 回执误判为 handled。

模块：lib/rpc-manager.ts、lib/agent-run-state.ts、lib/agent-client.ts、lib/pi-types.ts；agent/new 与 agent/[id] routes；hooks/useAgentSession.ts、必要的 ChatInput／ChatWindow 与 i18n。

依赖：现有阶段 C 基础；可独立实施，不等待新模型界面。

未来验收：普通发送、slash command／input hook handled、steer／follow-up queued 或 handled、输入失败、快速 SSE／慢 HTTP、断线／取消／旧 run、完成音与真实落盘一致。

非目标：改写整个会话 hook、复制 SDK 队列、重新定义权限、默认允许任意并发 prompt。运行中扩展命令是否开放，应遵守 SDK 规则并单独明确入口。

## 4. D2：typed catalog、Provider 与类型安全测试

**用户价值**：非聊天模型可正确配置、认证和识别，且不会被误当作聊天模型调用。

范围：
- 聊天 picker／默认模型维持 chat-facing 目录；另提供最小 typed catalog DTO，身份为 (type, provider, id)，不直接序列化完整 runtime／Provider 对象。
- Provider 枚举纳入多操作目录／classifier-only Provider，展示支持能力与 SDK 认证状态，不要求 Provider 必须有 chat 模型。
- 配置编辑／保存保留 type、samplingParamsByThinkingLevel、modelOverrides 和未知字段；不要用 chat 字段重建非 chat 定义。
- 模型测试先确认类型。chat 使用聊天执行路径；classifier 使用同一 ModelRuntime.classify()；image 使用 generateImages() 的显式生成入口，涉及收费与保存时不做静默“一键连通性探测”。
- 缺少类型所需输入时提示并阻止执行；在专门输入 UI 未就绪前明确“不支持当前测试入口”，绝不降级为 completeSimple()。
- GPT-6 Luna 的 API-key-only／OAuth 过滤由 SDK 决定；不为可用性自动 logout、交换或合并 openai／openai-codex 凭据。
- 静态目录、配置状态与执行时可用性分开；看目录不试调用模型，不创建 AgentSession／连接 MCP 来“探测”。动态目录刷新与实际调用保留 SDK trust／认证边界。
- 同 ID 不同 type 不互相覆盖；扩展提供全量 Provider catalog 时提示其替代多操作目录的影响。catalog DTO 不泄露 API key、headers、callback URL 或凭据响应。

模块：lib/model-runtime.ts、lib/models-cache.ts、共享 typed DTO；models、auth/all-providers／相关认证列表、models-config 和 models-config/test routes；components/ModelsConfig.tsx。

依赖：独立于 D1，但推荐 D1 后进行；为 D3、D6／D7 提供目录和调用身份。

未来验收：同 ID 三种 type、classifier-only Provider、chat-only picker、未知字段 round-trip、API key／OAuth 有效能力、缺输入阻止调用、非 chat 不走聊天 API、取消／超时及安全错误。

非目标：首轮即做完整 Classifier／图片工作台；自动装配 CLI 专属 llama Provider；新增认证解析器或自动改用户凭据。

### D2b：自定义非 chat 模型创建与持久化加载（用户已要求立即实施）

- 自定义 Provider 的模型详情可选择 chat／classifier／image，按类型提供 API、输入模态、Classifier context window、image 输出模态；同 Provider 同 ID 不同 type 可共存，同 type 重复 ID 拒绝。
- 保留 models.json 的 chat／Provider 配置及未知键；非 chat 定义保存于同目录 pivot-models.json（version:1），GET 合并给现有表单。只有用户 Save 才分流已有非 chat 定义，不自动改写配置／凭据；CLI 原生 models.json 不新增 typed 语义。
- 非 chat 统一通过 SDK registerProvider 与公开 lazy API 实现加载。首版支持 SDK 已知 classifier API 和 openrouter-images；不复制协议，不加载任意客户端代码或自动装配 llama Provider。
- 共用加载路径覆盖目录、认证 metadata、draft 测试、服务装配与闲时 reload。保护扩展已注册 Provider，遇到名字冲突明确拒绝而非替换其实现。删除／改名／改类型不留下自有旧注册。
- 保存先校验，再在共享文件锁内原子替换两份配置、失败回滚；读取不把损坏配置当空配置。保存通知现有资源 revision，活跃运行延后 reload；image 仍不在 Test 中生成。
- 不扩大到 D6／D7 工作台。实现后只执行工作区 npm run build，行为／真实账户验收另记。

未来验收：三类型新建、同 ID 三 type、类型 API 不匹配拒绝、保存／重新打开／进程重建后目录一致、非 chat 不进聊天 picker、分类实际调用／取消、删除／改名及闲时应用、字段保留、文件损坏与写入失败保护。

## 5. D3：virtual selected／routed model

**用户价值**：用户一直选着 router，同时知道本轮实际用了哪个模型；历史恢复不悄悄换成 physical model。

范围：
- selectedModel 与 routedModel 分开。前者表示用户选择，后者表示最近一次成功响应的实际模型及 thinking；失败／取消不伪造新的成功 routed 值。
- picker 标记 virtual；thinking 采用其声明档位。上下文／maxTokens 未知时显示未知，不按 0 当作真实容量或随便填默认值。
- 保留 assistant 的实际 provider／model／thinking 和 pi.virtual-model-state；内部状态 entries 不转成聊天消息、不重写旧会话。
- 历史 selected 读取是开工前技术决议：当前 getBranchSelection helper 不在 SDK 顶层导出，不能靠内部深导入解决。依据公开 API、导出 metadata 类型与分支 entries 做只读适配，并明确 catalog 未知／router 已移除时的不同处理。
- 历史浏览和统计不为恢复选择创建 AgentSession。live 用公开 inner.model／routedModel，分支切换、reload、Fork 与恢复遵守同一语义。
- 费用按实际记录归属，router 分类调用也保留自身 usage；沿用 C4 父 usage 聚合，不把 nested 费用再相加。无法获得实际模型拆分的聚合 usage 明示未归属，不把全部费用归 router，也不按当前价格重算。
- 实际模型费用分组是 C4 之上的视图增量，完整／分支累计和当前上下文口径不变。

模块：lib/session-reader.ts、lib/types.ts、lib/pi-types.ts、lib/rpc-manager.ts；会话 context／模型 routes；hooks/useAgentSession.ts、ChatInput 和统计视图；必要的 session-usage／statistics 归属字段。

依赖：D2 typed catalog；可使用现有扩展 router，无需图形化编辑器。

未来验收：连续路由不同模型、刷新／reload／resume／Fork／分支切换／compaction、router 移除或目录暂不可知、路由失败／取消、未知容量、实际模型费用及 classifier usage 不重复计费。

非目标：图形化 router 编辑器、自建路由框架、重新定价。

## 6. D4：手写 JSON 采样参数保留（不新增界面）

**用户决议**：采样参数只手改 JSON，不开发专用采样编辑界面；D4 仅保证随后通过 Models 界面修改其他配置并保存时，不丢失这些参数。

范围：
- 原样保留 model samplingParams、samplingParamsByThinkingLevel，以及 provider.modelOverrides 对应字段；修改模型名称、API、容量、费用或 Provider 配置不过滤这些字段。
- 保留未知采样键、thinking 档位覆盖及嵌套值；0、false、null 与缺字段不互相转换，不把参数去重为继承或补默认值。
- 读取、表单暂存、模型／Provider 改名与最终 JSON 保存保持未编辑字段；非 chat 配置分流同样不得丢弃模型上的采样字段。
- 手改文件后需重新打开／加载 Models，再修改并保存。本范围不承诺已打开表单与后续外部文件修改的并发合并。

模块：components/ModelsConfig.tsx、models-config route、lib/model-config-store.ts／typed-model-config.ts；必要时只修复字段保留链路。

现状：D4 已实施并构建通过，详见第十六节。模型／Provider 局部编辑、GET／保存与 chat／非 chat 分流保留完整对象；共用采样字段类型允许 null、未知键和未来 thinking 档位，打开 Provider 详情不再自动补写 API。静态核对不等同于实际往返保存验收，后者待补。既有采样兼容证据见总升级计划，不重复新增产品能力。

未来验收：手写基础／按 thinking 参数和 modelOverrides，重新打开界面修改无关配置并保存，对比字段和值（含 0、false、null、未知键）仍在。仅在用户明确要求后执行测试。

非目标：专用采样控件、高级 JSON 编辑器、有效参数展示、新增每次发送的采样控制、自建采样 schema。


## 7. D5：Theme bridge 与内置扩展管理／诊断

可拆为两个独立子批，不把 Theme 改造当成 Built-in 管理的前置任务。

### D5a：完整纯文本 Theme 契约

- 支持 style()、colors、appearance 与有效的完整 token；纯文本方法不产生 ANSI，颜色计算不再依赖空字符串。
- 颜色解析与新格式交给 SDK；Pivot 保持 CSS variables，不移植终端 palette。
- 明确 appearance 来源与 bridge 实例归属，不因某浏览器主题请求反复修改进程全局 Theme；不把所有 TUI renderer 转成 React renderer。

模块：lib/rpc-manager.ts 的 PlainTextTheme，可抽为独立 helper；必要的 extension UI types／适配。

未来验收：新旧颜色 API、style 与 custom UI 交互、ANSI 不泄漏、多个浏览器／会话主题互不污染、reload 后行为一致。

### D5b：Built-in 管理与诊断

- 核对已有 named／replaceable factory 和 SDK replacement diagnostics，不重新注入 MCP／codemode／tool_search。
- Plugins 增加独立 Built-in 区域；开关操作 SDK extensions 设置，不伪装 npm package、不复用清空 package resources 的逻辑。
- 表达 configured、实际加载、第三方替代、碰撞／错误及待 idle reload；builtin:<name> 是合成来源，不作为磁盘文件链接。
- 用户显式禁用不得被默认工具策略重新启用；新建、恢复、reload 统一装配。Tools／Packs 维持已有信任与当前 ownership。
- 只读诊断使用已有 runtime 诊断或安全只读结果；无数据标为未知，不为打开面板启动 AgentSession、服务器或 OAuth。project 编辑仍需 trust，保存复用锁与 revision／延后应用规则。

模块：lib/model-runtime.ts、lib/native-mcp-runtime.ts、lib/rpc-manager.ts；plugins／相关诊断 routes；components/PluginsConfig.tsx、必要的 Tools 能力状态与 i18n。

未来验收：-builtin 禁用、第三方替代、resource collision、无会话只读诊断、不同 cwd／trust、活跃 run 延后／reload 失败、重新启用后命令／工具／Provider 一致。

非目标：自动禁用替代插件、重做 package manager、恢复 MCP migration。

## 8. P2 建议批次：需确认首版产品范围

P2 仍在总计划待办中，不把“暂缓／未决定”标为已完成；D1–D5 不依赖这些工作台。

### D6：Classifier 专用界面

建议首版放在 ModelsConfig 的 typed 模型测试／详情内，先满足模型选择、所需文本／图片输入、类别定义、执行／取消、结果与 usage；不先做独立大型工作台。

- 使用 ModelRuntime.classify()，按 SDK 的不同 classifier 输入契约验证；不假定所有模型都接受同一种 labels schema。
- 显示可获得的分类／置信度／耗时／记录费用；没有的值不补造。输入／结果与费用归属范围明确。
- 未关联会话的测试费用不混入会话 C4 账本；codemode／router 已记录的 usage 沿 SDK 聚合读取。
- 图片分类复用安全附件／图片展示能力；不能把分类结果作为自动允许工具或 workspace trust 的依据。

依赖：D2。模块：ModelsConfig／可拆 classifier 测试组件、typed 测试 route、共享调用校验。

未来验收：classifier-only Provider、图片／文本输入、不同 schema、认证不可用、取消／超时、输出错误、usage 缺失／0；fixture 与真实账户证据分开。

### D7：图片生成右面板工具

建议首版为单次生成：typed 模型、必要输入、执行状态、取消／超时、多图结果、明确保存／下载动作及本次记录费用。

- 使用 ModelRuntime.generateImages()；通过 right-panel registry 添加工具，不在 AppShell 写 image 分支。
- 调用为显式用户动作；展示可能收费及 SDK 记录 usage，不承诺可预估费用。失败／取消后的部分结果与费用不自动抹除。
- 复用附件限制、MIME／图片来源校验；保存位置、命名、覆盖、清理和未保存结果寿命须在实施前确定，不开放任意文件路径写入。
- 首轮不做画布、批量任务、历史作品库、图像编辑流水线或独立全局费用数据库。未关联会话的调用不制造 session usage entry。

依赖：D2；复用 C1 图片能力。模块：新增 right-panel 图片工具、registry、显式生成／取消 routes 与最小任务所有权 helper，必要的安全保存接口。

未来验收：模型类型、收费提示、多图／部分失败、取消／超时／切工作区／关闭面板、保存失败和路径限制、图片字节上限、usage 不重复计费。取消代表请求取消，不保证 Provider 不计费。

### D8：provider-stream 诊断（优先级最后）

建议先核对现有 debug extension 能提供什么，再决定首版是否需要独立面板。

- provider_stream_event 是 extension notification，不假定普通 AgentSession SSE 已提供原始 payload。
- 默认关闭、显式开启；服务端先做 allowlist 脱敏，只允许事件类型、时间、计数等必要 metadata，不把原始 Provider payload／完整文本／图片 base64／headers／token／callback URL 直接发前端。
- 限制 event 数、单 event bytes 和总 bytes，环形缓冲／批量刷新；关闭即退订并清理，慢 handler 不阻塞流消费。
- 不默认持久化、记录日志或导出；如后续需更详细内容或报告，应另行设计敏感信息边界。

依赖：D5 诊断／扩展入口，D1 run 归属。模块：debug notification bridge、受限订阅 API／缓冲 helper、诊断组件；不得无条件透传至所有聊天 SSE。

未来验收：默认无订阅／数据、开启关闭与 run／cwd 隔离、敏感字段不下发、容量上限／截断、退订、慢客户端／高频事件与正常聊天互不干扰。

### Web 隐藏消息开关：评估项

建议暂不纳入首轮 D 实现。若确认需要，只控制持久消息 display:false 的只读可见性，不改变 SDK 模型上下文、落盘、统计或分支；不展示内部 virtual state／账本 metadata。与 HTML exporter 的 H 开关区分，保留深树迭代补丁，实际导出回归仍是独立验收事项。

## 9. 推荐顺序与阶段门槛

**D1 → D2 → D3 → D4 → D5；确认 P2 范围后 D6 → D7 → D8。** D4 与 D5 可在 D2 后独立安排；D5a／D5b 可分别实现，不必把全部 D 变成一个大 patch。

第一批建议仅授权 **D1 完整输入回执**：
1. 先确定 DTO／错误／请求归属契约。
2. 再接 wrapper 和 new／existing session API。
3. 最后消费回执，调整乐观消息／运行状态／队列 UI。
4. 只做必要结构拆分，保持 SSE、commands、AgentRunState 协作，不同时动模型产品界面。

每批状态分开记录：
- 规划确认；
- 实现＋当前工作区 npm run build（命令自带编译／打包，不另建隔离目录）；
- 用户另行授权后的自动化／SDK／浏览器验证；
- 对应人工验收与剩余边界。

本计划列出的未来验收场景不代表已经创建测试，也不构成执行测试的授权。既有阶段 C 578 项回归是此前基线证据，不是 D 的验证结果。

## 10. 与 D 开发分离的最终验收／交付清单

以下继续保留，不塞进 D 开发批次、不用 fixture 或 build 替代：
- 真实 OpenAI／Codex／Anthropic 等账户登录、刷新、取消及原有凭据保留。
- 真实 classifier／image Provider 账户与计费语义；第三方 MCP OAuth／调用／断连与资源生命周期。
- 1.1.0 完整 Output、终态／重连／完成音、深会话 HTML 导出、历史会话和生产整应用浏览器专项。
- Windows PTY／ACL 与跳过用例；真实工作区文件、Git、Terminal／Packs 集成。
- npm／pnpm consumer 安装、runtime aliases／worker／WASM、发布包启动及匹配运行进程。
- 最终获授权的完整回归、安装／部署与服务控制；不自动部署、重启、改版本、提交或发布。

## 11. 本轮规划记录

静态核对现有 rpc-manager、agent-client／routes、session-reader、ModelRuntime、ModelsConfig、模型／认证／配置 routes、Plugins diagnostics 与 right-panel registry，并对照安装的 SDK 1.1.0 公共类型／prompt dispatch 实现。

结论：已有原生装配、工具规则、费用和图片显示不重复开发；发送回执与 typed model 闭环是优先缺口；虚拟模型历史解析、Built-in 设置写入和 P2 产品边界仍须在对应批次开工前落实。初次规划轮仅写计划文档及总计划链接，未做产品实现或新的运行验收。

## 12. D1 实施记录

用户随后明确要求实施 D1。已完成实现，未扩大至 D2 或 P2：
- 共享 InputReceipt／InputDisposition；wrapper 使用 SDK preflightResult 回复 prompt dispatch，HTTP 不等待模型整轮结束；steer／follow-up 保留 SDK queued／handled，统一 source:rpc。现有 new／existing routes 原样转发 data，无需改变 HTTP envelope。
- 普通并发 prompt 仍拒绝；只有明确 streamingBehavior 且 SDK 正在 streaming 才允许运行中 prompt／slash command dispatch。排队请求不清除原运行的 promptRunning／启动计时器。
- AgentRunState 区分预留 dispatch 与已启动运行；前端独立 Sending 状态，不在请求前制造聊天用户气泡，直接采用 SDK message_end 的真实／转换后输入。handled 不强行结束扩展启动的 run，终态仍以 settled／对账为准。
- 请求 ID、卸载 epoch、run id、事件 revision 和队列 revision 防护迟到回执／快照；兼容旧 null 回执为未知，不猜测 handled。关闭 wrapper 时拒绝尚未确认的 prompt，SDK deferred dispatch 等待真实回调。
- 普通及队列发送失败保留输入并显示错误；等待期间新增文本／附件不被回执清除。新会话晋升通过 composer draft 交接保留新编辑，统一 ChatInputHandle 类型，避免重复接口漂移。未知 preflight 状态保留恢复轮询，未启动输入不触发完成通知／音效。
- 当前工作区最终 npm run build 成功，包含 compiler guard、typecheck、Next build 与自带 npm pack；Pivot 保持 1.2.2，13 条既有 Turbopack 警告未屏蔽。首轮构建已通过，补齐快照／draft 边界后重建曾发现重复 ChatInputHandle 缺字段的类型错误；统一类型后最终重建成功。日志 /tmp/pivot-d1-build.log、/tmp/pivot-d1-final-build.log（Windows 对应用户 Temp）。
- 未创建、修改或执行测试／fixture，未运行 lint、浏览器或真实账户验收。上述内容为实现和静态核对，不把构建视为第三节未来验收场景已通过；阶段 C 的旧回归不作为 D1 证据。
- 保留实施期间出现的 components/ChatPackSelector.tsx 并行改动，本轮未编辑该文件；最终构建反映当前工作区，不能声称仅由 D1 组成。未提交、推送、部署、改版本、备份／同步或停止／重启服务。
- 后续用户确认普通发送人工验收通过，其余场景人工较困难，要求安排自动化测试；记录为已安排、尚未执行，见第十四节。

## 13. D2 实施记录

用户明确要求实施 D2，本轮未启动 D3／D6／D7：
- /api/models 保持既有 chat modelList／默认模型／thinking 契约，另提供最小 typedCatalog，身份为 (type, provider, id)，只白名单输出名称、输入模态、类型与配置／可用性 metadata。未知非 chat 可用性标为 unknown，不把 Provider configured 等同于模型可用，不解析请求 headers／刷新 OAuth 来展示目录。
- Provider 枚举不再依赖 chat models，涵盖 classifier-only Provider；API-key／OAuth 列表及 API-key 状态包含按类型计数，凭据枚举使用 SDK 非秘密 metadata。Models 显示只读 typed 目录及类型分组，不自动转换或注销 openai／openai-codex 凭据。
- 配置编辑用局部 spread 保留 type、output、采样／thinking overrides 和未知键；未知 API 字符串仍可显示、不因下拉框不认识而被删除。非 chat 不显示 chat reasoning／maxTokens 编辑，图片输入修改保留已有模态。
- SDK 1.1.0 的 models.json 自定义构造仍为 chat-only（provider-composer modelFromJson 静态源码确认）。显式非 chat 定义存储原样保留，但不宣称其运行时 native 加载已支持；从聊天 picker 排除 SDK 误构造的条目并提示使用 typed Provider 扩展。无 SDK 补丁、配置迁移或自动重写。
- 模型测试提供 draft／catalog 两条来源，通过 SDK getModelOfType／getAvailableOfType 校验类型与认证过滤，再分别调用同一 ModelRuntime.completeSimple／classify。Classifier 草稿仅在独立临时 runtime 中以 SDK typed Provider 注册，不经过 models.json 的 chat 构造；catalog 可读取已有服务装配的扩展目录，不创建 AgentSession 或连接 MCP。
- Classifier 要求显式 state／questions JSON，先校验再调用；图片分类输入暂不支持。image 测试返回明确 unsupported 且不执行任何模型请求，显式生成流程仍归 D7。未知类型、缺输入及已知非 chat API 误标 chat 的草稿被阻止；已注册 catalog 的同 API／同 ID 多类型不混用。
- 20 秒超时与 request signal 覆盖 runtime／认证／请求；前端 Cancel、切模型／关闭后的 abort 与迟到结果隔离。返回有界文本、数值 usage／记录 cost；Provider 错误不返回原始 body、headers、tokens 或回调 URL，不写 session usage 账本。
- 最终工作区 npm run build 通过（含自带 typecheck／Next／pack），Pivot 仍为 1.2.2，13 条既有 Turbopack 警告保留。静态复查补齐 API-key 状态计数及 typed API 防误用后按约定重建；最终日志 /tmp/pivot-d2-final-build.log。
- 未创建／修改／运行测试或 fixtures，未运行 lint、浏览器或真实模型调用；构建不是真实账户／行为验收。保留已有 D1 和 ChatPackSelector／SessionSidebar 并行改动，未编辑后两者。未提交、推送、发布、部署、改版本或控制服务。

### D2 用户人工验收反馈

用户确认：第 1 项 Provider／目录及第 3 项现有 chat 模型测试通过；第 2 项因没有非 chat 模型跳过，第 4、5 项跳过。不据此认定非 chat 隔离、Classifier／image、配置字段保留或全部取消竞态已验收。用户指出自定义 Provider 尚不能在设置界面添加非 chat 模型：D2 当前只有 typed 目录、字段保留和类型安全测试，创建及持久化运行时加载尚未闭环；D6／D7 的执行界面不等同于该配置能力，需另明确补充范围。

### D2b 实施记录

用户要求增加补充批次并立即实施，范围见第四节 D2b。
- Models 自定义模型详情新增可编辑类型、分类／图片 API 下拉、模型 Base URL 覆盖、图片输出模态；已有 chat 下拉及未知 API 值保留。类型切换保留其他字段；服务器按 (Provider,type,id) 拒绝同类型重复 ID。Provider 改名拒绝覆盖已有名称。修正环境变量密钥语法提示为 $NAME／${NAME}。
- lib/typed-model-config.ts 共用已知 API 与校验；非 chat 需显式支持的 API 和 HTTP(S) Base URL。旧定义缺 type 按 chat 兼容；新增已知非 chat API 不能误用于 chat。
- lib/model-config-store.ts 在 models.json 同级持久化 pivot-models.json（version:1，仅非 chat models）；Provider 连接／认证配置、chat 模型与根未知字段仍在 models.json。GET 合并两者供表单使用，未知模型键原样保留。只有显式 Save 分流旧 models.json 的非 chat 条目；运行时遇到尚未分流的条目明确拒绝，避免 SDK 误构造成 chat。
- 读取拒绝损坏结构／未知存储版本，不返回空配置掩盖错误。保存用共享 models.json.lock、0600 临时文件与原子 rename；两次文件替换失败时回滚，回滚失败另报。此为进程内受锁读取的一致性，不宣称两个文件具有断电／进程崩溃事务原子性，也未进行 Windows ACL 验收。
- lib/typed-model-runtime.ts 用 SDK registerProvider 保留原生 chat／非 chat 目录并按类型 upsert，自定义 classifier 使用四种已知公开 lazy API，image 使用 openrouter-images。SDK 负责认证优先级、headers／命令解析、OAuth 能力过滤、协议、usage 与调用取消；不复制执行器、不自动交换凭据。
- 目录／认证、draft 测试及 AgentSession services 共用加载器。注册追踪在 globalThis WeakMap 中保留，支持 Next 热重载；清除只触及自有注册，扩展占用相同 Provider 时拒绝并提示另用名称，不注销扩展。目录显示安全配置错误，不返回 SDK 原始错误体。
- Save 通知资源 revision；RPC 沿既有闲时队列重载，在 beforeSessionStart 明确等待 typed 加载，session_start hook 覆盖 SDK 自身 reload。活跃运行不被本轮设置直接替换。新建进程重新从两份文件读取，但实际重启恢复仍待验收。
- Classifier 草稿测试使用同一分流／加载路径；编辑输入取消过期测试。image Test 仍禁用且服务器返回 unsupported，不扩大到 D6／D7。
- 首轮完整构建发现校验器 never 函数的类型收窄及混合模型 Map 推断错误，修正而未放宽校验。最终 npm run build 通过（compiler guard、typecheck、Next、自带 pack），日志 /tmp/pivot-d2b-final-build.log；Pivot 仍为 1.2.2。
- 未新增、修改或运行测试／fixtures、lint、浏览器、真实模型调用或 consumer 安装验收。保留 D1／D2 及 ChatPackSelector／SessionSidebar 并行改动，未提交、推送、发布、部署、备份／同步、改版本或控制服务。本记录是实现与构建证据，不是 D2b 行为验收。

D2b 验收状态：界面已确认；实际调用因缺少 API 资源暂未验收。扩展自定义 API 自动发现／下拉选择暂不实现。

## 14. 后续自动化安排（尚未执行）

**D1：用户已要求安排自动化，不再记为待授权。** 本轮执行 D2 开发，不创建或运行这些用例：
- SDK 普通 prompt started、命令／input hook handled、扩展自行发起 run。
- Steer／follow-up queued／handled、运行中 slash command、转换后文本、真实送达／撤回队列、不重复用户消息。
- 输入拒绝、取消、网络／HTTP 回执未知、未启动不播放完成音、settled 后才结束。
- 快速 SSE／迟到 HTTP、旧 run／切会话、空闲快照与启动竞态、null 旧服务器兼容。
- 新会话晋升及发送期间新文本／附件、扩展编辑器改写、失败保留输入与 Pack 延后 reload。

D2 后续验证候选矩阵：同 ID 多 type、classifier-only 认证／目录、chat-only picker、未知配置字段 round-trip；catalog 与 draft 类型校验、Classifier JSON／图片未支持错误、image 不调用、SDK OAuth 过滤／凭据不改写、取消／超时／迟到 UI、零／缺失 usage 与安全错误。D2 测试执行仍需用户明确要求；不得用阶段 C 回归或 D2 构建将该矩阵标为通过。真实账户、第三方 MCP、Windows 与交付仍归第十节独立验收。

## 15. D3 实施记录

用户明确要求实施 D3，未启动 D4–D8：
- 新增 lib/session-models.ts／response-model.ts，统一 selectedModel、routedModel、legacyModel 与 picker metadata。assistant 类型保留实际 api／provider／model／thinkingLevel；normalize 与历史投影不删除这些字段。
- 历史 context 使用公开 SDK context API 加全祖先路径只读适配，包含 compaction 前的 model_change／成功响应；使用顶层导出的 VirtualModelStateData／VIRTUAL_MODEL_STATE_ENTRY，不深导入 getBranchSelection。SDK 内部 custom 状态不转成聊天消息、不写回旧文件、不为历史／统计创建 AgentSession。
- 历史 choice 保留最新 model_change；已知目录中 virtual 选择保持 router，普通模型／已移除 router 使用 SDK 物理回退。目录未知时保留记录并提示，不把未知当作已移除。legacyModel 只用于兼容回退，与“最近成功响应”的 routedModel 分开。
- Live get_state 使用公开 inner.model／routedModel；SDK 无当前 routed 快照时仅回读分支中实际成功记录。SSE 只在成功 message_end 更新 routed；error／aborted 不覆盖。恢复、settled／对账、reload／Pack reload、分支切换同步模型；请求受 session／run／事件与分支 revision 保护，Fork 沿用 SDK 销毁旧 wrapper 的既有约定。
- /api/models 的 picker／typed 目录标记 virtual，thinking 沿用 SDK 声明档位；非正／缺失 contextWindow、maxTokens 为 null。ChatInput 分开显示选择与最近成功实际模型／thinking，未知容量显示未知，不补默认容量。
- C4 账本新增 actual-model 分组：assistant 按实际响应身份、独立 usage 按记录 provider／model 归属；工具及 summary 聚合无法拆分时标未归属。保留完整／分支和当前上下文口径，不重新定价、不重复加入 nested usage。统计面板显示该分组与缺失费用说明。
- 当前工作区 npm run build 最终通过，包含自带 typecheck／Next／pack；首轮类型推断错误已修正，未放宽校验。日志 /tmp/pivot-d3-build.log；Pivot 保持 1.2.2，13 条既有 Turbopack 警告保留。
- 未新增／修改／运行测试、fixtures、lint 或真实模型／浏览器验收。连续不同路由、取消／失败、未知容量、router 移除、刷新／resume／reload／Fork／分支／compaction、Classifier usage／聚合费用归属仍待行为验收；不把构建或阶段 C 回归视为通过。
- 保留 D1／D2／D2b 和 ChatPackSelector／SessionSidebar 并行改动，本轮未编辑后两者。未提交、推送、发布、部署、改版本、额外打包、备份／同步或控制服务。

## 16. D4 实施记录

用户明确要求实施 D4，未启动 D5–D8，不新增采样编辑界面：
- 静态追踪 models-config GET → Models 表单 → PUT → 双文件保存。已有读取保留对象，模型／Provider 字段和费用编辑使用局部 spread，Provider 改名搬移完整对象；samplingParams、samplingParamsByThinkingLevel、modelOverrides 不经过白名单重建、去重或默认值合并。
- lib/typed-model-config.ts 新增共用 SavedSamplingFields，ModelsConfig 复用：明确保留 null、未知采样键、嵌套值及未来 thinking 档位；Provider modelOverrides 保持不透明并允许 null。不新增采样 schema 或运行时采样归一化。
- 移除 ProviderDetail 挂载时自动补写 API 的 effect；缺失 API 显示现有 inherit／none 选项，只在用户编辑时改变。新建 Provider 的原有显式默认值不变。
- chat／非 chat 分流继续使用完整模型对象，采样字段随模型进入 models.json 或 pivot-models.json；Provider modelOverrides 保留在 models.json。既有文件锁、损坏配置拒绝及失败回滚保持不变；手改文件须重新打开 Models，不承诺外部修改的并发合并。
- 当前工作区 npm run build 通过，包含命令自带 compiler guard、typecheck、Next 和 npm pack；日志 /tmp/pivot-d4-build.log，Pivot 保持 1.2.2，13 条既有 Turbopack 警告保留。
- 未新增／修改／运行测试、fixtures、lint、浏览器或真实模型调用。含 0、false、null、未知键的实际往返保存仍待用户明确授权后验收，不以类型声明、静态核对或 build 代替行为证据。
- 保留当前工作区已有并行改动，仅修改 ModelsConfig、typed-model-config 和阶段文档。未提交、推送、发布、部署、改版本、额外打包、备份／同步或控制服务。


## 17. D5a／D5b 实施记录

用户明确要求按 D5a → D5b 顺序实施，未启动 D6–D8：
- D5a：新增 lib/plain-text-theme.ts，完整覆盖 SDK ThemeColor／ThemeBg（有编译期覆盖检查）。使用 SDK Theme 解析具体色值，继承 colors／appearance／getColorMode；覆盖 style、fg／bg、文字属性与 ANSI getter，格式化不产生 ANSI。每个 wrapper 独立持有 bridge；固定中性深色契约仅供插件颜色运算，浏览器仍用 CSS，不把浏览器主题写入进程全局。
- 旧 SDK 全局主题兼容初始化改为进程内一次、无 watcher；不改主题配置，不深导入颜色解析器，不转换所有 TUI renderer。statusline／custom UI／ctx.ui.theme 共用该 wrapper 的桥接实例。
- D5b：新增 /api/plugins/builtins GET／PATCH、builtin-extension-settings／snapshot／types 及 BuiltinExtensions 组件；Plugins 顶部增加独立可展开 Built-in 区域，仅列 Pivot 已供应的 mcp、codemode、tool-search，不额外装配 llama.cpp，不改变 npm package 启停实现。
- 开关使用原生 settings.json extensions 的 +builtin:<name>／-builtin:<name>；SDK DefaultPackageManager 只解析捕获的 extensions 设置，解释全局和可信项目覆盖（含现存 glob），不评估扩展、不安装包、不连接 MCP／OAuth。保留其他资源项、未知设置与文件格式。
- 写入使用允许的规范工作区、共享 workspace lock 与 SDK 兼容 settings.json.lock、revision compare 和原子替换。项目保存需既有信任，全局修改不授予信任；全局通知所有 wrapper，项目仅通知同 cwd。复用现有空闲重载队列和失败后重试，不替换运行中的 loadout。
- 诊断只读取明确选中的存活 wrapper；无会话或正在绑定时标未知。分开展示 configured、loaded、第三方替代、加载错误／碰撞与 application 的 applied／pending／applying／failed。技能／提示词／主题碰撞来源以纯文本展示；builtin:<name> 不生成文件链接。任意扩展原始错误不下发，SDK replacement warning 有界输出。最多 100 条诊断。
- 初始服务、wrapper reload 及扩展自行触发的 session_start／reload 更新 MCP 缓存诊断；不重复注入原生扩展，不自动禁用第三方替代插件，不改变 Tools／Packs ownership、owner-hidden 或权限 hooks。
- 当前工作区两轮 npm run build 均通过；最终日志 /tmp/pivot-d5-final-build.log，包含 compiler guard、typecheck、Next 与自带 pack。Pivot 保持 1.2.2，13 条既有 Turbopack 警告保留。
- 未新增／修改／运行测试、fixtures、lint、浏览器或真实服务调用。主题新旧接口、custom UI、多个浏览器／会话、禁用／替代／碰撞、信任／作用域、运行中延后应用／失败重试仍待行为验收。仅构建不视为这些场景已通过。
- 保留已有并行修改，包括实施期间出现的 ToolResultContent 改动，本轮未编辑该文件；未提交、推送、发布、部署、改版本、额外打包、备份／同步或控制服务。

### D5b 界面布局调整

用户随后要求将 Plugins 整体改成 Installed／Built-in 两个标签页。默认打开 Installed，已安装插件列表、安装输入、详情和原操作保留；Built-in 独占内容区，不再是顶部折叠块或 240px 高度列表。两个面板保持挂载，切换不丢安装输入及 Built-in 范围选择；Built-in 不可见时暂停轮询和信任检查，打开后重新读取。标签支持方向键／Home／End 和 tab／tabpanel 关联。此调整不改变 API、信任、设置作用域或重载规则；当前工作区 npm run build 通过（含自带编译／打包，日志 /tmp/pivot-plugins-tabs-build.log），13 条既有 Turbopack 警告保留。未运行测试或浏览器验收，行为验收仍待补。

随后按用户要求统一视觉布局：Plugins 引用 ToolsConfig.module.css；Installed 使用 tools-layout 的 14px 18px 留白、14px 列表／详情间距及 210px 圆角列表。Built-in 使用同一列表、详情、紧凑滑动开关、运行状态字段与页脚控件样式，范围选择移到页脚，并明确开关即时保存；后台 API、信任、诊断、作用域及隐藏时暂停轮询不变。首轮构建发现诊断 details 条件 JSX 缺少闭合括号，修正后当前工作区 npm run build 通过，日志 /tmp/pivot-plugins-layout-final-build.log；13 条既有 Turbopack 警告保留。未运行测试或浏览器视觉验收，未重启服务。
