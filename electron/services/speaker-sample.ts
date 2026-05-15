import { promises as fs } from 'node:fs'
import path from 'node:path'
import ffmpeg from 'fluent-ffmpeg'
import type { TranscriptSegment, SpeakerProfile, SpeakerGender } from './types.js'

const MAX_SAMPLE_DURATION = 10

export async function extractSpeakerSamples(
  audioPath: string,
  segments: TranscriptSegment[],
  workDir: string
): Promise<SpeakerProfile[]> {
  const speakerMap = new Map<string, TranscriptSegment[]>()
  for (const seg of segments) {
    const list = speakerMap.get(seg.speaker) ?? []
    list.push(seg)
    speakerMap.set(seg.speaker, list)
  }

  const profiles: SpeakerProfile[] = []
  const samplesDir = path.join(workDir, 'speaker-samples')
  await fs.mkdir(samplesDir, { recursive: true })

  for (const [speakerId, speakerSegments] of speakerMap) {
    // Find longest segment for this speaker
    let longest = speakerSegments[0]
    for (const seg of speakerSegments) {
      if (seg.end - seg.start > longest.end - longest.start) {
        longest = seg
      }
    }

    const duration = Math.min(longest.end - longest.start, MAX_SAMPLE_DURATION)
    const samplePath = path.join(samplesDir, `${speakerId}.wav`)

    await extractAudioClip(audioPath, longest.start, duration, samplePath)

    // Convert to base64 data URL for frontend playback
    const buffer = await fs.readFile(samplePath)
    const sampleDataUrl = `data:audio/wav;base64,${buffer.toString('base64')}`

    profiles.push({
      id: speakerId,
      gender: 'adult-male' as SpeakerGender, // placeholder, user will override
      samplePath,
      sampleDataUrl,
    })
  }

  return profiles
}

function extractAudioClip(
  inputPath: string,
  start: number,
  duration: number,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(start)
      .duration(duration)
      .output(outputPath)
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run()
  })
}
