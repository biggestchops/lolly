// SPDX-License-Identifier: MPL-2.0
/** Generated sources only. Records sustained region capture; physical A/V latency needs a separate trial. */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyPresentationRecording } from './lib/presentation-playback.ts';

const origin = process.env.LOLLY_PRESENT_TEST_URL ?? 'http://127.0.0.1:5184';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Serve a local web shell for this probe');
const seconds = Number(process.env.LOLLY_PRESENT_SOAK_SECONDS ?? 1800);
if (!Number.isFinite(seconds) || seconds < 5 || seconds > 1800) throw new Error('Choose 5 to 1800 seconds');
const output = process.argv[2] ?? '/tmp/lolly-presentation-260/soak';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: [
  '--auto-accept-this-tab-capture', '--use-fake-device-for-media-stream',
  '--auto-select-tab-capture-source-by-title=Lolly sustained recording',
] });
const samples: object[] = [], errors: string[] = [];
const started = new Date().toISOString();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'] });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const cdp = await context.newCDPSession(page), system = await browser.newBrowserCDPSession();
  await cdp.send('Performance.enable');
  await context.route(`${origin}/presentation-soak`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <title>Lolly sustained recording</title><style>body{margin:0}canvas{display:block;width:1280px;height:720px}</style>
    <canvas width="1280" height="720"></canvas><button id="record">Record</button><button id="stop">Stop</button>
    <p>PRIVATE CONTROLS</p><script type="module">
    import { recordProduction } from '/src/views/present-production/recording.ts';
    const canvas=document.querySelector('canvas'), ctx=canvas.getContext('2d');
    const start=performance.now(); let sourceFrames=0, capturedFrames=0, lastCapture=0, maxGap=0, session;
    const original=HTMLVideoElement.prototype.requestVideoFrameCallback;
    HTMLVideoElement.prototype.requestVideoFrameCallback=function(callback){return original.call(this,(now,meta)=>{
      capturedFrames++; if(lastCapture)maxGap=Math.max(maxGap,now-lastCapture);lastCapture=now;callback(now,meta);
    })};
    const timer=setInterval(()=>{
      const t=(performance.now()-start)/1000; sourceFrames++;
      ctx.fillStyle='#164b47';ctx.fillRect(0,0,1280,720);ctx.fillStyle='white';ctx.font='54px system-ui';
      ctx.fillText('Lolly presentation '+Math.floor(t/10+1),64,110);ctx.font='32px monospace';ctx.fillText(t.toFixed(2)+' s',64,175);
      ctx.fillText('LOLLY',1080,70);ctx.fillStyle='#508030';ctx.fillRect(920,440,320,240);
      for(let y=0;y<240;y+=16){ctx.fillStyle='hsl('+((t*40+y)%360)+' 40% 50%)';ctx.fillRect(920,440+y,320,8)}
      ctx.fillStyle='#102237';ctx.fillRect(40+Math.sin(t)*12,590,600,90);ctx.fillStyle='white';ctx.fillText('Alex Presenter',64+Math.sin(t)*12,650);
    },1000/30);
    window.probe={sample:()=>({elapsed:(performance.now()-start)/1000,sourceFrames,capturedFrames,maxGap})};
    document.querySelector('#record').onclick=async()=>{try{session=await recordProduction(canvas,true,new AbortController().signal);session.finished.then(()=>{window.probe.ended=true});window.probe.recording=true}catch(e){window.probe.error=e.message}};
    document.querySelector('#stop').onclick=async()=>{try{const blob=await session.stop();clearInterval(timer);window.probe.bytes=blob.size;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='soak.webm';a.click();window.probe.done=true}catch(e){window.probe.error=e.message}};
    </script>` }));
  await page.goto(`${origin}/presentation-soak`);
  await page.locator('#record').click();
  await page.waitForFunction(() => window.probe?.recording || window.probe?.error);
  const error = await page.evaluate(() => window.probe.error);
  if (error) throw new Error(error);
  const deadline = Date.now() + seconds * 1000;
  do {
    const metrics = await cdp.send('Performance.getMetrics');
    const processes = await system.send('SystemInfo.getProcessInfo');
    const ids = processes.processInfo.map(p => String(p.id));
    const ps = await promisify(execFile)('ps', ['-o', 'pid=,rss=,%cpu=', '-p', ids.join(',')]);
    const sample = { at: new Date().toISOString(), ...await page.evaluate(() => window.probe.sample()),
      metrics: Object.fromEntries(metrics.metrics.filter(m => ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'Documents', 'TaskDuration'].includes(m.name)).map(m => [m.name, m.value])),
      processes: ps.stdout.trim().split('\n').map(line => { const [pid, rssKiB, cpu] = line.trim().split(/\s+/).map(Number); return { pid, rssKiB, cpu }; }),
    };
    samples.push(sample);
    await writeFile(`${output}/progress.json`, JSON.stringify({ started, seconds, browser: browser.version(), samples, errors }, null, 2));
    console.log(JSON.stringify(sample));
    if (await page.evaluate(() => window.probe.ended || window.probe.error)) throw new Error('Recording ended before the soak finished');
    await new Promise(resolve => setTimeout(resolve, Math.min(30_000, Math.max(0, deadline - Date.now()))));
  } while (Date.now() < deadline);
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.locator('#stop').click();
  await (await download).saveAs(`${output}/soak.webm`);
  const result = await page.evaluate(() => ({ ...window.probe.sample(), bytes: window.probe.bytes }));
  await writeFile(`${output}/capture.json`, JSON.stringify({ started, seconds, browser: browser.version(), samples, errors, result }, null, 2));
  await browser.close();
  const decoded = await verifyPresentationRecording(`${output}/soak.webm`);
  await writeFile(`${output}/result.json`, JSON.stringify({ started, finished: new Date().toISOString(), seconds, browser: browser.version(), samples, errors, result, decoded }, null, 2));
  console.log(JSON.stringify({ result, decoded, errors }));
} finally { await browser.close(); }

declare global {
  interface Window {
    probe: { recording?: boolean; error?: string; ended?: boolean; bytes?: number; sample(): { elapsed: number; sourceFrames: number; capturedFrames: number; maxGap: number } };
  }
}
