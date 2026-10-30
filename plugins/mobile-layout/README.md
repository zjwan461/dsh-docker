# Mobile Layout — 移动端布局

给 DeepSeek Harness Web UI 用的手机适配插件。它不改任何页面结构，只在窄屏（≤ 768px）时注入一套响应式样式，并提供一个抽屉按钮和一个设置项。

- 插件包名：`@local/dsh-mobile-layout`
- 位置：`/workspaces/UI/mobile-layout`
- 组成：Host 半边（空 `apply`）+ Client 半边（样式 + 抽屉按钮 + 设置行）

## 装了什么

| 位置 | 内容 |
| --- | --- |
| `shell.overlay`（order 5） | 左上角 44×44 的抽屉按钮；抽屉打开时铺一层可点击关闭的遮罩 |
| `settings.general.item`（order 14） | Settings → General 里的「移动布局」行：自动 / 始终 / 关闭 |
| `<head><style>` | 仅在 `html[data-dsh-mobile]` 生效的窄屏样式表，插件卸载时移除 |

## 手机上做的调整

1. **侧栏变抽屉**：56px 图标轨道让出宽度，对话区占满全宽；侧栏改为 320px 浮层，点按钮打开，点遮罩、按 Esc，或选中会话 / New Session / 全局面板（如 Plugins）/ Settings 后自动收起。
2. **安全区**：`100dvh` + `env(safe-area-inset-*)`，额头、刘海和 Home 指示条不挡内容。
3. **头部**：去掉桌面内边距，操作区（后台任务、插件按钮、右侧面板开关）可横向滑动，不再把宽度撑破。
4. **对话区**：正文两侧留白从 32px 收到 14px；`pre`、`table`、图片横向滚动，不再溢出。
5. **输入框**：字号 16px（iOS 不会在聚焦时放大），发送键 34 → 40px，底部留出安全区。
6. **设置页**：整页 sheet，左侧分节列表变成顶部可横滑的标签条，关闭按钮固定在右上角。
7. **插件页**：为左上角的抽屉按钮让出 52px 顶部空间，标题行与工具栏在窄屏换行（Plugins 页的「Add plugin」不再压住标题）。
8. **触摸目标**：会话/工作区行高 32 → 40px。
9. **其他弹窗**：限制在视口内（`max-width: 100vw - 16px`）。

## 安装

这是一个普通的 Harness bundle（`dsh.bundle.patch` + `dsh.client`），不需要构建、没有依赖：

1. 解压到任意目录，例如 `~/plugins/mobile-layout`。
2. 用 Plugin Manager 安装这个**目录**（绝对路径）：
   - 对话里让 Agent 调 `plugin_manager` `action: "install_bundle"`，`target` 填该目录绝对路径；或
   - 在 Web UI 的 Plugins → Add plugin 里按同样的路径安装。
3. 安装后刷新页面。卸载用 `plugin_manager` 的 `remove_bundle`，或 Plugins 页面上的开关。

注意：`file:`/`link:` 方式安装时，插件内容不会被复制，删除源码目录会让插件失效。

## 使用

装好后刷新页面（浏览器里的插件模块需要重新加载）：

- 手机或窄窗口打开时**自动生效**；
- 想强制开/关：Settings → General → Mobile layout（自动 / 始终 / 关闭），选择存在 `localStorage["dsh.mobileLayout.mode"]`；
- 桌面上不会生效，除非手动选「始终」。

## 设计取舍

- **只加样式，不替换组件**：没有占用 `root` / `sidebar` / `main` 这些会盖掉自带 UI 的槽位，因此宿主升级时最坏情况是样式失效，而不是页面白屏。
- **选择器靠语义属性**：优先用 `[data-composer-input]`、`[data-conversation-content]`、`[data-row-key^="session:"]`、`[role="dialog"]` 这类稳定钩子；必须用 CSS Module 类名时用 `[class*="_sidebarCol"]` 这种后缀匹配，前端换 hash 也不会立刻失效。
- **抽屉状态来自 shell**：用 `ctx.layout.toggleSidebar()` 打开/关闭，并观察 frame 的 `data-sidebar-collapsed` 属性保持同步，不自建侧栏状态。
- **文案走 locale**：中英文都在 `client.js` 的 `zh` / `en` 字典里，经 `ctx.locale.register` 注册。

## 已知限制

- 依赖 `:has()`（iOS 15.4+ / Chrome 105+）；更老的浏览器上设置页仍是桌面双栏，其余样式正常。
- 顶部操作区在极窄屏上需要横向滑动才能看到最右侧按钮。
- 只覆盖 `≤ 768px`；平板（769–1023px）仍是 Harness 自带的图标轨道布局。
- 未做左边缘滑动打开抽屉的手势。

## 卸载

Plugin Manager 里移除 `@local/dsh-mobile-layout`，或调用 `plugin_manager` 的 `remove_bundle`。样式、按钮和设置行都会随插件卸载消失，`data-dsh-mobile` 属性也会被移除。
