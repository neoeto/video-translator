import type { VideoSourceType } from './types.js'

interface BuildHistorySourceUrlInput {
  sourceType: VideoSourceType
  taskUrl: string
}

export function buildHistorySourceUrl(input: BuildHistorySourceUrlInput): string | undefined {
  if (input.sourceType === 'local-file') {
    return undefined
  }

  return input.taskUrl
}
