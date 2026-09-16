// SPDX-License-Identifier: MPL-2.0
/** Local generated sources only; tests the actual encoder, OPFS writes and terminal cleanup. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.LOLLY_PRESENT_TEST_URL;
const skip = origin ? false : 'Serve the web shell and set LOLLY_PRESENT_TEST_URL';
type Scenario = 'webcodecs' | 'mediarecorder' | 'memory' | 'cancel' | 'quota' | 'open-error' | 'duration' | 'source-ended';

for (const scenario of ['webcodecs', 'mediarecorder', 'memory', 'cancel', 'quota', 'open-error', 'duration', 'source-ended'] as Scenario[]) {
  test(`composed recording cleanup: ${scenario}`, { skip, timeout: 60_000 }, async () => {
    assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin!).hostname));
    const browser = await chromium.launch({ channel: 'chromium', headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.route(`${origin}/recorder-reliability`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
        <canvas width="1280" height="720"></canvas><script type="module">
        import { recordMediaSource } from '/src/bridge/recorder.ts';
        const scenario=${JSON.stringify(scenario)}, probe=window.recorderProbe={writes:0,released:0,mediaRecorders:0};
        const Recorder=MediaRecorder;window.MediaRecorder=class extends Recorder{constructor(...args){super(...args);probe.mediaRecorders++}};
        const directory=await navigator.storage.getDirectory();
        probe.files=async()=>{const names=[];for await(const name of directory.keys())if(name.startsWith('lolly-recording-'))names.push(name);return names};
        const write=FileSystemWritableFileStream.prototype.write;
        FileSystemWritableFileStream.prototype.write=function(chunk){probe.writes++;if(scenario==='quota'&&probe.writes>=3)return Promise.reject(new DOMException('Test storage full','QuotaExceededError'));return write.call(this,chunk)};
        if(scenario==='mediarecorder') window.MediaStreamTrackProcessor=undefined;
        if(scenario==='memory') Object.defineProperty(navigator,'storage',{value:{}});
        if(scenario==='open-error') FileSystemFileHandle.prototype.createWritable=async()=>{throw new DOMException('Test storage full','QuotaExceededError')};
        const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');let frame=0;
        const draw=()=>{ctx.fillStyle='#164b47';ctx.fillRect(0,0,1280,720);ctx.fillStyle='white';ctx.font='50px sans-serif';ctx.fillText('Recording '+frame++,80,120)};
        draw();const timer=setInterval(draw,33),producer=canvas.captureStream(30);
        const track=producer.getVideoTracks()[0].clone(),stream=new MediaStream([track]);
        const release=()=>{probe.released++;track.stop();clearInterval(timer)};
        try {
          const session=await recordMediaSource({stream,micActive:false,release,onSourceEnded:finish=>{probe.end=finish}},
            {source:'screen',format:'webm',audio:false,maxMs:scenario==='duration'?1200:30000});
          probe.stop=()=>session.stop();probe.cancel=()=>session.cancel();probe.started=true;
          session.finished.then(async blob=>{
            probe.bytes=blob.size;probe.type=blob.type;probe.consumer=track.readyState;probe.producer=producer.getVideoTracks()[0].readyState;
            if(blob.size){const video=document.createElement('video');video.src=URL.createObjectURL(blob);video.muted=true;await video.play();probe.width=video.videoWidth;probe.height=video.videoHeight;video.pause();URL.revokeObjectURL(video.src)}
            probe.done=true;
          });
        }catch(error){clearInterval(timer);probe.startError=error.message;probe.consumer=track.readyState;probe.producer=producer.getVideoTracks()[0].readyState;probe.done=true}
        </script>` }));
      await page.goto(`${origin}/recorder-reliability`);
      await page.waitForFunction(() => window.recorderProbe?.started || window.recorderProbe?.startError);
      if (!['quota', 'open-error', 'duration'].includes(scenario)) {
        await page.waitForTimeout(2300);
        const activeFiles = await page.evaluate(() => window.recorderProbe.files());
        assert.equal(activeFiles.filter(name => !name.endsWith('.crswap')).length, scenario === 'memory' ? 0 : 1,
          `temporary file exists during capture: ${activeFiles.join(', ')}`);
        if (scenario !== 'memory') assert.ok(await page.evaluate(() => window.recorderProbe.writes) > 0, 'encoded bytes reach disk before Stop');
        await page.evaluate(mode => {
          const probe = window.recorderProbe;
          if (mode === 'cancel') probe.cancel();
          else if (mode === 'source-ended') probe.end();
          else void probe.stop();
        }, scenario);
      }
      await page.waitForFunction(() => window.recorderProbe.done);
      const result = await page.evaluate(() => {
        const { writes, released, bytes, width, height, type, consumer, producer, startError, mediaRecorders } = window.recorderProbe;
        return { writes, released, bytes, width, height, type, consumer, producer, startError, mediaRecorders };
      });
      assert.equal(result.released, 1);
      if (scenario !== 'open-error') assert.equal(result.mediaRecorders, ['memory', 'mediarecorder'].includes(scenario) ? 1 : 0);
      assert.equal(result.consumer, 'ended'); assert.equal(result.producer, 'live');
      if (scenario === 'open-error') assert.ok(result.startError);
      else if (scenario === 'cancel' || scenario === 'quota') assert.equal(result.bytes, 0);
      else {
        assert.ok(result.bytes! > 1000); assert.equal(result.type, 'video/webm');
        assert.equal(result.width, 1280); assert.equal(result.height, 720);
      }
      // Abort removes asynchronously; wait on an actual directory read, not an async waitForFunction predicate.
      for (let i = 0; i < 50; i++) {
        if (!(await page.evaluate(() => window.recorderProbe.files())).length) break;
        await page.waitForTimeout(100);
      }
      assert.deepEqual(await page.evaluate(() => window.recorderProbe.files()), []);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}

declare global {
  interface Window {
    recorderProbe: {
      writes: number; released: number; mediaRecorders: number; started?: boolean; done?: boolean; startError?: string;
      bytes?: number; width?: number; height?: number; type?: string; consumer?: string; producer?: string;
      files(): Promise<string[]>; stop(): Promise<Blob>; cancel(): void; end(): void;
    };
  }
}
