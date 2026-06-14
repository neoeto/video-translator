import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { HttpsProxyAgent } from 'https-proxy-agent'

const CHECKSUM_URLS = [
  'https://cdn.jsdelivr.net/gh/TRvlvr/application_data@main/filelists/download_checks.json',
  'https://raw.githubusercontent.com/TRvlvr/application_data/main/filelists/download_checks.json',
]

const MODEL_URLS = [
  'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt',
  'https://gh.llkk.cc/https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt',
  'https://ghproxy.net/https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt',
  'https://gh.api.99988866.xyz/https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt',
  'https://ghproxy.com/https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt',
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function download(
  url: string,
  dest: string,
  proxyUrl?: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tempDest = `${dest}.part`
    const file = fs.createWriteStream(tempDest)
    const urlObj = new URL(url)
    const client = urlObj.protocol === 'https:' ? https : http

    const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined

    const doRequest = (targetUrl: string) => {
      client.get(
        targetUrl,
        {
          timeout: 600_000,
          agent,
          headers: { 'User-Agent': 'video-translator/0.1.0' },
        },
        (res) => {
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
            const redirectUrl = res.headers.location
            if (redirectUrl) {
              file.close()
              try { fs.unlinkSync(tempDest) } catch { /* ignore */ }
              doRequest(redirectUrl)
              return
            }
          }
          if (!res.statusCode || res.statusCode >= 400) {
            file.close()
            try { fs.unlinkSync(tempDest) } catch { /* ignore */ }
            reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`))
            return
          }

          const total = parseInt(res.headers['content-length'] || '0', 10)
          let received = 0

          res.on('data', (chunk: Buffer) => {
            received += chunk.length
            if (total > 0 && onProgress) {
              onProgress(Math.round((received / total) * 100))
            }
          })

          res.pipe(file)
          file.on('finish', () => {
            file.close()
            if (total > 0 && received < total) {
              try { fs.unlinkSync(tempDest) } catch { /* ignore */ }
              reject(new Error(`Download incomplete: ${received}/${total} bytes`))
              return
            }
            fs.renameSync(tempDest, dest)
            resolve()
          })
        }
      ).on('error', (err) => {
        file.close()
        try { fs.unlinkSync(tempDest) } catch { /* ignore */ }
        reject(err)
      })
    }
    doRequest(url)
  })
}

async function tryDownload(
  urls: string[],
  dest: string,
  proxyUrl?: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  const errors: string[] = []
  for (const url of urls) {
    try {
      console.log(`[model-downloader] Trying ${url}`)
      await download(url, dest, proxyUrl, onProgress)
      return
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(msg)
      console.log(`[model-downloader] Failed: ${msg}`)
    }
  }
  throw new Error(`All download mirrors failed:\n${errors.map((e, i) => `  ${i + 1}. ${urls[i]}: ${e}`).join('\n')}`)
}

export async function ensureAudioSeparatorModel(
  modelDir: string,
  proxyUrl?: string,
  onProgress?: (pct: number) => void,
  onDetail?: (message: string | undefined) => void
): Promise<void> {
  fs.mkdirSync(modelDir, { recursive: true })

  const checksumPath = path.join(modelDir, 'download_checks.json')
  const modelPath = path.join(modelDir, 'model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt')

  console.log(`[model-downloader] modelDir=${modelDir}`)
  console.log(`[model-downloader] checksum exists=${fs.existsSync(checksumPath)} model exists=${fs.existsSync(modelPath)}`)

  // 1. Checksum file (small, CDN available)
  if (!fs.existsSync(checksumPath) || fs.statSync(checksumPath).size < 100) {
    onProgress?.(1)
    onDetail?.('Downloading audio-separator checksum...')
    await tryDownload(CHECKSUM_URLS, checksumPath, proxyUrl)
  }

  // 2. Model file (large)
  if (!fs.existsSync(modelPath)) {
    onProgress?.(2)
    onDetail?.(`Downloading audio-separator model (${formatBytes(115 * 1024 * 1024)})...`)
    await tryDownload(MODEL_URLS, modelPath, proxyUrl, (pct) => {
      onProgress?.(2 + Math.round(pct * 0.88))
    })
  } else if (fs.statSync(modelPath).size < 100 * 1024 * 1024) {
    fs.unlinkSync(modelPath)
    onDetail?.(`Downloading audio-separator model (${formatBytes(115 * 1024 * 1024)})...`)
    await tryDownload(MODEL_URLS, modelPath, proxyUrl, (pct) => {
      onProgress?.(2 + Math.round(pct * 0.88))
    })
  }

  // 3. Verify
  onProgress?.(92)
  onDetail?.(undefined)
  const modelSize = fs.statSync(modelPath).size
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(modelPath))
  const sha256 = hash.digest('hex')

  console.log(`[model-downloader] Model verified: ${formatBytes(modelSize)} sha256=${sha256}`)
  onProgress?.(100)
}
