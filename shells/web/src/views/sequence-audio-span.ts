// SPDX-License-Identifier: MPL-2.0
import type { ClipAudio } from '../bridge/sequence-providers.ts';

export interface AudioSpan { from: number; to: number; rate: number }

/** Decode only the audible source window, using the export's decoder. */
export async function loadAudioSpan(
  url: string, span: AudioSpan, signal: AbortSignal,
  log: (level: string, message: string) => void,
): Promise<AudioBuffer | null> {
  const { createClipAudio } = await import('../bridge/sequence-providers.ts');
  if (signal.aborted) return null;
  let source: ClipAudio | null = null;
  const abort = (): void => { void source?.dispose(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    source = await createClipAudio(url, { targetSec: span.to, log });
    if (!source || signal.aborted) return null;
    const duration = source.durationSec();
    const to = duration > 0 ? Math.min(span.to, duration) : span.to;
    if (to <= span.from) return null;
    const pcm = await source.pcm(span.from, to, span.rate);
    if (signal.aborted || !pcm.channels[0]?.length) return null;
    const buffer = new AudioBuffer({ length: pcm.channels[0].length,
      numberOfChannels: pcm.channels.length, sampleRate: pcm.sampleRate });
    pcm.channels.forEach((channel, i) => { buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, i); });
    return buffer;
  } finally {
    signal.removeEventListener('abort', abort);
    await source?.dispose();
  }
}
