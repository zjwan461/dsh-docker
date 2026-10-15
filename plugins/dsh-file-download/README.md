# 对话产出文件：浏览器下载插件

给 DeepSeek Harness 的 Web GUI 增加一个能力：**把对话里生成/交付/正在预览的文件，交给浏览器自己的下载器保存**。

安装后无需任何额外配置：文件卡片、改动文件、右侧预览工具栏上会多出一个下载图标，点击即走浏览器下载（下载目录由浏览器决定）。

## 按钮出现在哪里

| 位置 | 插槽 | 文件来源 |
|---|---|---|
| 回复下方的交付文件卡片（`present` 工具） | `deliverables.file.actions` | Session 里记录的 `deliverables/presented` 事件 |
| 完成轮次的改动文件复查页 | `deliverables.review.file.actions` | 该轮次的 `workspace/changes` 摘要 |
| 右侧栏文件预览工具栏 | `sidebar.right.tab.document.actions` | 预览中的文件绝对路径 |
| 右侧栏"无法预览"占位处（如 pptx 等二进制） | `sidebar.right.tab.document.unpreviewable` | 同上 |

后两个入口覆盖了"任意工作区文件"，前两个覆盖了"本轮对话产出的文件"。

## 工作方式

Host 半只需注册一条带鉴权的 Fetch 路由：

```
GET|HEAD /api/file.download
```

调用方用两种方式之一指定文件：

- **坐标方式**（文件卡片/复查页）：`?from=present&sessionId=<id>&seq=<事件序号>&index=<文件下标>`
  Host 侧重新从 Session 日志校验该坐标（`deliverables/presented` 事件或 `workspace/changes` 摘要），
  所以这条路由能下载的，绝不超出该 Session 自己记录过的文件。
- **路径方式**（预览/不可预览）：`?from=path&path=<绝对路径>`
  与 Harness 自带的 `/api/file` 取图路由同一套文件系统权限。

响应带 `Content-Disposition: attachment`（含 ASCII 回退名与 UTF-8 文件名）、按扩展名推断的
`Content-Type`、`Content-Length`、`no-store`、`nosniff`，并通过 `ctx.fs.readByteRange`
**分窗流式**发送，大文件不会整份读进 Host 内存。`HEAD` 只做 stat 预检，供浏览器先判断成败。

浏览器半点击按钮时先发 `HEAD` 预检：成功就把 `GET` 交给浏览器下载管理器（页面里不缓冲任何字节），
失败则图标转成错误色并给出提示文字。

## 可调项

本包不声明 `Config` schema（见下），调优值直接写在 profile 的 `cordis.patch.yml` 覆盖层里：

```yaml
- id: file-download
  name: '@local/dsh-file-download'
  config:
    chunkBytes: 1048576   # 每次读取的窗口字节数，4096–8388608，默认 1 MiB
    maxBytes: 0           # 单文件上限；0（默认）不设上限，超出返回 413
```

## 为什么没有 Config schema

本包以 `link:` 方式安装到 profile，真实路径仍在工作区里，因此 **宿主半不能 import 任何裸包名**
（`@deepseek-ai/schemastery` 之类只在 dsh 安装目录里，Node 会按工作区的真实路径向上查找而失败）。
宿主半因此零 import，只有 ESM 标准语法；代价是没有 schema 校验与设置界面里的配置项。

## 验证状态

- Host 半：`../dsh-file-download-check/route-check.mjs` 用桩服务驱动真实注册的路由，覆盖
  路径/交付/改动三种寻址、分窗重组、文件名与响应头、以及 400/403/404/413 拒绝路径 —— 全部通过。
- 浏览器半：`../dsh-file-download-check/client-check.mjs` 用桩 React/DOM/模块加载器跑通
  工厂装载、四个插槽注册、坐标改写、点击 → HEAD → 下载器接管 —— 全部通过。
- 未验证：真实页面上的视觉表现与真实登录态下的端到端下载（需要你在浏览器里点一次确认）。

## 卸载

在设置 → 插件里关闭该 bundle，或让 agent 用 `plugin_manager` 的 `remove_bundle`
（包名 `@local/dsh-file-download`）移除。源码在工作区 `dsh-file-download/`。