import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

// @ts-expect-error TS5097: Node's --experimental-strip-types test runner requires the .ts specifier here.
import { ReferenceAudioResolver, REFERENCE_RESOLVER_VERSION } from './reference-audio-resolver.ts'
import type { ResolveLogEvent } from './reference-audio-resolver.ts'
import type { SpeakerProfile, TranscriptSegment, TranslatedSegment } from '../../types.ts'

interface ExtractorCall {
  sourceAudioPath: string
  outputPath: string
  start: number
  duration: number
}

function transcript(start: number, end: number, speaker: string): TranscriptSegment {
  return { start, end, speaker, text: '' }
}

function translated(start: number, end: number, speaker: string): TranslatedSegment {
  return { start, end, speaker, sourceText: '', targetText: '' }
}

interface Harness {
  resolver: ReferenceAudioResolver
  calls: ExtractorCall[]
  logs: ResolveLogEvent[]
  cacheDir: string
}

interface HarnessOptions {
  mode?: 'speaker-sample' | 'segment-original'
  segments: TranscriptSegment[]
  speakerProfiles?: SpeakerProfile[]
  globalReference?: string
  sourceAudioPath?: string | null
  failExtraction?: boolean
  produceTinyFile?: boolean
}

async function makeHarness(opts: HarnessOptions): Promise<Harness> {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ref-resolver-test-'))
  const calls: ExtractorCall[] = []
  const logs: ResolveLogEvent[] = []
  const sourceAudioPath = opts.sourceAudioPath === undefined ? '/tmp/source.wav' : opts.sourceAudioPath ?? undefined

  const resolver = new ReferenceAudioResolver({
    mode: opts.mode ?? 'segment-original',
    speakerProfiles: opts.speakerProfiles,
    globalReference: opts.globalReference ?? '',
    sourceAudioPath: sourceAudioPath ?? undefined,
    originalSegments: opts.segments,
    cacheDir,
    logger: (event) => logs.push(event),
    extractor: async (input) => {
      calls.push(input)
      if (opts.failExtraction) {
        throw new Error('mock ffmpeg failure')
      }
      const size = opts.produceTinyFile ? 16 : 8 * 1024
      await fs.writeFile(input.outputPath, Buffer.alloc(size))
    },
  })

  return { resolver, calls, logs, cacheDir }
}

async function cleanup(h: Harness): Promise<void> {
  await fs.rm(h.cacheDir, { recursive: true, force: true })
}

test('mode=speaker-sample passes through to speaker sample without extraction', async () => {
  const h = await makeHarness({
    mode: 'speaker-sample',
    segments: [transcript(0, 5, 'A')],
    speakerProfiles: [{ id: 'A', gender: 'adult-male', samplePath: '/samples/A.wav' }],
  })
  const result = await h.resolver.resolve(translated(0, 5, 'A'), 0)
  assert.equal(result.strategy, 'speaker-sample')
  assert.equal(result.referenceAudio, '/samples/A.wav')
  assert.equal(result.fallbackReason, 'mode-disabled')
  assert.equal(h.calls.length, 0)
  await cleanup(h)
})

test('happy path: single-speaker mid-length segment extracts clip', async () => {
  const segs = [transcript(0, 4, 'A'), transcript(4, 8, 'A')]
  const h = await makeHarness({ segments: segs })
  const result = await h.resolver.resolve(translated(0, 4, 'A'), 0)
  assert.equal(result.strategy, 'segment-original')
  assert.ok(result.referenceAudio?.endsWith(`-v${REFERENCE_RESOLVER_VERSION}.wav`))
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].start, 0)
  assert.equal(h.calls[0].duration, 4)
  await cleanup(h)
})

test('short segment expands within speaker run', async () => {
  const segs = [transcript(0, 0.6, 'A'), transcript(0.6, 5, 'A')]
  const h = await makeHarness({ segments: segs })
  const result = await h.resolver.resolve(translated(0, 0.6, 'A'), 0)
  assert.equal(result.strategy, 'segment-original')
  // Expanded window duration should be >= 1.0 (min) and ideally near 2.5s, capped by run end (5s).
  assert.ok(h.calls[0].duration >= 1.0)
  assert.ok(h.calls[0].duration <= 2.6)
  // Must not exceed run boundaries (run is [0,5]).
  assert.ok(h.calls[0].start >= 0)
  assert.ok(h.calls[0].start + h.calls[0].duration <= 5.001)
  await cleanup(h)
})

test('short isolated segment that cannot expand falls back', async () => {
  // Speaker A only occupies [0, 0.4]; next segment is a different speaker.
  const segs = [transcript(0, 0.4, 'A'), transcript(0.4, 5, 'B')]
  const h = await makeHarness({
    segments: segs,
    speakerProfiles: [{ id: 'A', gender: 'adult-male', samplePath: '/samples/A.wav' }],
  })
  const result = await h.resolver.resolve(translated(0, 0.4, 'A'), 0)
  assert.equal(result.strategy, 'speaker-sample')
  assert.equal(result.fallbackReason, 'window-too-short')
  assert.equal(result.referenceAudio, '/samples/A.wav')
  assert.equal(h.calls.length, 0)
  await cleanup(h)
})

test('long segment is trimmed to 6s window centered on segment', async () => {
  const segs = [transcript(0, 10, 'A')]
  const h = await makeHarness({ segments: segs })
  const result = await h.resolver.resolve(translated(0, 10, 'A'), 0)
  assert.equal(result.strategy, 'segment-original')
  assert.equal(h.calls[0].duration, 6)
  assert.equal(h.calls[0].start, 2)
  await cleanup(h)
})

test('cross-speaker window overlap forces fallback (defensive against bad input)', async () => {
  // A segment claims to belong to A but a B segment overlaps the same time window.
  // The resolver must detect the overlap and refuse to use segment-original.
  const segs = [transcript(0, 5, 'A'), transcript(2, 3, 'B')]
  const h = await makeHarness({
    segments: segs,
    speakerProfiles: [{ id: 'A', gender: 'adult-male', samplePath: '/samples/A.wav' }],
  })
  const result = await h.resolver.resolve(translated(0, 5, 'A'), 0)
  assert.equal(result.strategy, 'speaker-sample')
  assert.equal(result.fallbackReason, 'cross-speaker-overlap')
  await cleanup(h)
})

test('falls back to global reference when no speaker profile exists', async () => {
  const segs = [transcript(0, 5, 'A')]
  const h = await makeHarness({
    mode: 'speaker-sample',
    segments: segs,
    globalReference: '/global/ref.wav',
  })
  const result = await h.resolver.resolve(translated(0, 5, 'A'), 0)
  assert.equal(result.strategy, 'global')
  assert.equal(result.referenceAudio, '/global/ref.wav')
  await cleanup(h)
})

test('falls back to none when no profile and no global reference', async () => {
  const segs = [transcript(0, 5, 'A')]
  const h = await makeHarness({ mode: 'speaker-sample', segments: segs })
  const result = await h.resolver.resolve(translated(0, 5, 'A'), 0)
  assert.equal(result.strategy, 'none')
  assert.equal(result.referenceAudio, undefined)
  await cleanup(h)
})

test('missing source audio path triggers fallback', async () => {
  const segs = [transcript(0, 5, 'A')]
  const h = await makeHarness({
    segments: segs,
    sourceAudioPath: null,
    speakerProfiles: [{ id: 'A', gender: 'adult-male', samplePath: '/samples/A.wav' }],
  })
  const result = await h.resolver.resolve(translated(0, 5, 'A'), 0)
  assert.equal(result.strategy, 'speaker-sample')
  assert.equal(result.fallbackReason, 'no-source-audio')
  assert.equal(h.calls.length, 0)
  await cleanup(h)
})

test('extraction failure degrades to speaker-sample without throwing', async () => {
  const segs = [transcript(0, 5, 'A')]
  const h = await makeHarness({
    segments: segs,
    failExtraction: true,
    speakerProfiles: [{ id: 'A', gender: 'adult-male', samplePath: '/samples/A.wav' }],
  })
  const result = await h.resolver.resolve(translated(0, 5, 'A'), 0)
  assert.equal(result.strategy, 'speaker-sample')
  assert.equal(result.fallbackReason, 'extraction-failed')
  await cleanup(h)
})

test('extracted file too small triggers fallback', async () => {
  const segs = [transcript(0, 5, 'A')]
  const h = await makeHarness({
    segments: segs,
    produceTinyFile: true,
    speakerProfiles: [{ id: 'A', gender: 'adult-male', samplePath: '/samples/A.wav' }],
  })
  const result = await h.resolver.resolve(translated(0, 5, 'A'), 0)
  assert.equal(result.strategy, 'speaker-sample')
  assert.equal(result.fallbackReason, 'invalid-output-file')
  await cleanup(h)
})

test('extracted clip is cached across calls', async () => {
  const segs = [transcript(0, 4, 'A')]
  const h = await makeHarness({ segments: segs })
  const seg = translated(0, 4, 'A')
  const r1 = await h.resolver.resolve(seg, 0)
  const r2 = await h.resolver.resolve(seg, 0)
  assert.equal(r1.referenceAudio, r2.referenceAudio)
  assert.equal(h.calls.length, 1)
  await cleanup(h)
})

test('multi-run speaker layout: each run is isolated and windows do not cross', async () => {
  // A: [0,3], B: [3,6], A: [6,9]. Segment index 2 belongs to second A run.
  const segs = [transcript(0, 3, 'A'), transcript(3, 6, 'B'), transcript(6, 9, 'A')]
  const h = await makeHarness({ segments: segs })
  const result = await h.resolver.resolve(translated(6, 9, 'A'), 2)
  assert.equal(result.strategy, 'segment-original')
  assert.ok(h.calls[0].start >= 6)
  assert.ok(h.calls[0].start + h.calls[0].duration <= 9.001)
  await cleanup(h)
})
