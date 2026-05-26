import fs from 'node:fs';
import path from 'node:path';

type Input = { destDir: string; title: string; baseSuffix: string };

function sanitizeTitle(title: string): string {
  // remove path separators and control chars but keep spaces for readability
  return title.replace(/[\/\0]/g, '').replace(/[\u0000-\u001F\u007F]/g, '');
}

function getTimestamp(): string {
  // Allow tests to set a deterministic timestamp
  if (process.env.FIXED_TIMESTAMP) return process.env.FIXED_TIMESTAMP;
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yy}${mm}${dd}-${hh}${min}${ss}`;
}

function pathExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch (e) {
    return false;
  }
}

export function buildUniqueOutputPath({ destDir, title, baseSuffix }: Input): string {
  const cleanTitle = sanitizeTitle(title);
  const ext = '.mp4';
  const baseName = `${cleanTitle}_${baseSuffix}`;
  const firstCandidate = path.join(destDir, `${baseName}${ext}`);
  if (!pathExists(firstCandidate)) return firstCandidate;

  const ts = getTimestamp();
  const secondCandidate = path.join(destDir, `${baseName}_${ts}${ext}`);
  if (!pathExists(secondCandidate)) return secondCandidate;

  // otherwise append numeric suffix after timestamp
  let n = 2;
  while (true) {
    const candidate = path.join(destDir, `${baseName}_${ts}_${n}${ext}`);
    if (!pathExists(candidate)) return candidate;
    n += 1;
  }
}
