import assert from 'node:assert/strict'
import test from 'node:test'

// @ts-expect-error TS5097: Node's strip-types test runner requires the .ts specifier.
import { buildHistorySourceUrl } from './history-source-link.ts'

test('keeps the original youtube url for history entries', () => {
  assert.equal(
    buildHistorySourceUrl({
      sourceType: 'youtube',
      taskUrl: 'https://www.youtube.com/watch?v=abc123def45',
    }),
    'https://www.youtube.com/watch?v=abc123def45',
  )
})

test('keeps the original bilibili url for history entries', () => {
  assert.equal(
    buildHistorySourceUrl({
      sourceType: 'bilibili',
      taskUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
    }),
    'https://www.bilibili.com/video/BV1xx411c7mD',
  )
})

test('does not expose local file paths as source links', () => {
  assert.equal(
    buildHistorySourceUrl({
      sourceType: 'local-file',
      taskUrl: '/Users/demo/Videos/sample.mp4',
    }),
    undefined,
  )
})
