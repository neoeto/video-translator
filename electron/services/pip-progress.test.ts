import assert from 'node:assert/strict'
import test from 'node:test'

// @ts-expect-error TS5097
import { parsePipJsonProgress, splitStderrLines } from './pip-progress.ts'

test('parsePipJsonProgress returns null for non-JSON lines', () => {
  assert.equal(parsePipJsonProgress('Collecting whisperx'), null)
  assert.equal(parsePipJsonProgress('Downloading some-package'), null)
  assert.equal(parsePipJsonProgress(''), null)
  assert.equal(parsePipJsonProgress('  '), null)
})

test('parsePipJsonProgress returns null for JSON without expected fields', () => {
  assert.equal(parsePipJsonProgress('{"message": "hello"}'), null)
  assert.equal(parsePipJsonProgress('{"id": "test"}'), null)
})

test('parsePipJsonProgress parses valid JSON progress', () => {
  const result = parsePipJsonProgress('{"id":"whisperx-3.1.1","progress":45,"total":100}')
  assert.deepEqual(result, { id: 'whisperx-3.1.1', progress: 45, total: 100 })
})

test('parsePipJsonProgress handles JSON with extra whitespace', () => {
  const result = parsePipJsonProgress('  {"id":"x","progress":0,"total":50}  ')
  assert.deepEqual(result, { id: 'x', progress: 0, total: 50 })
})

test('splitStderrLines splits on newlines', () => {
  const { lines, remainder } = splitStderrLines('', 'line1\nline2\npartial')
  assert.deepEqual(lines, ['line1', 'line2'])
  assert.equal(remainder, 'partial')
})

test('splitStderrLines splits on carriage return', () => {
  const { lines, remainder } = splitStderrLines('', 'line1\rline2\rpartial')
  assert.deepEqual(lines, ['line1', 'line2'])
  assert.equal(remainder, 'partial')
})

test('splitStderrLines preserves existing buffer', () => {
  const { lines, remainder } = splitStderrLines('buf', 'fer\nnext')
  assert.deepEqual(lines, ['buffer'])
  assert.equal(remainder, 'next')
})

test('splitStderrLines handles empty chunk', () => {
  const { lines, remainder } = splitStderrLines('existing', '')
  assert.deepEqual(lines, [])
  assert.equal(remainder, 'existing')
})
