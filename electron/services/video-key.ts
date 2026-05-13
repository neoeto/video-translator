import { createHash } from 'node:crypto'

const YOUTUBE_ID_REGEX = /(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/

function extractVideoId(url: string): string | null {
  const match = url.match(YOUTUBE_ID_REGEX)
  return match ? match[1] : null
}

export function getVideoStorageKey(url: string): string {
  const videoId = extractVideoId(url)
  // YouTube ID 跨短链和长链保持稳定；非 YouTube 或异常 URL 才退回哈希避免路径冲突。
  return videoId ?? createHash('sha256').update(url).digest('hex').slice(0, 16)
}
