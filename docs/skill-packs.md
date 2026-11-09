# 工作空间 Packs / Workspace Pack switches

Packs 是工作目录级的启停开关，不是 session 的工具预设。同一实际 `cwd` 的所有会话共享状态；不同目录（包括不同 worktree）独立。创建或打开会话不会继承 Packs 或安装 Skills；已启用 Packs 的 MCP 成员会自动跟随最新定义。旧 `pi-last-session-packs` localStorage 数据被忽略并保留。

## 定义与存储

- 全局定义：`~/.pi/agent/skill-packs.json`，包含名称、描述、Skills 快照 `{ skillKey, contentHash }` 和 `nativeMcpServers: string[]`。
- Skills Library：统一使用 `<libraryRoot>/.pi/skills/<skillKey>/`；默认根目录为 `~/.pivot-ui/lib/skills`。相对根目录以全局配置文件所在目录解析，不重写原始文本。在线安装在临时目录中运行 `npx skills add --agent pi --copy`，仅在临时目录识别 CLI 的 `.agents/skills`／旧 `.pi/skills` 输出，再将实际文件导入库的 `.pi/skills`，结束后清理临时目录。导入拒绝符号链接及同名已有技能，复制失败不留下半成品；批量失败撤回本次新建副本，不覆盖原有技能或 Pack 快照。安装记录按技能合并到库根目录的 `skills-lock.json`，保留无关条目。库的列表、详情、工作区复制和删除只查找 `.pi/skills`，不自动迁移或清理已有 `.agents` 内容。删除仍受 Pack 引用保护，会清理对应安装记录，不删除工作区已有副本。在线安装仅进入库；需在工作区「添加 Skill」或启用 Pack 才加入工作区。
- 工作空间状态：`<cwd>/.pi/skill-packs.json`，保留 revision、启用/停用记录、receipt 及受管理资源名称；旧版记录的 Skills 排除项在下一次显式切换时移除。
- Native MCP 定义仅来自 pi 原生的 `<agentDir>/mcp.json` 和受信任的 `<cwd>/.pi/mcp.json`。Packs 引用已配置的服务器名称，不保存、复制或部署定义。

旧 Library MCP 定义、`configHash`、adapter 文件、OAuth 凭据、migration markers 和备份不自动导入、转换或清理。含旧 MCP 引用且未显式保存 `nativeMcpServers` 的 Pack 不能直接切换；在 Packs 编辑器中选择原生服务器或明确取消 MCP 引用后保存。旧数据仍保留。原生定义可通过 MCP 编辑器显式修改全局／受信任工作区配置；旧 Library/adapter 写接口继续返回 `501 NATIVE_MCP_CONFIGURATION_UNAVAILABLE`。编辑器不部署 Library 定义，工作区 Pack 管理的启用状态仍只能通过 Pack 开关修改。Tools 的 MCP 页仅保留工作区列表／详情，添加／编辑通过弹框进行，新增默认全局且禁用；工作区开关不复制全局凭据。定义保存后通知相关会话在空闲时重载 SDK 资源，运行中的任务延后；全局变更通知全部 wrapper，项目变更仅通知同目录。工具标签页的内建／扩展工具规则独立保存在受信任工作区 `.pi/pivot-tools.json`，不改变 Pack receipt 或旧预设。

## Tools 中的 MCP 分类与管理权

`Pack managed` 由工作区 `appliedPacks` 中的启用 Pack ID 与这些 Pack **最新定义**的 `nativeMcpServers` 并集决定。receipt 的原生引用只记录过去已应用的成员，用于释放旧覆盖，不再授予管理权。删除 Pack 或移除成员后，旧 receipt 不会继续锁住 MCP，也不会在之后切换其他 Pack 时重新接管它。历史 `managedNativeMcpServers`、禁用 Pack 和旧 Library 引用均不参与管理权判定或自动清理。

未启用或已禁用的 Pack 不占用管理权。最后一个引用停用、移除或删除后，移除 Packs 写入且当前仍为 `true` 的工作区 `enabled` 字段；条目因此变空才删除。用户改为 `false` 的值、服务器定义、凭据及其他覆盖字段保留。释放后恢复全局／自身默认启用行为，而不是强制禁用。其他启用 Pack 仍引用该 MCP 时，继续保持 Pack managed。

分类和 MCP 编辑器的启停／删除保护使用同一最新管理关系。项目编辑、Pack 切换与自动同步共用 canonical cwd 锁；项目编辑在锁内先补齐同步再应用用户操作，避免迟到清理覆盖刚保存的开关。Tools 同时订阅全局定义 revision 与工作区 revision。

## MCP 定义变更的自动同步

- Pack 保存或删除后，后台调度已知工作区；按实际 cwd 去重（不同 worktree 独立），仅写入允许访问且受信任的目录。某个目录失败不撤销全局定义，也不阻塞其他目录。
- 离线、未发现或升级前留下旧 receipt 的目录，在工作区激活、会话启动／空闲边界、项目 MCP 编辑时补齐。显式信任后也会调度已有启用关系的同步，不改变 Pack 开关，不复制 Skills。
- 同步比较启用 receipt 的已应用集合与最新定义的目标集合。新增引用经过 SDK 纯配置校验，仅写工作区 `enabled: true`；无效引用记录为待处理，不阻塞其他旧引用释放。修复配置或再次使用工作区时自动重试。纯停用操作也允许保留其他 Pack 中待配置的新引用，不为这些引用创建无效覆盖；首次启用新 Pack 仍要求全部引用有效。
- receipt 与 `nativeMcpSync` 保存已应用成员、相关定义版本和待处理名称。定义版本与实际成员差异都会检查，不能只靠新版 revision。重复同步不增加 revision、不重载资源。
- 配置损坏或读取失败会报错，不当作空 Pack 执行释放。提交前重新检查配置快照及信任；冲突重新计算，提交失败回滚已写文件。历史遗留且不再有启用 receipt 证明的覆盖不做批量清理。
- `GET /api/workspace-skill-packs` 保持只读；激活补齐走 `POST /api/workspace-skill-packs/sync`，不创建 AgentSession。MCP 页与 Pack 开关旁显示同步失败、待配置的服务器，以及运行中会话的待生效状态。

## 工作区信任提示

Tools 窗口与聊天栏 Workspace Packs 选框共用工作区信任提示和显式「信任此工作区」按钮。`GET /api/workspace-trust?cwd=` 只读取 SDK 有效信任状态（已保存决定优先于全局策略），不加载项目资源、不创建会话，也不以 Packs 历史启用记录推断信任。聊天栏每次打开选框都会重新检查；检查中、读取失败或未信任时，Packs 开关禁用，仍保留历史勾选记录供查看。读取失败可刷新重试，旧工作区或已关闭选框的迟到响应不更新当前状态。

只有明确点击信任按钮才 POST 保存决定；随后重新读取状态并刷新界面，Tools 的 MCP 配置也会重新加载。信任不会自动启用／停用或重试切换任何 Pack；它允许补齐已启用 Pack 的最新 MCP 成员，不迁移旧配置。会话资源仍在空闲边界重载。Tools 的全局工具设置不要求工作区信任，工作区设置继续受信任检查保护。

## 启停语义

1. 在 Skills 的 Library / Acquire 中管理库技能，在 Packs 中编辑复用组合。MCP 选择器只返回原生服务器名称、描述、范围和启用状态，不读取旧 Library 定义，也不暴露命令、环境变量或凭据。
2. 聊天输入栏的 Workspace Packs 复选框直接切换当前工作目录；Skills 的 Workspace 页也可预览后启用或停用。
3. 首次启用会复制缺少的 Skills 到 `.pi/skills/`。哈希缺失、过期、同名不同版本冲突、缺少/无效原生服务器或项目不受信任时阻止整个变更，不静默改成纯 Skills。
4. 已有同名 Skills 不覆盖、不接管，记录为 partial；停用不删除它们。
5. 停用保留已安装 Skills，不再添加 `.pi/settings.json` 的 `skills` 禁用排除项。每次显式切换只清除 Pivot 自己记录的旧排除项，清空后移除 `skills` 字段；用户已有设置、技能正文及 frontmatter 不变。因此已安装 Skills 仍按 SDK 正常发现规则加载，不会因 Pack 停用而强制禁用。
6. Native MCP 启用时仅写入当前 `.pi/mcp.json` 的 `enabled: true`。最后一个引用停用后移除 Packs 写入且仍为 `true` 的 `enabled` 覆盖；若条目因此为空则移除条目，全局服务器的启用状态恢复继承全局配置。已有项目定义及其他覆盖字段（command/url/env/auth 等）保留；项目独有服务器回到其自身默认启用行为。不同工作目录不会修改同一份全局定义。
7. 其他已启用 Pack 仍引用同一 MCP 时，继续保留 `enabled: true`；最后一个引用关闭才释放覆盖，而不是强制禁用资源。
8. 删除全局 Pack 定义会自动释放其 MCP 管理权及覆盖。工作空间 Skills 和 receipt 的 Skills 快照仍保留，可之后停用已删除的 Pack；旧 MCP 快照不会恢复管理权。

Skills 的哈希为目录内容的确定性 SHA-256；库内容变化须显式更新引用，不能静默升级。单项库技能安装不创建 Pack receipt，仍属用户独立管理资源。已有用户排除项及 frontmatter 限制保持优先；Packs 不是文件访问权限边界。

## 提交与刷新

- 按 canonical cwd 加锁（Windows key 不区分大小写），revision 过期返回 409。API 先校验允许访问的工作根目录，并拒绝配置/技能目标穿越 symlink。
- Skills 复制、旧项目排除项清理、native enabled 覆盖的写入/释放及 receipt 一起提交。提交前比较原文件快照，失败回滚本次复制和已写文件；外部并发编辑不会被回滚覆盖，冲突明确报错，并继续恢复其他可恢复文件。
- 服务端按目录通知全部活跃 wrapper。空闲会话重载；运行、压缩或存在待处理工作时延后，当前操作结束再重载，下一次 prompt 前等待同一重载 Promise。SDK 重载按 revision 去重。
- 客户端 `useWorkspacePackState` 合并同目录订阅，焦点/每 3 秒读取状态，按需通过独立 POST 补齐，并响应本页变更事件。定义 revision 用于列表刷新，工作区 revision 用于资源重载，避免无关定义变更触发重复重载。会话 hook 更新 `get_commands`；不得在 ChatWindow 增加另一套 SDK reload。
- 新会话第一次发送前补齐已有启用关系的 MCP 差异，没有 Pack 继承或 Skills 准备门禁。同步失败保持可重试，不创建新的 Pack 开关选择。

## 代码与验证

- `lib/workspace-pack-switch.ts`：并集、校验、覆盖释放及回滚，保留 Skills 文件和 native 定义。
- `lib/workspace-pack-mcp-sync.ts` / `workspace-pack-mcp-scheduler.ts`：MCP 差异同步、已知工作区后台调度和自动补齐。
- `lib/workspace-pack-files.ts` / `workspace-pack-access.ts`：canonical key、路径及访问约束、共享原子提交与回滚。
- `lib/native-mcp-config.ts`：复用当前安装的 SDK 原生配置验证器，支持 npm hoist / pnpm；不执行凭据命令。
- `lib/workspace-pack-events.ts` / `lib/rpc-manager.ts`：跨会话通知、安全边界重载。
- `hooks/useWorkspacePackRevision.ts` / `hooks/useAgentSession.ts`：跨页面同步与 slash commands 刷新。
- `lib/skill-pack-apply.ts`、`mcp-pack-apply.ts` 保留底层/历史测试能力，不是新版 API 的删除式停用路径。

```bash
node --test lib/workspace-pack-switch.test.mjs lib/native-mcp-breaking.test.mjs lib/skill-packs-store.test.mjs components/ChatWindow.test.mjs
```

按项目约定在当前工作区运行 `npm run build`（包含类型检查、编译及打包），不额外创建隔离目录、同步产物或重启服务。测试须单独明确授权；以上测试命令不属于默认构建流程。
