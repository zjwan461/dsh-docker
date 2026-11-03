# Mobile Layout — 移动端布局

给 DeepSeek Harness Web UI 用的手机适配插件。它不改任何页面结构，只在窄屏（≤ 1023px，与宿主自己的收栏阈值一致）时注入一套响应式样式，并提供一个抽屉按钮和一个设置项。

- 插件包名：`@local/dsh-mobile-layout`
- 位置：`/workspaces/UI/mobile-layout`
- 组成：Host 半边（空 `apply`）+ Client 半边（样式 + 抽屉按钮 + 设置行）

## 装了什么

| 位置 | 内容 |
| --- | --- |
| `shell.overlay`（order 5） | 左上角 44×44 的抽屉按钮；抽屉打开时铺一层可点击关闭的遮罩 |
| `settings.general.item`（order 14） | Settings → General 里的「移动布局」行：自动 / 始终 / 关闭 |
| `<head><style>` | 仅在 `html[data-dsh-mobile]` 生效的窄屏样式表，插件卸载时移除 |
| viewport meta | 激活期间补上 `viewport-fit=cover` 与 `interactive-widget=resizes-content`，关闭时还原原文（见下「安全区」） |
| `--dshm-kb` | 软件键盘遮挡的高度，由 `visualViewport` 实测；布局按它收缩 |

## 手机上做的调整

1. **侧栏变抽屉**：56px 图标轨道让出宽度，对话区占满全宽；侧栏改为 `min(86vw, 320px)` 浮层，点按钮打开，点遮罩、按 Esc，或选中会话 / New Session / 全局面板（如 Plugins）/ Settings 后自动收起。
2. **左边缘滑动开抽屉**：从屏幕左边缘 24px 内起手横向拖动，抽屉跟着手指走；拖过 64px 松手即打开，否则回弹。抽屉打开时向左滑可关闭。纵向手势、从中间起手的滑动一律不管，交给对话区自己滚动（iOS 的返回手势也已 `preventDefault` 掉）。
3. **安全区真正生效**：宿主的 viewport meta 没有 `viewport-fit=cover`，iOS 上 `env(safe-area-inset-*)` 全是 0 —— 所以本插件在激活时把这两项补进 meta，关闭时还原。在此基础上用 `100dvh` + 四边 `env(safe-area-inset-*)`（横屏的左右刘海也算进去）。
4. **键盘不再挡住输入框**：`100dvh` 不含软件键盘高度（iOS 的键盘是覆盖层）。插件监听 `visualViewport`，把被遮挡的高度写进 `--dshm-kb`，整个 frame 与设置 sheet 按它收缩；Chrome 上再加 `interactive-widget=resizes-content` 让布局视口自己缩。
5. **右栏改成全屏层**：文件 / 预览 / 终端 / 产出物原来在手机上没有位置（第三列恒为 0 宽，而宿主面板是 `position:absolute; overflow:clip`，只能被裁掉）。现在只要右栏打开（`[data-sidebar-right-open]`），就把面板提升为覆盖整个视口的层，带安全区留白。关闭仍用面板自己工具栏上的收起控件（右栏顶部那一排标签里点当前项），插件不接管右栏的开合状态。
6. **可加到主屏幕当独立应用**：激活时注入 `apple-mobile-web-app-capable` / `mobile-web-app-capable` / `apple-mobile-web-app-status-bar-style`（`black-translucent`，配合安全区）与 `theme-color`（暗色 `#151517`、亮色 `#fff`，跟随系统）。iOS 只认这些 meta，不认 web manifest。
7. **头部**：去掉桌面内边距，操作区（后台任务、插件按钮、右侧面板开关）可横向滑动，不再把宽度撑破。
8. **对话区**：正文两侧留白从 32px 收到 14px；`pre`、`table`、图片横向滚动，不再溢出。
9. **横滚可发现**：真正能横向滚动的代码块 / 表格，右边缘做 22px 渐隐（只有溢出时才加，文字放得下就不加）。
10. **宽表格收进视口**：宿主用负 margin 让 `md-table-wide` 撑出正文列，手机上那会直接溢出，这里拉回 100%。
11. **不再触发安卓下拉刷新**：对话滚动容器加 `overscroll-behavior-y: contain`，滚动链不传到页面。
12. **输入框**：字号 16px（iOS 不会在聚焦时放大），发送键 34 → 40px，底部留出安全区；并加 `enterkeyhint="send"`、`autocorrect="off"`（写代码/命令时不被"自动修正"）。
13. **正文最小字号**：读一下宿主当前的 `--dsh-content-font-size`，**只有在低于 15px 时**才抬到 15px（`data-dshm-font-floor`），用户自己调大的字号不会被覆盖。
14. **设置页**：整页 sheet，左侧分节列表变成顶部可横滑的标签条，关闭按钮固定在右上角；高度同样按键盘收缩。
15. **插件页**：为左上角的抽屉按钮让出 52px 顶部空间，标题行与工具栏在窄屏换行（Plugins 页的「Add plugin」不再压住标题）。
16. **触摸目标**：会话/工作区行高 32 → 40px。

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

- 手机或窄窗口（≤ 1023px）打开时**自动生效**；
- 想强制开/关：Settings → General → Mobile layout（自动 / 始终 / 关闭），选择存在 `localStorage["dsh.mobileLayout.mode"]`；
- 桌面上不会生效，除非手动选「始终」。

## 设计取舍

- **只加样式，不替换组件**：没有占用 `root` / `sidebar` / `main` 这些会盖掉自带 UI 的槽位，因此宿主升级时最坏情况是样式失效，而不是页面白屏。
- **断点跟宿主一致**：宿主在 `SIDEBAR_AUTO_COLLAPSE = 1024` 之下自己会把侧栏收成图标轨道，所以本插件用 `≤ 1023px`。写过 768 的版本会让 769–1023（手机横屏、平板竖屏）掉进「宿主已收栏、插件没接管」的空档。
- **文档级改动要能还原**：viewport meta 与 `--dshm-kb` 都在关闭/卸载时恢复原状，不做常驻修改。
- **选择器靠语义属性**：优先用 `[data-composer-input]`、`[data-conversation-content]`、`[data-row-key^="session:"]`、`[role="dialog"]`、`[data-sidebar-right-open]` 这类稳定钩子；必须用 CSS Module 类名时用 `[class*="_sidebarCol"]` 这种后缀匹配，前端换 hash 也不会立刻失效。
- **抽屉状态来自 shell**：用 `ctx.layout.toggleSidebar()` 打开/关闭，并观察 frame 的 `data-sidebar-collapsed` 属性保持同步，不自建侧栏状态。
- **文案走 locale**：中英文都在 `client.js` 的 `zh` / `en` 字典里，经 `ctx.locale.register` 注册。

## 已知限制

- 依赖 `:has()`（iOS 15.4+ / Chrome 105+）；更老的浏览器上设置页仍是桌面双栏，其余样式正常。
- 右栏在手机上变成**全屏覆盖**，不是分栏；平板/桌面宽度（≥ 1024）仍用宿主原生的并排布局。
- 顶部操作区在极窄屏上需要横向滑动才能看到最右侧按钮。
- 键盘高度靠 `visualViewport` 实测，极少数旧 WebView 没有该 API：此时只是回到「键盘可能挡住输入框」的原状，其余样式不受影响。
- 边缘手势只在触摸设备上注册（监听 `touch*` 事件），桌面鼠标用户请用左上角的按钮。
- 「加到主屏幕」的图标仍是 iOS 对页面的截图：宿主只提供一张 SVG favicon，iOS 不支持用它做 `apple-touch-icon`。要换图标需在部署侧（Caddy 或前端 dist）放一张 180×180 PNG，插件不接管静态资源。

## 怎么确认它在手机上真的生效

字号变小、抽屉能开，说明样式进去了；但下面三条只能靠实测，因为它们在浏览器里各自独立：

1. **安全区**：Safari 里打开页面，地址栏收起后页面仍占满刘海区域（不是被灰边包住）——说明 `viewport-fit=cover` 生效。再看 `document.querySelector('meta[name=viewport]').content` 里有没有它。
2. **键盘**：点进输入框，输入框底边应当抬到键盘上方（而不是被遮住）。同时 `document.documentElement.style.getPropertyValue('--dshm-kb')` 应是一个接近键盘高度的值。
3. **右栏**：点开「文件」，面板应铺满整屏而不是缩在右边一条缝里。
4. **边缘手势**：从屏幕最左边往里划，抽屉应跟着手指出来。若纹丝不动，多半是浏览器把手势当成了返回导航——确认插件已加载（`document.documentElement.dataset.dshMobile !== undefined`）。
5. **主屏幕**：Safari 分享 → 添加到主屏幕，打开后应没有地址栏。没有独立启动说明 meta 没注入成功。

## 卸载

Plugin Manager 里移除 `@local/dsh-mobile-layout`，或调用 `plugin_manager` 的 `remove_bundle`。样式、按钮和设置行都会随插件卸载消失，`data-dsh-mobile` / `data-dshm-font-floor` 属性、`--dshm-kb` 变量和 viewport meta 的改动都会还原。
