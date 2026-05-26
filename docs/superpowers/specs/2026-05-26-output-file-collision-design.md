# 最终输出视频避免同名覆盖

## 概述

当前最终输出视频的命名规则是：

- 语音翻译：`{sanitized-title}_translated.mp4`
- 仅字幕：`{sanitized-title}_subtitled.mp4`

当两个视频标题相同，且导出模式也相同时，最终输出会落到同一路径，导致后一次导出覆盖前一次结果。

本设计将保留现有可读命名方式，但在**检测到目标文件已存在**时，自动在文件名后追加时间戳后缀，避免覆盖。

## 目标

- 同标题视频不会互相覆盖
- 默认情况下保持当前文件名不变
- 仅在发生路径冲突时追加时间戳
- 时间戳格式统一为 `YYMMDD-HHmmss`
- 不改动现有输出目录结构

## 不做的事情

- 不改成按视频 ID 或哈希分目录存储
- 不在每次导出时都追加时间戳
- 不修改历史记录的数据结构
- 不调整 UI 或设置项

## 命名规则

### 基础文件名

继续沿用当前基础命名：

- `My Video_translated.mp4`
- `My Video_subtitled.mp4`

### 冲突时的退让规则

当目标路径已存在时，改用：

- `My Video_translated_260526-091530.mp4`
- `My Video_subtitled_260526-091530.mp4`

其中时间戳格式为：

```text
YYMMDD-HHmmss
```

该后缀追加在模式后缀（`_translated` / `_subtitled`）之后、扩展名之前。

## 实现位置

主要改动集中在 `electron/services/pipeline.ts` 的最终输出路径生成阶段。

当前逻辑：

```ts
const suffix = isSubtitleOnly ? '_subtitled' : '_translated'
const finalOutputPath = path.join(outputDir, `${sanitizeFileName(download.title)}${suffix}.mp4`)
```

改动后：

1. 先生成基础输出路径
2. 调用一个小型的“避免重名”帮助函数
3. 如果文件不存在，直接返回基础路径
4. 如果文件已存在，返回带 `_YYMMDD-HHmmss` 的路径

建议抽出独立帮助函数，避免把路径探测、时间戳拼接和重试逻辑塞进 `start()` 主流程。

## 冲突处理细节

### 第一次导出

如果目标文件不存在：

- 不追加时间戳
- 行为与当前版本一致

### 第二次及后续导出

如果目标文件已存在：

- 追加 `_YYMMDD-HHmmss`
- 生成新的未占用路径

### 同秒二次冲突

极小概率下，如果同一秒内再次命中同名文件：

- 在时间戳版本基础上继续做存在性检测
- 必要时追加递增序号，直到找到可用路径

这样可以保证即使连续快速导出，也不会覆盖已有文件。

## 数据流影响

这项改动不需要修改 IPC 或前端协议。

`outputPath` 仍然是单一真实路径，只是它在冲突场景下会变成带时间戳的版本。因此：

- combiner 继续接收最终 `outputPath`
- history 继续记录最终 `outputPath`
- ResultView / 打开文件 / 打开目录逻辑无需额外改动

## 验证目标

需要确认以下行为：

1. 同标题视频第一次导出时，文件名保持原样
2. 同标题视频第二次导出时，不覆盖旧文件，而是生成带 `_YYMMDD-HHmmss` 的新文件
3. `full` 与 `subtitleOnly` 模式都遵守相同规则
4. history 中记录的是最终真实输出路径
5. 在极端情况下，同一秒多次导出也不会覆盖文件

## 涉及文件

- `electron/services/pipeline.ts`
- 如有必要，新增一个输出路径帮助文件（例如位于 `electron/services/` 下）
