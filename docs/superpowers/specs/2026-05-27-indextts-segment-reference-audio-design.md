# IndexTTS 原始分段参考音设计

## 需求描述

当前 IndexTTS 的参考音主要来自「每个 speaker 的固定样本（最长片段）」或全局 `indexttsReferenceAudio`。  
这会导致同一 speaker 在不同语气/情绪段落中的表达被“平均化”，情绪一致性不足。

目标是新增一种参考音策略：当 TTS 支持参考音（以 IndexTTS-2 为主）时，优先使用**当前待合成分段对应的原始语音片段**作为 `reference_audio`，从而尽可能保留该段音色与情绪；并在不稳定场景下优先回退到稳定策略。

## 范围与原则

### In Scope

1. 仅针对 `ttsMode = indextts` 增加参考音策略配置。
2. 新增 `segment-original` 策略（默认仍保留 `speaker-sample`）。
3. 采用**转写原始时间轴**（非最终字幕回填时间轴）做匹配。
4. 实现 P0 级边界防护（见后文）。

### Out of Scope

1. 不改其他 TTS 策略（edge/openai）。
2. 不做自动说话人纠错（仅做保守回退）。
3. 不引入跨机器可访问路径协议（远端服务可访问性问题留到后续）。

## 关键决策（已确认）

1. 时间轴来源：`TranslatedSegment.start/end`（来自转写链路，翻译阶段强约束时间戳不变）。
2. 稳定性优先：遇到重叠/不稳定段时，不强行使用原始分段参考，直接回退 `speaker-sample`。
3. P0 防护范围：`#1 跨 speaker 污染` + `#2 重叠段误配` + `#3 短段/静音无效参考`。

## 边界场景约束（P0）

### 1) 扩窗跨 speaker 污染（必须防）

- 风险：短句扩窗时把邻近说话人声音带入参考音。
- 约束：扩窗仅允许在“同 speaker 连续 run”内进行；遇异 speaker 边界立刻截断。
- 结果：不允许跨 speaker 扩窗。

### 2) 重叠说话段误配（必须防）

- 风险：多人重叠发言导致参考音混入多说话人。
- 约束：若当前段与异 speaker 段存在显著重叠，直接视为不稳定段。
- 处理：不走 `segment-original`，立即回退到 `speaker-sample`。

### 3) 参考片段过短/近静音（必须防）

- 风险：参考音信息不足导致克隆失败或音色漂移。
- 约束：最小时长 + 有效性校验（时长/能量）。
- 处理：校验失败则回退，不向 IndexTTS 发送低质量参考音。

## 技术方案

### 配置扩展

在配置中新增：

```ts
type IndexTtsReferenceMode = 'speaker-sample' | 'segment-original'
```

默认值：`speaker-sample`（保持现有行为不变）。

### Pipeline 输入扩展

为 `SynthesizerStrategy.synthesize` 增加源音频上下文（仅 IndexTTS 使用）：

```ts
sourceAudioPath?: string
```

其中 `sourceAudioPath` 使用已提取的 `audio.wav`。

### IndexTTS 参考音解析器

在 `indextts` 策略内新增 `ReferenceAudioResolver`（逻辑模块），职责：

1. 根据 `segment + speaker + sourceAudioPath` 生成候选参考片段。
2. 执行边界约束（不跨 speaker、重叠判断、有效性校验）。
3. 返回最终 reference（可能回退到 speaker-sample / 全局 reference）。

#### 核心流程

```text
segment(start,end,speaker)
  -> 尝试 segment-original 参考
     -> 边界约束检查（跨 speaker / 重叠 / 有效性）
       -> 通过: 用该片段
       -> 不通过: 回退 speaker-sample
         -> 若无: 回退全局 indexttsReferenceAudio
           -> 若仍无: 不传 reference_audio
```

#### 窗口规则（默认参数）

- 原段时长 < 1.2s：扩窗到 2.5s（但不跨 speaker run）。
- 原段时长 > 6s：截到 6s（优先保留段中心情绪信息）。
- 同 speaker 相邻上下文可并入，总时长 <= 8s。

#### 回退优先级

1. `segment-original`（新策略）
2. `speaker-sample`（现有每 speaker 样本）
3. `indexttsReferenceAudio`（全局手填）
4. 不传 `reference_audio`

### 数据与缓存

#### 分段参考片段缓存

- 建议缓存键：`speaker-start-end-window-policy`
- 建议路径：`<workDir>/.tts-temp/reference-clips/`

#### TTS 缓存指纹

现有指纹需要纳入新策略字段，避免切换模式后误命中旧缓存：

- `ttsMode`
- `syncMode`
- `speakerProfiles`
- `indexttsReferenceMode`（新增）

### 失败处理

1. 分段参考提取失败：记录 warning，自动回退，不中断整条流水线。
2. 校验失败（短/静音/不稳定）：同上回退。
3. IndexTTS 请求失败：沿用现有重试与错误归类逻辑。

## 验收标准

1. `segment-original` 模式下，正常单说话人片段可稳定使用分段原音作为参考。
2. 多说话人重叠场景不会出现跨 speaker 参考污染（触发回退）。
3. 极短段与静音段不会向 IndexTTS 发送无效参考音。
4. 切换 `speaker-sample` / `segment-original` 后，TTS 缓存不会误命中。
5. 默认配置（`speaker-sample`）行为与当前版本一致。

## 后续可选（非 P0）

1. 将远端 IndexTTS 服务的“参考音路径可访问性”做成显式能力探测与提示。
2. 把参考音策略抽象为通用接口，复用于其他支持 reference 的 TTS 后端。
