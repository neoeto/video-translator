import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// @ts-expect-error TS5097: Node's --experimental-strip-types test runner requires the .ts specifier here.
import { assertProjectId, ensureProjectDirectories, getProjectRoot, resolveProjectRelativePath, toProjectRelativePath } from './project-paths.ts';

const testOutputDir = path.join(os.tmpdir(), 'video-translator-project-paths-test');

function assertThrows(action: () => unknown): void {
  assert.throws(action, Error);
}

test('accepts valid project IDs and rejects traversal, absolute, empty, and invalid IDs', () => {
  assert.doesNotThrow(() => assertProjectId('project_01-A'));
  assert.equal(getProjectRoot('/tmp/output', 'project_01-A'), '/tmp/output/projects/project_01-A');

  for (const projectId of ['', '.', '..', '../escape', 'project/name', '/absolute', 'has space', 'project.$']) {
    assertThrows(() => assertProjectId(projectId));
  }
  assertThrows(() => assertProjectId(undefined));
  assertThrows(() => assertProjectId(42));
});

test('resolves project-relative assets under the project root and rejects escaping paths', () => {
  assert.equal(
    resolveProjectRelativePath('/tmp/output', 'project-1', 'assets/video.mp4'),
    '/tmp/output/projects/project-1/assets/video.mp4',
  );
  assert.equal(
    resolveProjectRelativePath('/tmp/output', 'project-1', 'generated/frames/frame-01.png'),
    '/tmp/output/projects/project-1/generated/frames/frame-01.png',
  );

  for (const relativePath of ['', '..', '../outside.txt', 'assets/../outside.txt', 'assets\\..\\outside.txt', 'assets//video.mp4']) {
    assertThrows(() => resolveProjectRelativePath('/tmp/output', 'project-1', relativePath));
  }
  assertThrows(() => resolveProjectRelativePath('/tmp/output', 'project-1', '/tmp/outside.txt'));
});

test('converts an in-root file to a project-relative path and rejects outside files', () => {
  assert.equal(
    toProjectRelativePath('/tmp/output', 'project-1', '/tmp/output/projects/project-1/assets/video.mp4'),
    'assets/video.mp4',
  );
  assert.equal(
    toProjectRelativePath('/tmp/output', 'project-1', '/tmp/output/projects/project-1/generated/frames/frame.png'),
    'generated/frames/frame.png',
  );
  assertThrows(() => toProjectRelativePath('/tmp/output', 'project-1', '/tmp/output/projects/other/assets/video.mp4'));
  assertThrows(() => toProjectRelativePath('/tmp/output', 'project-1', '/tmp/output/projects/project-10/assets/video.mp4'));
});

test('creates project assets, generated, and temp directories beneath the expected root', async () => {
  await fs.rm(testOutputDir, { recursive: true, force: true });
  try {
    const dirs = await ensureProjectDirectories(testOutputDir, 'project-1');
    assert.equal(dirs.root, path.join(testOutputDir, 'projects', 'project-1'));
    for (const directory of [dirs.assets, dirs.generated, dirs.temp]) {
      const stat = await fs.stat(directory);
      assert.equal(stat.isDirectory(), true);
      assert.equal(directory.startsWith(`${dirs.root}${path.sep}`), true);
    }
  } finally {
    await fs.rm(testOutputDir, { recursive: true, force: true });
  }
});
