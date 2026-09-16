// SPDX-License-Identifier: MPL-2.0
/** Real guarded patch versus full DOM replacement, including synchronous layout.
 * node scripts/bench-canvas-translation.ts [--json=/absolute/report.json]
 * This isolates paint cost; it excludes engine hydration and template scripts.
 */
import { writeFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const output = process.argv.find(arg => arg.startsWith('--json='))?.slice(7);
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../shells/web/src/views/canvas-translation.ts', import.meta.url))],
  bundle: true, write: false, format: 'iife', globalName: 'translationProbe', platform: 'browser',
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<style>#surface{position:relative;width:4000px;height:4000px;contain:layout}.lolly-box{position:absolute;width:120px;height:80px;border-radius:8px;background:#cdd;font:13px system-ui;padding:6px}</style><div id="surface"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const rows = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('#surface')!;
    const { patchCanvasTranslations } = (window as unknown as { translationProbe: { patchCanvasTranslations(root: HTMLElement, before: string, after: string, plan: Array<{ id: string; x: number; y: number }>): boolean } }).translationProbe;
    const summarize = (samples: number[]) => {
      const sorted = samples.slice().sort((a, b) => a - b);
      return { medianMs: sorted[sorted.length >> 1], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], samples };
    };
    return [100, 1000, 5000].map(count => {
      const parts = Array.from({ length: count }, (_, i) => `<div class="lolly-box" data-box-id="b${i}" style="left:${i % 30 * 125}px;top:${Math.floor(i / 30) * 85}px"><span>Label ${i}</span></div>`);
      const before = parts.join('');
      const full: number[] = [], guarded: number[] = [];
      for (let run = 0; run < 12; run++) {
        const after = `<div class="lolly-box" data-box-id="b0" style="left:${run + 1}px;top:0px"><span>Label 0</span></div>` + parts.slice(1).join('');
        for (const mode of run % 2 ? ['guarded', 'full'] : ['full', 'guarded']) {
          host.innerHTML = before;
          void host.offsetHeight;
          const oldNode = host.firstElementChild;
          const start = performance.now();
          if (mode === 'full') host.innerHTML = after;
          else if (!patchCanvasTranslations(host, before, after, [{ id: 'b0', x: run + 1, y: 0 }])) throw new Error('Guarded patch refused fixture');
          void host.offsetHeight;
          const elapsed = performance.now() - start;
          if (mode === 'guarded' && host.firstElementChild !== oldNode) throw new Error('Patch remounted content');
          if (run >= 2) (mode === 'full' ? full : guarded).push(elapsed);
        }
      }
      return { count, full: summarize(full), guarded: summarize(guarded) };
    });
  });
  const report = { generated: new Date().toISOString(), environment: { node: process.version, browser: browser.version(), platform: platform(), arch: arch(), cpu: cpus()[0]?.model }, note: 'Ten local samples after two warmups, alternating order. Concurrent machine load is uncontrolled. No engine hydration or template-script cost.', rows };
  console.log(JSON.stringify(report, null, 2));
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
} finally { await browser.close(); }
