import { access } from 'node:fs/promises';
import path from 'node:path';

export interface BuildUniqueOutputPathInput {
  outputDir: string;
  title: string;
  isSubtitleOnly: boolean;
  pathExists?: (candidate: string) => Promise<boolean>;
  now?: () => Date;
}

function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  return sanitized || 'translated_video';
}

function formatCollisionTimestamp(date: Date): string {
  const yy = String(date.getUTCFullYear()).slice(-2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yy}${mm}${dd}-${hh}${min}${ss}`;
}

async function defaultPathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

export async function buildUniqueOutputPath(input: BuildUniqueOutputPathInput): Promise<string> {
  const suffix = input.isSubtitleOnly ? '_subtitled' : '_translated';
  const baseName = `${sanitizeFileName(input.title)}${suffix}`;
  const pathExists = input.pathExists ?? defaultPathExists;
  const basePath = path.join(input.outputDir, `${baseName}.mp4`);

  if (!(await pathExists(basePath))) {
    return basePath;
  }

  const timestamp = formatCollisionTimestamp((input.now ?? (() => new Date()))());
  let attempt = 0;

  while (true) {
    const retrySuffix = attempt === 0 ? `_${timestamp}` : `_${timestamp}_${attempt + 1}`;
    const retryPath = path.join(input.outputDir, `${baseName}${retrySuffix}.mp4`);

    if (!(await pathExists(retryPath))) {
      return retryPath;
    }

    attempt += 1;
  }
}
