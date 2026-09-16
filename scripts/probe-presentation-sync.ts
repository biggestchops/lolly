// SPDX-License-Identifier: MPL-2.0
/** Generated flashes and tones measure recording alignment without opening a physical microphone. */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { analysePresentationSync } from './lib/presentation-sync-analysis.ts';

const origin = process.env.LOLLY_PRESENT_TEST_URL ?? 'http://127.0.0.1:5184';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Serve a local shell for this probe');
const seconds = Number(process.env.LOLLY_PRESENT_SYNC_SECONDS ?? 300);
if (!Number.isFinite(seconds) || seconds < 30 || seconds > 1800) throw new Error('Choose 30 to 1800 seconds');
const output = process.argv[2] ?? '/tmp/lolly-presentation-260/sync';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: [
  '--auto-accept-this-tab-capture', '--auto-select-tab-capture-source-by-title=Lolly recording alignment',
  '--autoplay-policy=no-user-gesture-required',
] });
const started = new Date().toISOString(), errors: string[] = [], version = browser.version();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(`${origin}/presentation-sync`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <title>Lolly recording alignment</title><style>body{margin:0}canvas{display:block;width:1280px;height:720px}</style>
    <canvas width="1280" height="720"></canvas><button id="record">Record</button><button id="stop">Stop</button>
    <script type="module">
    import { recordProduction } from '/src/views/present-production/recording.ts';
    const canvas=document.querySelector('canvas'), ctx=canvas.getContext('2d');
    let audio, session, timer, first, oscillator;
    const media=navigator.mediaDevices;
    Object.defineProperty(media,'getUserMedia',{value:async constraints=>{
      if(!constraints.audio || constraints.video)throw new Error('Only generated audio is available');
      audio=new AudioContext();await audio.resume();const sink=audio.createMediaStreamDestination();
      oscillator=audio.createOscillator();oscillator.frequency.value=1000;
      const gain=audio.createGain();gain.gain.value=0;oscillator.connect(gain).connect(sink);oscillator.start();
      first=audio.currentTime+1;
      for(let at=first;at<first+${seconds + 10};at+=10){gain.gain.setValueAtTime(0.2,at);gain.gain.setValueAtTime(0,at+0.25)}
      timer=setInterval(()=>{
        const elapsed=audio.currentTime-first, bright=elapsed>=0&&elapsed%10<0.25;
        ctx.fillStyle=bright?'white':'black';ctx.fillRect(0,0,1280,720);
        ctx.fillStyle=bright?'black':'white';ctx.font='32px monospace';ctx.fillText(elapsed.toFixed(3)+' s',40,60);
      },1000/60);
      return sink.stream;
    }});
    Object.defineProperty(navigator,'mediaDevices',{value:media});
    window.syncProbe={};
    document.querySelector('#record').onclick=async()=>{try{session=await recordProduction(canvas,true,new AbortController().signal);window.syncProbe.ready=true}catch(e){window.syncProbe.error=e.message}};
    document.querySelector('#stop').onclick=async()=>{try{
      const blob=await session.stop();clearInterval(timer);oscillator.stop();await audio.close();
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='alignment.webm';a.click();
    }catch(e){window.syncProbe.error=e.message}};
    </script>` }));
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/presentation-sync`); await page.locator('#record').click();
  await page.waitForFunction(() => window.syncProbe.ready || window.syncProbe.error);
  const error = await page.evaluate(() => window.syncProbe.error); if (error) throw new Error(error);
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    console.log(JSON.stringify({ elapsed: seconds - (deadline - Date.now()) / 1000, errors }));
    await new Promise(resolve => setTimeout(resolve, Math.min(30_000, Math.max(0, deadline - Date.now()))));
  }
  const download = page.waitForEvent('download', { timeout: 120_000 }); await page.locator('#stop').click();
  await (await download).saveAs(`${output}/alignment.webm`);
} finally { await browser.close(); }

const result = await analysePresentationSync(`${output}/alignment.webm`, seconds);
await writeFile(`${output}/result.json`, JSON.stringify({ started, finished: new Date().toISOString(), seconds, browser: version, ...result, errors }, null, 2));
console.log(JSON.stringify(result));
if (!result.pass || errors.length) process.exitCode = 1;

declare global { interface Window { syncProbe: { ready?: boolean; error?: string } } }
