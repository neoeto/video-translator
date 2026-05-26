import fs from 'node:fs'

import type { SubtitleStyle, TranslatedSegment } from './types.js'
import { splitSegmentIntoSubtitleTracks } from './subtitle-tracks.js'

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
  // \1a = primary text alpha (always visible), \4a = background alpha
  const overrideTags = `{${positionTag(x, y)}\\4a&H${bgAlpha}&}`
  return `Dialogue: 0,${formatTimestamp(start)},${formatTimestamp(end)},${styleName},,0,0,0,,${overrideTags}${escapeAssText(text)}`
}

export function generateAss(
  translatedSegments: TranslatedSegment[],
  style: SubtitleStyle,
  videoWidth: number,
  videoHeight: number,
  minSplitWidth = 20
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

  // BorderStyle 3 = opaque box (uses BackColour as solid background).
  // BorderStyle 1 = outline + drop shadow (no background box).
  // When bgOpacity is 0 (no background wanted), use style 1 with thin outline for readability.
  const borderStyle = style.bgOpacity > 0 ? 3 : 1
  const outlineSize = style.bgOpacity > 0 ? 2 : 2
  const shadowSize = style.bgOpacity > 0 ? 1 : 0

  const lines = [
    '[Script Info]',
    'Title: Video Translation Subtitles',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Source,${style.fontFamily},${style.enFontSize},${enColorASS},&H000000FF,&H00000000,${bgColorASS},0,0,0,0,100,100,0,0,${borderStyle},${outlineSize},${shadowSize},2,10,10,${bottomMargin},1`,
    `Style: Target,${style.fontFamily},${style.cnFontSize},${cnColorASS},&H000000FF,&H00000000,${bgColorASS},0,0,0,0,100,100,0,0,${borderStyle},${outlineSize},${shadowSize},2,10,10,${bottomMargin},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...translatedSegments.flatMap((segment) => {
      const tracks = splitSegmentIntoSubtitleTracks(segment, minSplitWidth)
      return [
        ...tracks.source.map((chunk) =>
          buildDialogueLine(chunk.start, chunk.end, 'Source', chunk.text, centerX, sourceY, bgAlpha)
        ),
        ...tracks.target.map((chunk) =>
          buildDialogueLine(chunk.start, chunk.end, 'Target', chunk.text, centerX, targetY, bgAlpha)
        ),
      ]
    }),
  ]

  return lines.join('\n')
}

export function writeAssFile(
  translatedSegments: TranslatedSegment[],
  style: SubtitleStyle,
  outputPath: string,
  videoWidth?: number,
  videoHeight?: number,
  minSplitWidth = 20
): void {
  const ass = generateAss(
    translatedSegments,
    style,
    videoWidth ?? DEFAULT_VIDEO_WIDTH,
    videoHeight ?? DEFAULT_VIDEO_HEIGHT,
    minSplitWidth
  )
  fs.writeFileSync(outputPath, ass, 'utf8')
}
