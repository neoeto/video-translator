import { accessSync, constants as fsConstants } from 'node:fs'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppConfig, SpeakerGender, SpeakerProfile, SynthesizerStrategy, SynthesisResult, TranslatedSegment, TranslationLanguage } from '../../types.js'
import {
  buildTimeline, createSilenceFile,
  sleep, toErrorMessage,
  MAX_TTS_RETRIES, INITIAL_TTS_BACKOFF_MS,
} from './tts-helpers.js'

// 为各目标语言提供按性别分组的 Edge TTS 音色池。
const VOICE_POOLS: Record<string, Record<SpeakerGender, string[]>> = {
  zh: {
    'adult-male': ['zh-CN-YunxiNeural', 'zh-CN-YunjianNeural', 'zh-CN-YunyangNeural'],
    'adult-female': ['zh-CN-XiaoxiaoNeural', 'zh-CN-XiaoyiNeural', 'zh-CN-XiaozhenNeural'],
    'child-male': ['zh-CN-YunxiNeural'],
    'child-female': ['zh-CN-XiaoxiaoNeural'],
  },
  en: {
    'adult-male': ['en-US-GuyNeural', 'en-US-ChristopherNeural', 'en-US-EricNeural'],
    'adult-female': ['en-US-JennyNeural', 'en-US-AriaNeural', 'en-US-SaraNeural'],
    'child-male': ['en-US-GuyNeural'],
    'child-female': ['en-US-JennyNeural'],
  },
  ja: {
    'adult-male': ['ja-JP-KeitaNeural'],
    'adult-female': ['ja-JP-NanamiNeural'],
    'child-male': ['ja-JP-KeitaNeural'],
    'child-female': ['ja-JP-NanamiNeural'],
  },
  ko: {
    'adult-male': ['ko-KR-InJoonNeural'],
    'adult-female': ['ko-KR-SunHiNeural'],
    'child-male': ['ko-KR-InJoonNeural'],
    'child-female': ['ko-KR-SunHiNeural'],
  },
  fr: {
    'adult-male': ['fr-FR-HenriNeural'],
    'adult-female': ['fr-FR-DeniseNeural'],
    'child-male': ['fr-FR-HenriNeural'],
    'child-female': ['fr-FR-DeniseNeural'],
  },
  de: {
    'adult-male': ['de-DE-ConradNeural'],
    'adult-female': ['de-DE-KatjaNeural'],
    'child-male': ['de-DE-ConradNeural'],
    'child-female': ['de-DE-KatjaNeural'],
  },
  es: {
    'adult-male': ['es-ES-AlvaroNeural'],
    'adult-female': ['es-ES-ElviraNeural'],
    'child-male': ['es-ES-AlvaroNeural'],
    'child-female': ['es-ES-ElviraNeural'],
  },
  pt: {
    'adult-male': ['pt-BR-AntonioNeural'],
    'adult-female': ['pt-BR-FranciscaNeural'],
    'child-male': ['pt-BR-AntonioNeural'],
    'child-female': ['pt-BR-FranciscaNeural'],
  },
  ru: {
    'adult-male': ['ru-RU-DmitryNeural'],
    'adult-female': ['ru-RU-SvetlanaNeural'],
    'child-male': ['ru-RU-DmitryNeural'],
    'child-female': ['ru-RU-SvetlanaNeural'],
  },
  ar: {
    'adult-male': ['ar-SA-HamedNeural'],
    'adult-female': ['ar-SA-ZariyahNeural'],
    'child-male': ['ar-SA-HamedNeural'],
    'child-female': ['ar-SA-ZariyahNeural'],
  },
  it: {
    'adult-male': ['it-IT-DiegoNeural'],
    'adult-female': ['it-IT-ElsaNeural'],
    'child-male': ['it-IT-DiegoNeural'],
    'child-female': ['it-IT-ElsaNeural'],
  },
  th: {
    'adult-male': ['th-TH-NiwatNeural'],
    'adult-female': ['th-TH-PremwadeeNeural'],
    'child-male': ['th-TH-NiwatNeural'],
    'child-female': ['th-TH-PremwadeeNeural'],
  },
  vi: {
    'adult-male': ['vi-VN-NamMinhNeural'],
    'adult-female': ['vi-VN-HoaiMyNeural'],
    'child-male': ['vi-VN-NamMinhNeural'],
    'child-female': ['vi-VN-HoaiMyNeural'],
  },
  id: {
    'adult-male': ['id-ID-ArdiNeural'],
    'adult-female': ['id-ID-GadisNeural'],
    'child-male': ['id-ID-ArdiNeural'],
    'child-female': ['id-ID-GadisNeural'],
  },
  tr: {
    'adult-male': ['tr-TR-AhmetNeural'],
    'adult-female': ['tr-TR-EmelNeural'],
    'child-male': ['tr-TR-AhmetNeural'],
    'child-female': ['tr-TR-EmelNeural'],
  },
  pl: {
    'adult-male': ['pl-PL-MarekNeural'],
    'adult-female': ['pl-PL-ZofiaNeural'],
    'child-male': ['pl-PL-MarekNeural'],
    'child-female': ['pl-PL-ZofiaNeural'],
  },
  uk: {
    'adult-male': ['uk-UA-OstapNeural'],
    'adult-female': ['uk-UA-PolinaNeural'],
    'child-male': ['uk-UA-OstapNeural'],
    'child-female': ['uk-UA-PolinaNeural'],
  },
  nl: {
    'adult-male': ['nl-NL-MaartenNeural'],
    'adult-female': ['nl-NL-ColetteNeural'],
    'child-male': ['nl-NL-MaartenNeural'],
    'child-female': ['nl-NL-ColetteNeural'],
  },
  hi: {
    'adult-male': ['hi-IN-MadhurNeural'],
    'adult-female': ['hi-IN-SwaraNeural'],
    'child-male': ['hi-IN-MadhurNeural'],
    'child-female': ['hi-IN-SwaraNeural'],
  },
}

function getVoicePoolForLanguage(lang: TranslationLanguage): Record<SpeakerGender, string[]> {
  if (lang !== 'auto' && VOICE_POOLS[lang]) {
    return VOICE_POOLS[lang]
  }
  return VOICE_POOLS.en
}

function isRetryableEdgeTtsError(error: unknown): boolean {
  const message = toErrorMessage(error)
  return /noaudioreceived|timeout|network|connection|proxy|temporar|503|502|429|websocket|econnreset|etimedout/i.test(message)
}

function detectEdgeTtsPath(config: AppConfig): string {
  if (config.localWhisperCliPath) {
    const whisperDir = path.dirname(config.localWhisperCliPath)
    const binName = process.platform === 'win32' ? 'edge-tts.exe' : 'edge-tts'
    const candidate = path.join(whisperDir, binName)
    try {
      accessSync(candidate, fsConstants.X_OK)
      console.log('[edge-tts] detected at', candidate)
      return candidate
    } catch {
      console.log('[edge-tts] not at', candidate, '- falling back to PATH')
    }
  }
  return 'edge-tts'
}

function getEdgeTtsProxy(config: AppConfig): string | null {
  if (!config.proxyEnabled) return null
  const proxyUrl = config.proxyUrl.trim()
  return proxyUrl || null
}

function buildEdgeTtsEnv(config: AppConfig): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const proxyUrl = getEdgeTtsProxy(config)
  if (proxyUrl) {
    env.HTTP_PROXY = proxyUrl
    env.HTTPS_PROXY = proxyUrl
    env.ALL_PROXY = proxyUrl
    env.http_proxy = proxyUrl
    env.https_proxy = proxyUrl
    env.all_proxy = proxyUrl
  }
  return env
}

async function runEdgeTtsCli(
  text: string,
  voice: string,
  outputFile: string,
  config: AppConfig
): Promise<void> {
  const edgeTtsPath = detectEdgeTtsPath(config)
  const textFile = `${outputFile}.txt`
  const proxyUrl = getEdgeTtsProxy(config)

  await fs.writeFile(textFile, text, 'utf8')

  const args = [`--file=${textFile}`, `--voice=${voice}`, `--rate=+0%`, `--write-media=${outputFile}`]
  if (proxyUrl) args.push(`--proxy=${proxyUrl}`)

  console.log('[edge-tts] spawn', edgeTtsPath, JSON.stringify(args))

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(edgeTtsPath, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: buildEdgeTtsEnv(config),
      })
      const stderrChunks: Buffer[] = []
      child.stderr.on('data', (chunk: Buffer) => { stderrChunks.push(chunk) })
      child.on('error', (error) => reject(error))
      child.on('close', (code) => {
        if (code === 0) { resolve(); return }
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
        reject(new Error(stderr || `edge-tts exited with code ${code}`))
      })
    })
  } finally {
    await fs.rm(textFile, { force: true }).catch(() => {})
  }
}

async function synthesizeEdgeTextToFile(
  text: string,
  outputFile: string,
  config: AppConfig,
  voice: string
): Promise<void> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_TTS_RETRIES; attempt += 1) {
    try {
      await runEdgeTtsCli(text, voice, outputFile, config)
      return
    } catch (error) {
      lastError = error
      if (!isRetryableEdgeTtsError(error) || attempt === MAX_TTS_RETRIES) throw error
      await sleep(INITIAL_TTS_BACKOFF_MS * 2 ** (attempt - 1))
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export default class EdgeTtsSynthesizer implements SynthesizerStrategy {
  readonly name = 'edge-tts'
  private readonly speakerVoiceMap = new Map<string, string>()
  private readonly genderVoiceIndex = new Map<SpeakerGender, number>()
  private readonly voicePool: Record<SpeakerGender, string[]>

  constructor(private readonly config: AppConfig) {
    this.voicePool = getVoicePoolForLanguage(config.targetLanguage)
  }

  private getVoice(speaker: string, speakerProfiles?: SpeakerProfile[]): string {
    const existing = this.speakerVoiceMap.get(speaker)
    if (existing) return existing

    const profile = speakerProfiles?.find(p => p.id === speaker)
    const gender: SpeakerGender = profile?.gender ?? 'adult-male'
    const pool = this.voicePool[gender]
    const idx = this.genderVoiceIndex.get(gender) ?? 0
    const voice = pool[idx % pool.length]
    this.genderVoiceIndex.set(gender, idx + 1)
    this.speakerVoiceMap.set(speaker, voice)
    return voice
  }

  async synthesize(input: {
    segments: TranslatedSegment[]
    workDir: string
    speakers: string[]
    speakerProfiles?: SpeakerProfile[]
    onProgress: (pct: number) => void
    signal?: AbortSignal
    syncMode?: import('../../types.js').SyncMode
  }): Promise<SynthesisResult> {
    const { segments, workDir, onProgress, signal, syncMode, speakerProfiles } = input
    const ttsWorkDir = path.join(workDir, '.tts-temp')
    await fs.mkdir(ttsWorkDir, { recursive: true })

    try {
      const result = await buildTimeline(
        segments,
        ttsWorkDir,
        async (segment, index, wd) => this.synthesizeSegment(segment, index, wd, speakerProfiles),
        onProgress,
        signal,
        syncMode,
      )
      return { audioPath: result.audioPath, segmentTimings: result.segmentTimings }
    } catch (error) {
      throw new Error(`Failed to synthesize audio: ${toErrorMessage(error)}`)
    } finally {
      await fs.rm(ttsWorkDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async synthesizeSegment(segment: TranslatedSegment, index: number, workDir: string, speakerProfiles?: SpeakerProfile[]): Promise<string> {
    const targetDuration = Math.max(0.05, segment.end - segment.start)
    const text = segment.targetText.trim() || segment.sourceText.trim()
    const rawFile = path.join(workDir, `segment-${index}-raw.mp3`)
    const voice = this.getVoice(segment.speaker, speakerProfiles)

    if (!text) {
      await createSilenceFile(targetDuration, rawFile)
      return rawFile
    }

    await synthesizeEdgeTextToFile(text, rawFile, this.config, voice)
    return rawFile
  }
}
