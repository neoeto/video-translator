export const DEFAULT_SPLIT_WIDTH = { min: 20, max: 60 }

export function normalizeSplitWidth(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.trunc(value))
}

export function getSplitWidthInputValue(savedValue: number, draftValue: string | null): string {
  if (draftValue !== null) return draftValue
  return String(normalizeSplitWidth(savedValue, savedValue))
}

export function commitSplitWidthInput(draftValue: string | null, savedValue: number, fallback: number): number {
  if (draftValue === null) return normalizeSplitWidth(savedValue, fallback)
  if (draftValue.trim() === '') return fallback

  const parsed = Number(draftValue)
  return normalizeSplitWidth(parsed, fallback)
}

// Keep backward-compatible exports
export const DEFAULT_SUBTITLE_MIN_SPLIT_WIDTH = DEFAULT_SPLIT_WIDTH.min

export function normalizeSubtitleMinSplitWidth(value: number): number {
  return normalizeSplitWidth(value, DEFAULT_SPLIT_WIDTH.min)
}

export function getSubtitleMinSplitWidthInputValue(savedValue: number, draftValue: string | null): string {
  return getSplitWidthInputValue(savedValue, draftValue)
}

export function commitSubtitleMinSplitWidthInput(draftValue: string | null, savedValue: number): number {
  return commitSplitWidthInput(draftValue, savedValue, DEFAULT_SPLIT_WIDTH.min)
}
