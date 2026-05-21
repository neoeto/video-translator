import type {
  AppConfig,
  DownloaderStrategy,
  AudioExtractorStrategy,
  TranscriberStrategy,
  TranslatorStrategy,
  SynthesizerStrategy,
  CombinerStrategy,
  PipelineStrategies,
  VideoSourceType,
} from './types.js'

import YtDlpDownloader from './strategies/downloaders/yt-dlp.js'
import LocalFileDownloader from './strategies/downloaders/local-file.js'
import FfmpegExtractor from './strategies/extractors/ffmpeg.js'
import OpenAIApiTranscriber from './strategies/transcribers/openai-api.js'
import LocalCliTranscriber from './strategies/transcribers/local-cli.js'
import WhisperXTranscriber from './strategies/transcribers/whisperx.js'
import OpenAICompatibleTranslator from './strategies/translators/openai-compatible.js'
import EdgeTtsSynthesizer from './strategies/synthesizers/edge-tts.js'
import OpenAITtsSynthesizer from './strategies/synthesizers/openai-tts.js'
import IndexTtsSynthesizer from './strategies/synthesizers/indextts.js'
import FfmpegCombiner from './strategies/combiners/ffmpeg.js'
import FfmpegSubtitleOnlyCombiner from './strategies/combiners/ffmpeg-subtitle-only.js'

export function createDownloader(config: AppConfig, sourceType: VideoSourceType = 'youtube'): DownloaderStrategy {
  if (sourceType === 'local-file') {
    return new LocalFileDownloader(config)
  }
  // YouTube 和 Bilibili 均通过 yt-dlp 下载
  return new YtDlpDownloader(config)
}

export function createExtractor(config: AppConfig): AudioExtractorStrategy {
  return new FfmpegExtractor(config)
}

export function createTranscriber(config: AppConfig): TranscriberStrategy {
  switch (config.transcribeMode) {
    case 'local-cli':
      return new LocalCliTranscriber(config)
    case 'whisperx':
      return new WhisperXTranscriber(config)
    case 'openai':
    case 'local-api':
      return new OpenAIApiTranscriber(config)
  }
}

export function createTranslator(config: AppConfig): TranslatorStrategy {
  return new OpenAICompatibleTranslator(config)
}

export function createSynthesizer(config: AppConfig): SynthesizerStrategy {
  switch (config.ttsMode) {
    case 'openai':
      return new OpenAITtsSynthesizer(config)
    case 'indextts':
      return new IndexTtsSynthesizer(config)
    case 'edge':
      return new EdgeTtsSynthesizer(config)
  }
}

export function createCombiner(config: AppConfig): CombinerStrategy {
  if (config.pipelineMode === 'subtitleOnly') {
    return new FfmpegSubtitleOnlyCombiner(config)
  }
  return new FfmpegCombiner(config)
}

export function createPipelineStrategies(config: AppConfig, sourceType: VideoSourceType = 'youtube'): PipelineStrategies {
  return {
    downloader: createDownloader(config, sourceType),
    extractor: createExtractor(config),
    transcriber: createTranscriber(config),
    translator: createTranslator(config),
    synthesizer: createSynthesizer(config),
    combiner: createCombiner(config),
  }
}
