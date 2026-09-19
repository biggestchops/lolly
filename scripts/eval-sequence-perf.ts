// SPDX-License-Identifier: MPL-2.0
/**
 * Measure the sequence PREVIEW in a real browser (plans/268 SI-00).
 *
 *   pnpm run eval:sequence-perf                 # bundled Chromium
 *   LOLLY_BROWSER_CHANNEL=chrome pnpm run eval:sequence-perf
 *   pnpm run eval:sequence-perf -- --json       # machine-readable, for a before/after diff
 *   pnpm run eval:sequence-perf -- --clip=/path/to/footage.mp4
 *                                               # drift seeks against a real file (64 MB at most;
 *                                               # an mp4 needs LOLLY_BROWSER_CHANNEL=chrome)
 *
 * It is a REPORT, not a test. The numbers belong to the machine and to the load it is
 * under, so nothing here can pass or fail and it is not part of `pnpm test`. Run it
 * before and after a change to the preview clock and compare.
 *
 * The preview under measure is the real `createSequenceClock` over the same synthetic
 * stage the export tier uses. Every source frame carries its own number as a binary
 * code, so each measure counts FRAMES and does not depend on the display rate:
 *
 *   scrub to pixel   display frames that pass between a seek and the right picture
 *   across a cut     display frames that are late or blank while playing over a junction
 *   session decay    the same cut played again and again: does the last pass do worse?
 *   drift seeks      corrective `currentTime` writes per second at each clip speed.
 *                    Steady playback needs none. This is the baseline SI-03 asks for.
 */
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { openHarness, browserGate } from '../tests/helpers/sequence-browser.ts';
import { closeBrowser } from '../packages/node-shell/src/browsers.ts';

interface PerfApi {
  scrub(clip: unknown, targetsMs: number[]): Promise<{ rows: { tMs: number; want: number; got: number | null; framesMissed: number; ms: number }[] }>;
  playAcrossCut(a: unknown, b: unknown, passes: number): Promise<{ passes: { pass: number; ticks: number; late: number; blank: number; blankAfterCut: number; seekingTicks: number }[] }>;
  driftSeeks(clip: unknown, speed: number, playMs: number): Promise<{ speed: number; playedMs: number; seeks: number; seeksPerSec: number; meanDriftMs: number | null; maxDriftMs: number }>;
  adopt(base64: string, type: string): Promise<{ error: string | null; key: string; fps: number; frames: number; w: number; h: number }>;
}
interface SeqApi { perf: PerfApi; makeClip(spec: unknown): Promise<{ key: string; fps: number; frames: number }> }

const SPEEDS = [0.5, 1, 1.23, 2, 4];
const SCRUB_TARGETS_MS = [2500, 300, 1700, 4100, 900, 3300];
const DECAY_PASSES = 5;

const REAL_CLIP_MAX_BYTES = 64 * 1024 * 1024;
const MEDIA_TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska' };

const asJson = process.argv.includes('--json');
const clipArg = process.argv.find((a) => a.startsWith('--clip='))?.slice('--clip='.length);
const say = (line: string): void => { if (!asJson) console.log(line); };

const gate = browserGate();
if (gate) {
  console.error(`eval-sequence-perf: ${gate}`);
  process.exit(2);
}

const H = await openHarness();
try {
  const page = H.page;
  say(`browser: ${H.probe.ua}`);

  // 150 frames at 30 fps: five seconds, long enough that speed 4 still plays for a second.
  const [a, b] = await page.evaluate(async () => {
    const S = (window as never as { SEQ: SeqApi }).SEQ;
    const one = await S.makeClip({ frames: 150, fps: 30, w: 320, h: 240, tint: '#203040' });
    const two = await S.makeClip({ frames: 150, fps: 30, w: 320, h: 240, tint: '#402030' });
    return [one, two];
  });

  const scrub = await page.evaluate(
    async ([clip, targets]) => (window as never as { SEQ: SeqApi }).SEQ.perf.scrub(clip, targets as number[]),
    [a, SCRUB_TARGETS_MS] as const,
  );
  say('\nscrub to pixel (display frames missed before the right source frame is painted)');
  for (const r of scrub.rows) say(`  seek ${String(r.tMs).padStart(5)}ms  want #${r.want}  got #${r.got}  missed ${r.framesMissed}  ${r.ms}ms`);

  const cut = await page.evaluate(
    async ([x, y, n]) => (window as never as { SEQ: SeqApi }).SEQ.perf.playAcrossCut(x, y, n as number),
    [a, b, DECAY_PASSES] as const,
  );
  say('\nplaying across a cut, five passes (session decay is the last pass against the first)');
  for (const p of cut.passes) say(`  pass ${p.pass}: ${p.ticks} display frames, late ${p.late}, blank ${p.blank} (after the cut ${p.blankAfterCut}), seeking ${p.seekingTicks}`);

  const drift: Awaited<ReturnType<PerfApi['driftSeeks']>>[] = [];
  say('\ncorrective seeks during steady playback, by clip speed');
  for (const speed of SPEEDS) {
    const r = await page.evaluate(
      async ([clip, s]) => (window as never as { SEQ: SeqApi }).SEQ.perf.driftSeeks(clip, s as number, 2500),
      [a, speed] as const,
    );
    drift.push(r);
    say(`  speed ${String(r.speed).padEnd(4)}  ${r.seeks} seeks in ${r.playedMs}ms  = ${r.seeksPerSec}/s   drift mean ${r.meanDriftMs}ms, worst ${r.maxDriftMs}ms`);
  }

  let real: unknown = null;
  if (clipArg) {
    const size = statSync(clipArg).size;
    if (size > REAL_CLIP_MAX_BYTES) throw new Error(`--clip is ${size} bytes; the limit is ${REAL_CLIP_MAX_BYTES}`);
    const type = MEDIA_TYPES[extname(clipArg).toLowerCase()] ?? 'video/mp4';
    const adopted = await page.evaluate(
      async ([b64, t]) => (window as never as { SEQ: SeqApi }).SEQ.perf.adopt(b64 as string, t as string),
      [readFileSync(clipArg).toString('base64'), type] as const,
    );
    if (adopted.error) throw new Error(`--clip: ${adopted.error}`);
    say(`\nthe same, against ${clipArg} (${adopted.w}x${adopted.h}, ${(adopted.frames / 30).toFixed(1)}s)`);
    const rows = [];
    for (const speed of SPEEDS) {
      const r = await page.evaluate(
        async ([clip, s]) => (window as never as { SEQ: SeqApi }).SEQ.perf.driftSeeks(clip, s as number, 4000),
        [adopted, speed] as const,
      );
      rows.push(r);
      say(`  speed ${String(r.speed).padEnd(4)}  ${r.seeks} seeks in ${r.playedMs}ms  = ${r.seeksPerSec}/s   drift mean ${r.meanDriftMs}ms, worst ${r.maxDriftMs}ms`);
    }
    real = { clip: clipArg, w: adopted.w, h: adopted.h, drift: rows };
  }

  if (asJson) console.log(JSON.stringify({ ua: H.probe.ua, scrub: scrub.rows, cut: cut.passes, drift, real }, null, 2));
} finally {
  await H.close();
  await closeBrowser();
}
