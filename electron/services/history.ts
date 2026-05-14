import Store from 'electron-store'

export interface HistoryEntry {
  id: string
  videoTitle: string
  outputPath: string
  thumbnailDataUrl?: string
  completedAt: number
}

interface HistorySchema {
  entries: HistoryEntry[]
}

const store = new Store<HistorySchema>({
  name: 'history',
  defaults: { entries: [] },
})

export function getHistory(): HistoryEntry[] {
  return store.get('entries', [])
}

export function addHistoryEntry(entry: HistoryEntry): void {
  const entries = store.get('entries', [])
  entries.unshift(entry)
  store.set('entries', entries)
}

export function deleteHistoryEntry(id: string): void {
  const entries = store.get('entries', [])
  store.set('entries', entries.filter((e) => e.id !== id))
}
