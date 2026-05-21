import { createHash } from 'node:crypto'
import type { VideoSourceType } from './types.js'

const YOUTUBE_ID_REGEX = /(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/
const BILIBILI_BV_REGEX = /(?:bilibili\.com\/video\/)?(BV[a-zA-Z0-9]+)/
const BILIBILI_AV_REGEX = /(?:bilibili\.com\/video\/)?av(\d+)/

function extractYoutubeId(url: string): string | null {
  const match = url.match(YOUTUBE_ID_REGEX)
  return match ? match[1] : null
}

function extractBilibiliId(url: string): string | null {
  const bvMatch = url.match(BILIBILI_BV_REGEX)
  if (bvMatch) return bvMatch[1]
  const avMatch = url.match(BILIBILI_AV_REGEX)
  if (avMatch) return `av${avMatch[1]}`
  return null
}

function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export function getVideoStorageKey(url: string, sourceType?: VideoSourceType): string {
  if (sourceType === 'local-file') {
    return `local-${hashKey(url)}`
  }

  if (sourceType === 'bilibili') {
    const biliId = extractBilibiliId(url)
    return biliId ?? `bili-${hashKey(url)}`
  }

  // YouTube 或未指定来源类型（向后兼容）
  const youtubeId = extractYoutubeId(url)
  if (youtubeId) return youtubeId

  // 尝试 Bilibili 兼容
  const biliId = extractBilibiliId(url)
  if (biliId) return biliId

  return hashKey(url)
}
