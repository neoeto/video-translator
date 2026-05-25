/**
 * Fix binary paths for packaged Electron apps.
 *
 * When `asar: true` is set in electron-builder, the app is packed into a single
 * `app.asar` archive. Native binaries like ffmpeg/ffprobe must be unpacked via
 * `asarUnpack`, which copies them to `app.asar.unpacked/`. However, `require()`
 * still returns paths containing `app.asar`, and `spawn()` cannot execute files
 * from inside an asar archive (it sees a single file, not a directory → ENOTDIR).
 *
 * This function rewrites `app.asar` → `app.asar.unpacked` so that spawn/exec
 * can find the actual binaries on disk.
 */

const ASAR_RE = /app\.asar([\\/])/

export function resolvePackagedPath(p: string | null | undefined): string | null {
  if (!p) return null
  return p.replace(ASAR_RE, 'app.asar.unpacked$1')
}
