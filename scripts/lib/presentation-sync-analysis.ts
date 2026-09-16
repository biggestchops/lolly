// SPDX-License-Identifier: MPL-2.0
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';

/** Decode marker edges; end-of-file closes pending detection intervals without a real flash or tone. */
export async function analysePresentationSync(file: string, seconds: number) {
  const run = promisify(execFile);
  const metadata = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file]);
  const duration = Number(JSON.parse(metadata.stdout).format.duration);
  if (!Number.isFinite(duration)) throw new Error('Recording has no finite duration');
  const decoded = await run('ffmpeg', ['-hide_banner', '-i', file,
    '-vf', 'crop=128:128:576:296,blackdetect=d=0.1:pix_th=0.1', '-af', 'silencedetect=n=-40dB:d=0.1', '-f', 'null', '-'], { maxBuffer: 8 * 1024 * 1024 });
  await writeFile(`${file}.decode.log`, decoded.stderr);
  const flashes = [...decoded.stderr.matchAll(/black_end:([\d.]+)/g)].map(match => Number(match[1])).filter(at => at < duration - 0.5);
  const tones = [...decoded.stderr.matchAll(/silence_end: ([\d.]+)/g)].map(match => Number(match[1])).filter(at => at < duration - 0.5);
  const offsets = flashes.map(video => {
    const audio = tones.reduce((nearest, at) => Math.abs(at - video) < Math.abs(nearest - video) ? at : nearest, Infinity);
    return { video, audio, videoMinusAudioMs: (video - audio) * 1000 };
  }).filter(sample => Math.abs(sample.videoMinusAudioMs) < 1000);
  const enough = offsets.length >= Math.floor(seconds / 10) - 1;
  const sorted = offsets.map(sample => sample.videoMinusAudioMs).sort((a, b) => a - b);
  return { method: 'Shared AudioContext clock schedules 250 ms tones and flashes every 10 seconds. FFmpeg decodes their leading edges; EOF interval closures are excluded. Generated recording alignment only.',
    duration, flashes: flashes.length, tones: tones.length, offsets,
    medianMs: sorted[Math.floor(sorted.length / 2)], minMs: sorted[0], maxMs: sorted.at(-1),
    firstToLastDriftMs: offsets.length > 1 ? offsets.at(-1)!.videoMinusAudioMs - offsets[0]!.videoMinusAudioMs : null,
    pass: enough && sorted.every(offset => Math.abs(offset) < 100) };
}
