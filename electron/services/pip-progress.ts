export interface PipProgressEvent {
  id: string
  progress: number
  total: number
}

export function parsePipJsonProgress(line: string): PipProgressEvent | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null

  try {
    const obj = JSON.parse(trimmed)
    if (typeof obj.id === 'string' && typeof obj.progress === 'number' && typeof obj.total === 'number') {
      return { id: obj.id, progress: obj.progress, total: obj.total }
    }
    return null
  } catch {
    return null
  }
}

export function splitStderrLines(buffer: string, chunk: string): { lines: string[]; remainder: string } {
  const combined = buffer + chunk
  const parts = combined.split(/\r(?!\n)|\n/)
  const lines = parts.slice(0, -1)
  const remainder = parts[parts.length - 1]
  return { lines, remainder }
}

const DOWNLOADING_RE = /^Downloading\s+(\S+)\s+\((\d+(?:\.\d+)?)\s*%\)/
const COLLECTING_RE = /^Collecting\s+(\S+)/
const INSTALLING_RE = /^Installing\s+collected\s+packages:\s*(.+)/

export function parsePipTextLine(line: string): { type: 'downloading'; package: string; percent: number } | { type: 'collecting'; package: string } | { type: 'installing'; packages: string[] } | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  let m = trimmed.match(DOWNLOADING_RE)
  if (m) {
    return { type: 'downloading', package: m[1], percent: parseFloat(m[2]) }
  }

  m = trimmed.match(COLLECTING_RE)
  if (m) {
    return { type: 'collecting', package: m[1] }
  }

  m = trimmed.match(INSTALLING_RE)
  if (m) {
    const packages = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    return { type: 'installing', packages }
  }

  return null
}
