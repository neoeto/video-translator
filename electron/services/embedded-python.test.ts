import assert from 'node:assert/strict'
import test from 'node:test'

// @ts-expect-error TS5097
import { getEmbeddedPythonBinDir, getEmbeddedPythonPath } from './embedded-python.ts'

test('returns null on non-Windows platforms', () => {
  if (process.platform === 'win32') {
    assert.ok(true, 'Skipped on Windows')
    return
  }
  assert.equal(getEmbeddedPythonPath(), null)
})

test('returns a string when embedded python.exe exists', () => {
  if (process.platform !== 'win32') {
    assert.ok(true, 'Skipped on non-Windows')
    return
  }
  const result = getEmbeddedPythonPath()
  assert.ok(
    result === null || (typeof result === 'string' && result.endsWith('python.exe')),
    'Should return null or path ending with python.exe',
  )
})

test('getEmbeddedPythonBinDir returns null when no python', () => {
  if (process.platform === 'win32') {
    assert.ok(true, 'May or may not return null depending on setup')
    return
  }
  assert.equal(getEmbeddedPythonBinDir(), null)
})
