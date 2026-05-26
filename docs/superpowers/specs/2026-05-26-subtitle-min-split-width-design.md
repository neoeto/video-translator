# 字幕最小拆分显示宽度可配置

## 概述

将 `electron/services/subtitle.ts` 中硬编码的 `MIN_SPLIT_WIDTH = 20` 改为可配置项，并在设置页的 **Subtitles** 标签中增加对应入口。

这个配置继续沿用现有语义：**显示宽度阈值**，不是字符数，也不是像素值。数值越大，越倾向于把较短的标点片段与后文合并；数值越小，越容易在标点处分裂长字幕。默认值保持 `20`，并允许用户设置为 `0`。

## 目标

- 保持当前分句算法不变，仅让阈值可配置
- 默认行为与现状一致
- 让用户在设置页直接调整长字幕拆分敏感度
- 配置持久化保存，应用重启后仍生效

## 不做的事情

- 不改动 ffmpeg/ASS 烧录逻辑
- 不新增按字符数或像素宽度分句的模式
- 不引入自动缩放字体、截断、省略号或手动插入 `\N`
- 不修改字幕样式配置（字体、颜色、背景等）的现有语义

## 配置设计

### 新增配置字段

在 `AppConfig` 中新增一个独立字段，例如：

```ts
subtitleMinSplitWidth: number
```

选择独立顶层字段，而不是挂到 `subtitleStyle` 下，原因是它属于**字幕分句逻辑**，而不是视觉样式。

### 默认值与持久化

- 默认值：`20`
- 通过 `electron-store` 的 `defaults` 与 `schema` 持久化
- 旧用户未显式保存该字段时，自动回落到默认值 `20`

### 有效值规则

- 保存值应规整为 **大于等于 0 的整数**
- `0` 表示几乎所有满足标点条件的位置都允许拆分
- 非数字、空值或负数在设置层统一规整，避免把非法值扩散到字幕生成阶段

## 代码链路

改动链路保持最短：

```text
electron-store default/schema
  -> AppConfig 类型
  -> renderer 配置读取/保存
  -> SettingsView / Subtitles
  -> subtitle.ts 分句逻辑
```

具体上：

1. `electron/services/types.ts` 增加新字段
2. `src/types.ts` 与前端配置类型同步
3. `electron/services/config.ts` 增加默认值和 schema
4. renderer 配置状态可读写该字段
5. `SettingsView.tsx` 在字幕设置页增加数字输入框
6. `subtitle.ts` 将当前硬编码阈值改为从配置读取的值

## 分句逻辑改动

当前逻辑：

- 在标点处分段
- 只有片段显示宽度达到 `MIN_SPLIT_WIDTH` 时，才接受这次拆分
- 过短片段会与下一段合并

改动后：

- 算法流程完全不变
- 唯一变化是将 `MIN_SPLIT_WIDTH` 由常量改为配置值

这能保证：

- 默认配置下行为不变
- `0` 时更容易拆分长句
- 更大值时更容易合并短片段

## 设置页设计

配置入口放在 **Subtitles** 标签页，使用普通数字输入框，而不是滑块。

原因：

- 当前设置页多数类似配置都用输入框
- 用户可能需要精确输入数值
- 该参数含义偏技术，不是高频拖拽型调节项

文案应明确表达这是“显示宽度阈值”，并补一行帮助说明，例如：

- 中文：`0 表示尽量按标点拆分；值越大，越倾向于合并短片段`
- 英文：`0 makes punctuation splits easier; larger values merge short fragments more aggressively`

## 校验与容错

校验放在设置保存层，而不是字幕生成时兜底：

- 前端将输入解析为数字
- 空值回退为默认值 `20`
- 非法值保存前规整为 `0` 或合法整数

这样可以避免在 `subtitle.ts` 中增加重复分支，也能让持久化配置始终处于有效状态。

## 验证目标

需要确认以下行为：

1. 默认不改设置时，字幕拆分行为与当前版本一致
2. 设置为 `0` 时，长字幕更容易在标点处分裂
3. 设置为较大值时，短片段更容易被合并
4. 不影响字幕时间分配逻辑
5. 不影响字幕样式、ASS 生成和 ffmpeg 烧录链路

## 涉及文件

- `electron/services/types.ts`
- `src/types.ts`
- `electron/services/config.ts`
- `src/store/usePipelineStore.ts`（如需同步类型或默认值）
- `src/components/SettingsView.tsx`
- `src/i18n/locales/zh.ts`
- `src/i18n/locales/en.ts`
- `electron/services/subtitle.ts`
