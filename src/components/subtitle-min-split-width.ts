export const DEFAULT_SUBTITLE_MIN_SPLIT_WIDTH = 20

export function normalizeSubtitleMinSplitWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SUBTITLE_MIN_SPLIT_WIDTH
  return Math.max(0, Math.trunc(value))
}

export function getSubtitleMinSplitWidthInputValue(savedValue: number, draftValue: string | null): string {
  if (draftValue !== null) return draftValue
  return String(normalizeSubtitleMinSplitWidth(savedValue))
}

export function commitSubtitleMinSplitWidthInput(draftValue: string | null, savedValue: number): number {
  if (draftValue === null) return normalizeSubtitleMinSplitWidth(savedValue)
  if (draftValue.trim() === '') return DEFAULT_SUBTITLE_MIN_SPLIT_WIDTH

  const parsed = Number(draftValue)
  return normalizeSubtitleMinSplitWidth(parsed)
}
