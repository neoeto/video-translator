# 素材库详情弹窗显示原始来源链接

## 概述

当前素材库 / 翻译记录详情弹窗会展示来源类型、时长、文件大小、语言、生成时间等信息，但不会展示任务最初使用的原始视频链接。对于 YouTube 和 Bilibili 任务，这会让用户在回看历史记录时，难以快速跳回原视频页面。

本设计将在历史记录中持久化原始来源 URL，并在详情弹窗中为 `youtube` / `bilibili` 记录新增“原始链接”字段。该字段以可点击链接形式展示，点击后直接在默认浏览器中打开。`local-file` 记录不显示本地路径，也不复用该字段。

## 目标

- 在详情弹窗中显示 YouTube / Bilibili 记录的原始来源链接
- 链接可点击，并直接在默认浏览器中打开
- 历史记录数据链路中持久化原始 URL，避免前端临时推导
- 保持旧记录兼容：没有链接的旧数据仍可正常展示
- 不暴露本地文件路径

## 不做的事情

- 不为 `local-file` 记录显示本地源文件路径
- 不为旧历史记录补写或迁移 `sourceUrl`
- 不在列表卡片上增加原始链接入口，仅在详情弹窗中展示
- 不修改下载、翻译、输出文件命名等既有流程

## 方案选择

本次采用“**写入 history，详情弹窗直接读取**”的方案。

原因：

1. 原始 URL 在任务启动时就已经明确，是最稳定的数据源
2. history 本来就是详情弹窗的数据来源，新增字段最顺手
3. 避免在渲染层根据 `videoTitle`、`sourceType` 或任务上下文反推链接，减少脆弱逻辑

不采用“渲染层临时拼装链接”的原因是：旧记录、不同来源格式、未来来源扩展都会让拼装规则越来越脆弱，而且 UI 层也拿不到最可靠的原始输入。

## 数据结构调整

在 history 记录模型中新增可选字段：

```ts
sourceUrl?: string
```

涉及同步更新的类型位置：

- `electron/services/history.ts`
- `src/preload.d.ts`

字段语义：

- 对 `youtube` / `bilibili`：保存用户启动任务时传入的原始 URL
- 对 `local-file`：不写入该字段
- 对历史旧记录：字段缺失，按未设置处理

该字段保持可选，避免引入历史迁移成本，也便于兼容现有 store 数据。

## 数据流设计

### 写入时机

原始 URL 已存在于队列任务 `task.url` 中，因此在任务完成、写入 history 时一并写入最稳妥。

建议流程：

1. `pipeline:start` 收到用户输入 URL 与 `sourceType`
2. main 进程将其放入 `QueueTask`
3. 任务完成后，`addHistoryEntry(...)` 写入记录时：
   - 若 `sourceType` 为 `youtube` / `bilibili`，写入 `sourceUrl: task.url`
   - 若 `sourceType` 为 `local-file`，不写入 `sourceUrl`

这样可以保证详情页看到的是任务真实输入，而不是后续推导结果。

### 读取时机

渲染层继续通过 `window.electronAPI.getHistory()` 读取 history。详情弹窗直接消费 `selectedEntry.sourceUrl`，不额外请求其他接口。

## 打开链接能力

现有 `window.electronAPI.openPath()` 底层对应 `shell.openPath()`，适用于文件和目录，不适合网页 URL。

因此本设计新增一条独立能力链路，用于打开网页链接：

- preload 暴露新的 URL 打开方法
- main 进程新增对应 IPC handler
- 底层使用 Electron 的外部链接打开能力在默认浏览器中打开 URL

保留 `openPath` 原有职责不变：

- `openPath`：打开文件 / 目录
- 新接口：打开网页 URL

这样可以保持 API 语义清晰，避免把不同类型的打开动作混成一个入口。

## UI 展示设计

详情弹窗信息区当前是一个两列信息网格。本次在该网格中新增一项：

- 标签：`原始链接` / `Original Link`
- 值：可点击文本链接

展示规则：

1. `sourceType` 为 `youtube` 或 `bilibili`，且 `sourceUrl` 存在  
   → 显示为可点击链接
2. `sourceType` 为 `youtube` 或 `bilibili`，但 `sourceUrl` 缺失（旧记录）  
   → 显示 `--`
3. `sourceType` 为 `local-file`  
   → 显示 `--`

交互要求：

- 点击链接后直接调用新的“打开外部链接”接口
- 链接视觉上应明显可点击，例如使用已有主题中的链接色、下划线或 hover 反馈
- 长 URL 可以按现有详情弹窗布局做换行，不要求额外做短链或折叠

## 边界处理

### 历史旧数据

旧记录没有 `sourceUrl` 是正常状态，不做迁移。详情弹窗按缺失字段处理，显示 `--`，不能报错、不能出现空白布局异常。

### 本地文件

`local-file` 任务不展示本地源文件路径，避免让“原始链接”字段语义混乱，也避免在详情弹窗里泄露不必要的本地路径信息。

### 非法或异常 URL

本次不额外引入复杂校验器。写入的 `sourceUrl` 来自实际启动任务时的输入，默认认为其与任务来源一致。

如果未来需要更强约束，再单独补充 URL 规范化或来源校验；本次仅要求：

- 已完成并进入 history 的远程来源记录，写入的链接可被原样打开
- 打开失败时，错误沿用现有 IPC 异常抛出路径，不做静默吞掉

## 验证目标

需要确认以下行为：

1. 新跑一个 YouTube 任务后，详情弹窗能看到可点击的原始链接
2. 新跑一个 Bilibili 任务后，详情弹窗能看到可点击的原始链接
3. 点击链接后会在默认浏览器中打开原视频页面
4. 历史旧记录没有 `sourceUrl` 时，详情弹窗正常显示 `--`
5. `local-file` 记录不显示本地路径，只显示 `--`
6. 新增字段不会影响现有 history 列表、输出文件打开、打开目录等行为

## 涉及文件

- `electron/services/history.ts`
- `src/preload.d.ts`
- `electron/preload.ts`
- `electron/main.ts`
- `src/components/ResultView.tsx`
- `src/i18n/locales/zh.ts`
- `src/i18n/locales/en.ts`
