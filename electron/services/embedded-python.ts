import fs from 'node:fs'
import path from 'node:path'

export function getEmbeddedPythonPath(): string | null {
  if (process.platform !== 'win32') return null

  const dirs = [
    process.resourcesPath ? path.join(process.resourcesPath, 'python') : null,
    path.resolve(process.cwd(), 'resources', 'python'),
  ].filter(Boolean) as string[]

  for (const dir of dirs) {
    const exe = path.join(dir, 'python.exe')
    if (fs.existsSync(exe)) return exe
  }

  return null
}

export function getEmbeddedPythonBinDir(): string | null {
  const pythonExe = getEmbeddedPythonPath()
  if (!pythonExe) return null
  const scriptsDir = path.join(path.dirname(pythonExe), 'Scripts')
  if (fs.existsSync(scriptsDir)) return scriptsDir
  return null
}
