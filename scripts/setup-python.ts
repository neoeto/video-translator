import { execSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'resources', 'python')

const PYTHON_VERSION = '3.10.11'
const PYTHON_VERSION_SHORT = '310'

const DOWNLOAD_URLS = [
  `https://registry.npmmirror.com/-/binary/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`,
  `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`,
]

const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const client = url.startsWith('https') ? https : http

    const request = (targetUrl: string) => {
      client.get(targetUrl, { timeout: 60_000 }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          const redirectUrl = res.headers.location
          if (redirectUrl) {
            request(redirectUrl)
            return
          }
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`))
          return
        }

        const total = parseInt(res.headers['content-length'] || '0', 10)
        let received = 0
        let lastLog = 0

        res.on('data', (chunk: Buffer) => {
          received += chunk.length
          const now = Date.now()
          if (now - lastLog > 2000 || received === total) {
            lastLog = now
            const pct = total > 0 ? ` (${Math.round((received / total) * 100)}%)` : ''
            console.log(`  ${formatBytes(received)}/${total > 0 ? formatBytes(total) : '???'}${pct}`)
          }
        })

        res.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve()
        })
      }).on('error', (err) => {
        try { fs.unlinkSync(dest) } catch { /* ignore */ }
        reject(err)
      }).on('timeout', () => {
        try { fs.unlinkSync(dest) } catch { /* ignore */ }
        reject(new Error(`Download timeout: ${url}`))
      })
    }
    request(url)
  })
}

async function tryDownload(urls: string[], dest: string): Promise<void> {
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    console.log(`[setup-python] Trying mirror ${i + 1}/${urls.length}: ${new URL(url).hostname}`)
    try {
      await download(url, dest)
      return
    } catch (err) {
      console.log(`[setup-python] Mirror ${i + 1} failed: ${err instanceof Error ? err.message : err}`)
      if (i < urls.length - 1) {
        console.log('[setup-python] Trying next mirror...')
      }
    }
  }
  throw new Error('All download mirrors failed')
}

async function setupPython(): Promise<void> {
  if (fs.existsSync(path.join(OUTPUT_DIR, 'python.exe'))) {
    console.log('[setup-python] Embedded Python already exists, skipping download.')
    return
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const zipPath = path.join(OUTPUT_DIR, 'python-embeddable.zip')
  const getPipPath = path.join(OUTPUT_DIR, 'get-pip.py')

  console.log(`[setup-python] Downloading Python ${PYTHON_VERSION} embeddable...`)
  await tryDownload(DOWNLOAD_URLS, zipPath)

  console.log('[setup-python] Extracting...')
  execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${OUTPUT_DIR}' -Force"`, {
    stdio: 'inherit',
  })
  fs.unlinkSync(zipPath)

  const pthFile = path.join(OUTPUT_DIR, `python${PYTHON_VERSION_SHORT}._pth`)
  console.log(`[setup-python] Modifying ${path.basename(pthFile)}...`)
  fs.writeFileSync(pthFile, [
    'Lib',
    'Lib/site-packages',
    '..',
    `python${PYTHON_VERSION_SHORT}.zip`,
    '.',
    '',
    '# import site',
  ].join('\n'), 'utf8')

  console.log('[setup-python] Downloading get-pip.py...')
  await download(GET_PIP_URL, getPipPath)

  console.log('[setup-python] Installing pip...')
  execSync(`"${path.join(OUTPUT_DIR, 'python.exe')}" "${getPipPath}" --no-warn-script-location`, {
    stdio: 'inherit',
  })
  fs.unlinkSync(getPipPath)

  console.log('[setup-python] Verifying...')
  const pipVersion = execSync(`"${path.join(OUTPUT_DIR, 'Scripts', 'pip.exe')}" --version`, {
    encoding: 'utf8',
  }).trim()
  console.log(`[setup-python] ${pipVersion}`)
  console.log('[setup-python] Done!')
}

setupPython().catch((err) => {
  console.error('[setup-python] Failed:', err)
  process.exit(1)
})
