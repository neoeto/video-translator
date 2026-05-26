import assert from 'node:assert';
import fs from 'node:fs';
import { describe, it, beforeEach, afterEach } from 'node:test';

// Tests expect buildUniqueOutputPath to be implemented in ./output-path.ts
// and that the timestamp helper uses process.env.FIXED_TIMESTAMP when set.

const FIXED_TS = '260526-091530';

describe('buildUniqueOutputPath collisions', () => {
  let origExists: typeof fs.existsSync;

  beforeEach(() => {
    origExists = fs.existsSync;
    process.env.FIXED_TIMESTAMP = FIXED_TS;
  });

  afterEach(() => {
    fs.existsSync = origExists;
    delete process.env.FIXED_TIMESTAMP;
  });

  it('no collision => /tmp/out/Same Title_translated.mp4', async () => {
    const { buildUniqueOutputPath } = await import('./output-path.ts');
    // simulate no files existing
    fs.existsSync = () => false;
    const out = buildUniqueOutputPath({ destDir: '/tmp/out', title: 'Same Title', baseSuffix: 'translated' });
    assert.strictEqual(out, '/tmp/out/Same Title_translated.mp4');
  });

  it('base collision => /tmp/out/Same Title_translated_260526-091530.mp4', async () => {
    const { buildUniqueOutputPath } = await import('./output-path.ts');
    // first candidate (base) exists, timestamped does not
    const calls: string[] = [];
    fs.existsSync = (p: string) => {
      calls.push(p);
      if (p.endsWith('Same Title_translated.mp4')) return true;
      return false;
    };
    const out = buildUniqueOutputPath({ destDir: '/tmp/out', title: 'Same Title', baseSuffix: 'translated' });
    assert.strictEqual(out, '/tmp/out/Same Title_translated_260526-091530.mp4');
  });

  it('base + timestamp collision in subtitleOnly mode => /tmp/out/Same Title_subtitled_260526-091530_2.mp4', async () => {
    const { buildUniqueOutputPath } = await import('./output-path.ts');
    // base and timestamp exist, _2 does not
    fs.existsSync = (p: string) => {
      if (p.endsWith('Same Title_subtitled.mp4')) return true;
      if (p.endsWith('Same Title_subtitled_260526-091530.mp4')) return true;
      return false;
    };
    const out = buildUniqueOutputPath({ destDir: '/tmp/out', title: 'Same Title', baseSuffix: 'subtitled' });
    assert.strictEqual(out, '/tmp/out/Same Title_subtitled_260526-091530_2.mp4');
  });
});
