import fs from 'node:fs'

import type { SubtitleStyle, TranslatedSegment } from './types.js'

const DEFAULT_VIDEO_WIDTH = 1920
const DEFAULT_VIDEO_HEIGHT = 1080

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(255, Math.max(0, Math.round(value)))
}

function normalizeHexColor(color: string): string {
  const hex = color.trim().replace(/^#/, '')
  if (hex.length === 3) {
    return hex
      .split('')
      .map((char) => char + char)
      .join('')
      .toUpperCase()
  }

  return hex.slice(0, 6).padStart(6, '0').toUpperCase()
}

function toAssColor(color: string, alpha = '00'): string {
  const hex = normalizeHexColor(color)
  const rr = hex.slice(0, 2)
  const gg = hex.slice(2, 4)
  const bb = hex.slice(4, 6)
  // ASS 颜色是 AABBGGRR，不是常见的 RRGGBB，通道顺序必须反转。
  return `&H${alpha}${bb}${gg}${rr}`
}

function opacityToAssAlpha(opacity: number): string {
  const alpha = clampByte((1 - opacity) * 255)
  return alpha.toString(16).toUpperCase().padStart(2, '0')
}

function formatTimestamp(seconds: number): string {
  const totalCentiseconds = Math.max(0, Math.round(seconds * 100))
  const centiseconds = totalCentiseconds % 100
  const totalSeconds = Math.floor(totalCentiseconds / 100)
  const secs = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const mins = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)

  return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\r?\n/g, '\\N')
}

// ─── Subtitle sentence splitting ──────────────────────────────

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

const SPLIT_PUNCTUATION = new Set([
  '。', '！', '？', '，', '、', '；', '：',
  '.', '!', '?', ',', ';', ':',
  '…', '—', '–',
])

const MAX_DISPLAY_WIDTH = 50
const PREFERRED_DISPLAY_WIDTH = 35
const MIN_DISPLAY_WIDTH = 10

interface SubtitleChunk {
  sourceText: string
  targetText: string
  start: number
  end: number
}

/**
 * Splits a text into chunks at punctuation or character count boundaries.
 * Returns split points as character indices.
 */
function findSplitPoints(text: string): number[] {
  if (displayWidth(text) <= MAX_DISPLAY_WIDTH) return []

  const points: number[] = []
  let currentWidth = 0

  for (let i = 0; i < text.length; i++) {
    currentWidth += displayWidth(text[i])
    if (currentWidth >= PREFERRED_DISPLAY_WIDTH && SPLIT_PUNCTUATION.has(text[i])) {
      points.push(i + 1)
      currentWidth = 0
    } else if (currentWidth >= MAX_DISPLAY_WIDTH) {
      // For Latin text, try to break at the last space
      if (text.includes(' ')) {
        const lastSpace = text.lastIndexOf(' ', i)
        if (lastSpace > (points.length > 0 ? points[points.length - 1] : 0)) {
          points.push(lastSpace + 1)
          currentWidth = displayWidth(text.slice(lastSpace + 1, i + 1))
          continue
        }
      }
      points.push(i + 1)
      currentWidth = 0
    }
  }

  return points
}

/**
 * Splits a translated segment into multiple subtitle chunks for display.
 * Source text determines split timing; target text is split proportionally.
 */
function splitSubtitleSegment(segment: TranslatedSegment): SubtitleChunk[] {
  const sourcePoints = findSplitPoints(segment.sourceText)

  if (sourcePoints.length === 0) {
    return [{
      sourceText: segment.sourceText,
      targetText: segment.targetText,
      start: segment.start,
      end: segment.end,
    }]
  }

  const totalDuration = segment.end - segment.start
  const sourceLen = segment.sourceText.length
  const targetLen = segment.targetText.length

  // Build source chunks
  const allSourcePoints = [0, ...sourcePoints, sourceLen]
  const chunks: SubtitleChunk[] = []

  for (let i = 0; i < allSourcePoints.length - 1; i++) {
    const srcStart = allSourcePoints[i]
    const srcEnd = allSourcePoints[i + 1]
    const sourceChunk = segment.sourceText.slice(srcStart, srcEnd).trim()
    if (!sourceChunk) continue

    // Proportional time from source character position
    const chunkTimeStart = segment.start + (srcStart / sourceLen) * totalDuration
    const chunkTimeEnd = segment.start + (srcEnd / sourceLen) * totalDuration

    // Proportional target text split
    const tgtStart = Math.round((srcStart / sourceLen) * targetLen)
    const tgtEnd = Math.round((srcEnd / sourceLen) * targetLen)
    const targetChunk = segment.targetText.slice(tgtStart, tgtEnd).trim()

    chunks.push({
      sourceText: sourceChunk,
      targetText: targetChunk || sourceChunk,
      start: chunkTimeStart,
      end: chunkTimeEnd,
    })
  }

  // Merge tiny trailing chunks
  if (chunks.length > 1 && displayWidth(chunks[chunks.length - 1].sourceText) < MIN_DISPLAY_WIDTH) {
    const last = chunks.pop()!
    const prev = chunks[chunks.length - 1]
    prev.end = last.end
    prev.sourceText = prev.sourceText + last.sourceText
    prev.targetText = prev.targetText + ' ' + last.targetText
  }

  return chunks.length > 0 ? chunks : [{
    sourceText: segment.sourceText,
    targetText: segment.targetText,
    start: segment.start,
    end: segment.end,
  }]
}

// ─── ASS generation ───────────────────────────────────────────

function positionTag(x: number, y: number): string {
  return `\\pos(${Math.round(x)},${Math.round(y)})`
}

function buildDialogueLine(
  start: number,
  end: number,
  styleName: 'Source' | 'Target',
  text: string,
  x: number,
  y: number,
  bgAlpha: string
): string {
  const overrideTags = `{${positionTag(x, y)}\\1a&H${bgAlpha}&\\4a&H${bgAlpha}&}`
  return `Dialogue: 0,${formatTimestamp(start)},${formatTimestamp(end)},${styleName},,0,0,0,,${overrideTags}${escapeAssText(text)}`
}

export function generateAss(
  translatedSegments: TranslatedSegment[],
  style: SubtitleStyle,
  videoWidth: number,
  videoHeight: number
): string {
  const width = videoWidth || DEFAULT_VIDEO_WIDTH
  const height = videoHeight || DEFAULT_VIDEO_HEIGHT
  const bgAlpha = opacityToAssAlpha(style.bgOpacity)
  const bgColorASS = toAssColor(style.bgColor, bgAlpha)
  const enColorASS = toAssColor(style.enColor)
  const cnColorASS = toAssColor(style.cnColor)

  const bottomMargin = Math.max(60, Math.round(height * 0.06))
  const lineGap = Math.max(12, Math.round(Math.max(style.enFontSize, style.cnFontSize) * 0.35))
  const sourceY = height - bottomMargin
  const targetY = sourceY - Math.max(style.enFontSize, style.cnFontSize) - lineGap
  const centerX = width / 2

  const lines = [
    '[Script Info]',
    'Title: Video Translation Subtitles',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Source,${style.fontFamily},${style.enFontSize},${enColorASS},&H000000FF,&H00000000,${bgColorASS},0,0,0,0,100,100,0,0,3,2,1,2,10,10,${bottomMargin},1`,
    `Style: Target,${style.fontFamily},${style.cnFontSize},${cnColorASS},&H000000FF,&H00000000,${bgColorASS},0,0,0,0,100,100,0,0,3,2,1,2,10,10,${bottomMargin},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...translatedSegments.flatMap((segment) =>
      splitSubtitleSegment(segment).flatMap((chunk) => [
        buildDialogueLine(chunk.start, chunk.end, 'Source', chunk.sourceText, centerX, sourceY, bgAlpha),
        buildDialogueLine(chunk.start, chunk.end, 'Target', chunk.targetText, centerX, targetY, bgAlpha),
      ])
    ),
  ]

  return lines.join('\n')
}

export function writeAssFile(
  translatedSegments: TranslatedSegment[],
  style: SubtitleStyle,
  outputPath: string,
  videoWidth?: number,
  videoHeight?: number
): void {
  const ass = generateAss(
    translatedSegments,
    style,
    videoWidth ?? DEFAULT_VIDEO_WIDTH,
    videoHeight ?? DEFAULT_VIDEO_HEIGHT
  )
  fs.writeFileSync(outputPath, ass, 'utf8')
}
