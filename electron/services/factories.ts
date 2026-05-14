import type {
  AppConfig,
  DownloaderStrategy,
  AudioExtractorStrategy,
  TranscriberStrategy,
  TranslatorStrategy,
  SynthesizerStrategy,
  CombinerStrategy,
  PipelineStrategies,
} from './types.js'

import YtDlpDownloader from './strategies/downloaders/yt-dlp.js'
import FfmpegExtractor from './strategies/extractors/ffmpeg.js'
import OpenAIApiTranscriber from './strategies/transcribers/openai-api.js'
import LocalCliTranscriber from './strategies/transcribers/local-cli.js'
import WhisperXTranscriber from './strategies/transcribers/whisperx.js'
import OpenAICompatibleTranslator from './strategies/translators/openai-compatible.js'
import EdgeTtsSynthesizer from './strategies/synthesizers/edge-tts.js'
import OpenAITtsSynthesizer from './strategies/synthesizers/openai-tts.js'
import IndexTtsSynthesizer from './strategies/synthesizers/indextts.js'
import FfmpegCombiner from './strategies/combiners/ffmpeg.js'

export function createDownloader(config: AppConfig): DownloaderStrategy {
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
  return new FfmpegCombiner(config)
}

export function createPipelineStrategies(config: AppConfig): PipelineStrategies {
  return {
    downloader: createDownloader(config),
    extractor: createExtractor(config),
    transcriber: createTranscriber(config),
    translator: createTranslator(config),
    synthesizer: createSynthesizer(config),
    combiner: createCombiner(config),
  }
}
