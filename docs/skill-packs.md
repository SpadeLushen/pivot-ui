# 工作空间 Packs / Workspace Pack switches

Packs 是工作目录级的启停开关，不是 session 的工具预设。同一实际 `cwd` 的所有会话共享状态；不同目录（包括不同 worktree）独立。创建或打开会话不会继承、安装或改变 Packs，旧 `pi-last-session-packs` localStorage 数据被忽略并保留。

## 定义与存储

- 全局定义：`~/.pi/agent/skill-packs.json`，包含名称、描述、Skills 快照 `{ skillKey, contentHash }` 和 `nativeMcpServers: string[]`。
- Skills Library：`<libraryRoot>/.pi/skills/<skillKey>/`；默认根目录为 `~/.pivot-ui/lib/skills`。相对根目录以全局配置文件所在目录解析，不重写原始文本。
- 工作空间状态：`<cwd>/.pi/skill-packs.json`，保留 revision、启用/停用记录、receipt、受管理资源名称及本次生成的 Skills 排除项。
- Native MCP 定义仅来自 pi 原生的 `<agentDir>/mcp.json` 和受信任的 `<cwd>/.pi/mcp.json`。Packs 引用已配置的服务器名称，不保存、复制或部署定义。

旧 Library MCP 定义、`configHash`、adapter 文件、OAuth 凭据、migration markers 和备份不自动导入、转换或清理。含旧 MCP 引用且未显式保存 `nativeMcpServers` 的 Pack 不能直接切换；在 Packs 编辑器中选择原生服务器或明确取消 MCP 引用后保存。旧数据仍保留。原生定义可通过 MCP 编辑器显式修改全局／受信任工作区配置；旧 Library/adapter 写接口继续返回 `501 NATIVE_MCP_CONFIGURATION_UNAVAILABLE`。编辑器不部署 Library 定义，工作区 Pack 管理的启用状态仍只能通过 Pack 开关修改。Tools 的 MCP 页仅保留工作区列表／详情，添加／编辑通过弹框进行，新增默认全局且禁用；工作区开关不复制全局凭据。定义保存后通知相关会话在空闲时重载 SDK 资源，运行中的任务延后；全局变更通知全部 wrapper，项目变更仅通知同目录。工具标签页的内建／扩展工具规则独立保存在受信任工作区 `.pi/pivot-tools.json`，不改变 Pack receipt 或旧预设。

## 启停语义

1. 在 Skills 的 Library / Acquire 中管理库技能，在 Packs 中编辑复用组合。MCP 选择器只返回原生服务器名称、描述、范围和启用状态，不读取旧 Library 定义，也不暴露命令、环境变量或凭据。
2. 聊天输入栏的 Workspace Packs 复选框直接切换当前工作目录；Skills 的 Workspace 页也可预览后启用或停用。
3. 首次启用会复制缺少的 Skills 到 `.pi/skills/`。哈希缺失、过期、同名不同版本冲突、缺少/无效原生服务器或项目不受信任时阻止整个变更，不静默改成纯 Skills。
4. 已有同名 Skills 不覆盖、不接管，记录为 partial；停用不删除它们。
5. 停用保留已安装 Skills，使用项目 `.pi/settings.json` 的 `skills` 排除项 `-skills/<key>` 停止 SDK 发现。重新启用只移除 Pivot 自己记录的排除项，不修改用户已有设置、技能正文或 frontmatter。
6. Native MCP 仅修改当前 `.pi/mcp.json` 的 `enabled`。全局服务器采用项目局部覆盖；已有项目定义保留 command/url/env/auth 等原始内容。不同工作目录不会修改同一份全局定义。
7. 任何仍启用的 Pack 引用同一资源时，该资源继续启用；最后一个引用关闭才停用。
8. 删除全局 Pack 定义不遍历工作空间。工作空间 receipt 保留必要快照，允许之后停用已删除的 Pack。

Skills 的哈希为目录内容的确定性 SHA-256；库内容变化须显式更新引用，不能静默升级。单项库技能安装不创建 Pack receipt，仍属用户独立管理资源。已有用户排除项及 frontmatter 限制保持优先；Packs 不是文件访问权限边界。

## 提交与刷新

- 按 canonical cwd 加锁（Windows key 不区分大小写），revision 过期返回 409。API 先校验允许访问的工作根目录，并拒绝配置/技能目标穿越 symlink。
- Skills 复制、项目排除项、native enabled 覆盖及 receipt 一起提交。提交前比较原文件快照，失败回滚本次复制和已写文件；外部并发编辑不会被回滚覆盖，冲突明确报错，并继续恢复其他可恢复文件。
- 服务端按目录通知全部活跃 wrapper。空闲会话重载；运行、压缩或存在待处理工作时延后，当前操作结束再重载，下一次 prompt 前等待同一重载 Promise。SDK 重载按 revision 去重。
- 客户端 `useWorkspacePackRevision` 合并同目录订阅，焦点/每 3 秒刷新，并响应本页变更事件。会话 hook 更新 `get_commands`；不得在 ChatWindow 增加另一套 SDK reload。
- 新会话第一次发送直接使用该目录已有状态，没有 Pack 准备或继承发送门禁。全局定义编辑不会立即遍历已有目录；下一次显式目录切换按当前定义计算并集。

## 代码与验证

- `lib/workspace-pack-switch.ts`：并集、校验、非删除启停及回滚。
- `lib/workspace-pack-files.ts` / `workspace-pack-access.ts`：canonical key、路径及访问约束。
- `lib/native-mcp-config.ts`：复用当前安装的 SDK 原生配置验证器，支持 npm hoist / pnpm；不执行凭据命令。
- `lib/workspace-pack-events.ts` / `lib/rpc-manager.ts`：跨会话通知、安全边界重载。
- `hooks/useWorkspacePackRevision.ts` / `hooks/useAgentSession.ts`：跨页面同步与 slash commands 刷新。
- `lib/skill-pack-apply.ts`、`mcp-pack-apply.ts` 保留底层/历史测试能力，不是新版 API 的删除式停用路径。

```bash
node --test lib/workspace-pack-switch.test.mjs lib/native-mcp-breaking.test.mjs lib/skill-packs-store.test.mjs components/ChatWindow.test.mjs
```

隔离生产构建可运行 `scripts/production-pages.test.mjs` 配合 `PIVOT_TEST_BROWSER=1` / `PIVOT_TEST_NATIVE_MCP=1`，验证真实 SDK、原生服务连接、启停 UI、不同目录隔离及无继承首次发送。构建后同步运行工作区磁盘产物，不自动重启服务。
