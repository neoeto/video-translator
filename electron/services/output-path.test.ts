import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-expect-error TS5097: Node's --experimental-strip-types test runner requires the .ts specifier here.
import { buildUniqueOutputPath } from './output-path.ts';

test('returns the base translated output path when no collision exists', async () => {
  const outputPath = await buildUniqueOutputPath({
    outputDir: '/tmp/out',
    title: 'Same Title',
    isSubtitleOnly: false,
    pathExists: async () => false,
    now: () => new Date('2026-05-26T09:15:30Z'),
  });

  assert.equal(outputPath, '/tmp/out/Same Title_translated.mp4');
});

test('appends YYMMDD-HHmmss when the base translated output path already exists', async () => {
  const taken = new Set(['/tmp/out/Same Title_translated.mp4']);

  const outputPath = await buildUniqueOutputPath({
    outputDir: '/tmp/out',
    title: 'Same Title',
    isSubtitleOnly: false,
    pathExists: async (candidate) => taken.has(candidate),
    now: () => new Date('2026-05-26T09:15:30Z'),
  });

  assert.equal(outputPath, '/tmp/out/Same Title_translated_260526-091530.mp4');
});

test('adds an incrementing suffix when the timestamped subtitle-only output path also exists', async () => {
  const taken = new Set([
    '/tmp/out/Same Title_subtitled.mp4',
    '/tmp/out/Same Title_subtitled_260526-091530.mp4',
  ]);

  const outputPath = await buildUniqueOutputPath({
    outputDir: '/tmp/out',
    title: 'Same Title',
    isSubtitleOnly: true,
    pathExists: async (candidate) => taken.has(candidate),
    now: () => new Date('2026-05-26T09:15:30Z'),
  });

  assert.equal(outputPath, '/tmp/out/Same Title_subtitled_260526-091530_2.mp4');
});
