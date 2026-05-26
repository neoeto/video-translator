export interface SubtitleTrackSegmentInput {
  sourceText: string
  targetText: string
  start: number
  end: number
}

export interface TimedSubtitleText {
  text: string
  start: number
  end: number
}

export interface SubtitleTracks {
  source: TimedSubtitleText[]
  target: TimedSubtitleText[]
}

const SPLIT_PUNCTUATION = new Set([
  '。', '！', '？', '，', '、', '；', '：',
  '.', '!', '?', ',', ';', ':',
  '…', '—', '–',
])

function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0x3040 && code <= 0x309F) ||
      (code >= 0x30A0 && code <= 0x30FF) ||
      (code >= 0xAC00 && code <= 0xD7AF) ||
      (code >= 0xFF01 && code <= 0xFF60) ||
      (code >= 0xFE30 && code <= 0xFE4F)
    ) {
      width += 2
    } else {
      width += 1
    }
  }
  return width
}

function splitAtPunctuation(text: string, minSplitWidth: number): string[] {
  const parts: string[] = []
  let current = ''

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    current += char
    if (SPLIT_PUNCTUATION.has(char)) {
      if (char === '.' && i + 1 < text.length && !/\s/.test(text[i + 1])) {
        continue
      }
      if (current.trim() && displayWidth(current.trim()) >= minSplitWidth) {
        parts.push(current)
        current = ''
      }
    }
  }

  if (current.trim()) {
    if (parts.length > 0 && displayWidth(current.trim()) < minSplitWidth) {
      parts[parts.length - 1] += current
    } else {
      parts.push(current)
    }
  }

  return parts.length > 0 ? parts : [text]
}

function splitTextIntoTimedChunks(text: string, start: number, end: number, minSplitWidth: number): TimedSubtitleText[] {
  const trimmedText = text.trim()
  const parts = splitAtPunctuation(trimmedText, minSplitWidth)

  if (parts.length <= 1) {
    return [{ text: trimmedText, start, end }]
  }

  const totalDuration = end - start
  const totalLength = trimmedText.length
  const chunks: TimedSubtitleText[] = []
  let charPos = 0

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim()
    if (!part) continue

    const timeStart = totalLength > 0
      ? start + (charPos / totalLength) * totalDuration
      : start
    charPos += parts[i].length
    const timeEnd = i === parts.length - 1
      ? end
      : totalLength > 0
        ? start + (charPos / totalLength) * totalDuration
        : end

    chunks.push({ text: part, start: timeStart, end: timeEnd })
  }

  return chunks.length > 0 ? chunks : [{ text: trimmedText, start, end }]
}

export function splitSegmentIntoSubtitleTracks(
  segment: SubtitleTrackSegmentInput,
  minSplitWidth: number,
): SubtitleTracks {
  const sourceText = segment.sourceText.trim() || segment.targetText.trim()
  const targetText = segment.targetText.trim() || segment.sourceText.trim()

  return {
    source: splitTextIntoTimedChunks(sourceText, segment.start, segment.end, minSplitWidth),
    target: splitTextIntoTimedChunks(targetText, segment.start, segment.end, minSplitWidth),
  }
}
