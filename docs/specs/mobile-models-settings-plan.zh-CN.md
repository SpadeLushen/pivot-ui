# 移动端 Settings-Models 布局调整方案

状态：**布局已实施**，包含第 3 节的移动端高度增强。后续补充了方向转场和 Settings 标签页状态保留：已访问标签页在弹窗关闭前保持挂载，Models 不再因切换标签重新加载；转场方向按标签排列或列表／详情导航决定，首次挂载不播放动画，并尊重系统减少动态效果设置。Storage 隐藏时暂停轮询。

已通过当前工作区 `npm run build`（包含类型检查和打包）。第 6 节保留原验证计划；未新增或运行测试、lint，尚未进行浏览器视觉走查。未控制运行服务。

## 1. 问题与根因

移动端 Settings → Models 采用左右分栏（左：Provider/Model 树，右：详情表单）。在 `isMobile` 下改为上下分栏后，上栏占满 `40vh`，下栏（详情）几乎不可见，内容被压缩到不足一行。

相关代码位于 `components/ModelsConfig.tsx`（当前行号以撰写时为准）：

- Body 容器改为 `flexDirection: isMobile ? "column" : "row"`（1579 行）；
- 上栏仍保留 `flexShrink: 0` 并设置 `maxHeight: isMobile ? "40vh" : undefined`（1582–1588 行）。

根因是两处高度约束互相脱节：

1. `40vh` 是**视口单位**，而外层 Settings 弹窗高度被限制为 `min(560px, calc(100dvh - 16px))`（`components/SettingsModal.tsx` 86 行）。在 852px 高的手机上，弹窗高 560px，扣除 header、tab 栏、footer 后 body 仅约 423px；
2. 而 `40vh = 341px` 全部划给上栏，下栏只剩约 80px，再扣 40px padding，实际内容高度约一行。

这是零和空间分配：列表越长上栏顶得越满，下栏永远趋近于零。仅调比例无法根治。

```text
当前（移动端，示例 852px 视口）        期望（移动端）
┌───────────────────────┐           ┌───────────────────────┐
│ Settings 标题 / Tab    │           │ Settings 标题 / Tab    │
├───────────────────────┤           ├───────────────────────┤
│ Provider/Model 树      │           │ Provider/Model 树      │
│ 占 40vh ≈ 341px        │           │ 独占全部高度           │
├───────────────────────┤           │ 可滚动                 │
│ 详情 ≈ 80px（一行）    │           │                       │
└───────────────────────┘           └───────────────────────┘
                                    点击条目 → 详情独占全屏，
                                    顶部有返回按钮
```

## 2. 推荐方案：移动端改为单栏导航（列表 ⇄ 详情互斥）

采用移动端设置类界面的标准做法：每一屏独占全部高度，点列表项进入详情，详情顶部提供返回。列表与详情互斥渲染，不再共享纵向空间。桌面端渲染完全不变。

### 2.1 新增视图状态

```tsx
const [mobileDetail, setMobileDetail] = useState(false);
```

视图由独立状态控制（初值 `false`），不复用既有 `selection`：初始加载仍会 `setSelection` 到第一个 provider（`ModelsConfig.tsx` 1409 行附近），但移动端首屏应显示列表，而非直接进入详情。保留的 selection 让列表高亮"上次查看项"，属良性。

### 2.2 统一选择入口

逐个给 onClick 打补丁容易遗漏，改为统一入口：

```tsx
const openSelection = useCallback((sel: Selection) => {
  setSelection(sel);
  if (isMobile) setMobileDetail(true);
}, [isMobile]);
```

替换以下交互点的 `setSelection`：

- 树中 OAuth / API-key / 自定义 provider 行、model 行（1591–1669 行附近）；
- `addCustomProvider`（1417 行）；
- `addModel`（1461 行）；
- `AddProviderPicker` 的两个回调（约 1745 与 1765 行各一份）。建议先将两处重复的 `onSelectOAuth` / `onSelectApiKey` 抽成命名函数共用，再接入 `openSelection`。

### 2.3 Body 改为互斥渲染

移动端：

- `!mobileDetail` 时只渲染列表，占据全部高度；去掉 `maxHeight: "40vh"`、`flexShrink: 0` 及上下分栏的分割边框；
- `mobileDetail && selection` 时只渲染详情。

桌面端维持现有 210px 左栏 + 详情，条件由 `isMobile` 守卫。

### 2.4 详情返回栏

详情容器（1701 行附近）改为纵向 flex：

- 顶部固定一条**仅移动端显示**的返回栏（`ArrowLeft` 图标 + 文案，`flexShrink: 0`）；
- 下方是现有 `overflowY: "auto"; padding: 20` 的滚动区。

返回栏放在 `ModelsConfig` 主组件内，**不要放进 `ModelDetail` 内部**：`lib/models-config-sdk.test.mjs` 会切片该函数源码（`source.slice(source.indexOf("function ModelDetail("))`）解析 `set` / `setCost`，改动其结构会破坏测试；如此 `ModelDetail` 也无需感知移动端。

### 2.5 删除后返回列表

`deleteProvider`（1448 行附近）与 `removeModel`（1483 行附近）被调用后，详情不应停留在已删除项或跳变到其他项上。在这两个函数末尾加：

```tsx
if (isMobile) setMobileDetail(false);
```

### 2.6 i18n

新增键 `models.backToProviders`，需同时补 `lib/i18n/en.ts` 与 `lib/i18n/zh.ts`：

- en：`"Back to Providers"`
- zh：`"返回 Provider 列表"`

沿用现有 `models.*` 键的混合风格（该组键在 zh 中大多保留英文术语）。

## 3. 可选加强

移动端让 Settings 弹窗高度用满：把 `components/SettingsModal.tsx` 86 行的 `height` 在 `isMobile` 时改为 `calc(100dvh - 16px)`。详情表单字段多（thinking level map、cost 四列等），更高会明显缓解拥挤；对其他 tab 无副作用。非必需，可单独评估。

## 4. 不推荐的做法

仅把 `40vh` 调小（如 30%）或改为百分比：列表与详情同时需要纵向空间，比例上仍是零和，只会把"下栏几乎不可见"变成"两栏都不够用"。问题本质是两栏争抢同一段受限高度，必须让两者不再同时出现。

## 5. 影响文件清单

| 文件 | 改动 |
|------|------|
| `components/ModelsConfig.tsx` | 主体改动：视图状态、统一入口、互斥渲染、返回栏、删除回列表 |
| `lib/i18n/en.ts` | 新增 `models.backToProviders` |
| `lib/i18n/zh.ts` | 新增 `models.backToProviders` |
| `components/SettingsModal.tsx` | 可选：移动端弹窗高度用满（第 3 节） |

## 6. 验证

1. `node_modules/.bin/tsc --noEmit` 与 `npm run lint`；
2. 新增 `components/ModelsConfig.test.mjs`，参考现有静态断言测试风格（如 `components/AppShell.test.mjs`），断言：
   - 互斥渲染条件（`mobileDetail` 控制列表与详情）；
   - 返回按钮触发 `setMobileDetail(false)`；
   - 删除后回列表（`deleteProvider` / `removeModel` 中的分支）；
   - 注意不要改动 `hooks/useBackdropDismiss.test.mjs` 对 ModelsConfig 的引用计数（每个文件的 `useBackdropDismiss` 调用数为 2）；
3. `npm run dev`（端口 30141）后以移动视口走查：
   - 列表 → 详情 → 返回；
   - 添加 Provider / Model 后直达详情；
   - 删除 Provider / Model 后回列表；
   - 桌面端布局无回归。


