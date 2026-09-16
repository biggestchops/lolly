// SPDX-License-Identifier: MPL-2.0
/** Serve byte ranges so checking a long take never sends the whole file through browser automation. */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { chromium } from 'playwright';

export async function verifyPresentationRecording(file: string) {
  const { size } = await stat(file);
  const server = createServer((request, response) => {
    if (request.url !== '/clip.webm') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><video src="/clip.webm" muted playsinline controls></video>'); return;
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (start >= size || start > end) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }); response.end(); return; }
    response.writeHead(range ? 206 : 200, { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    });
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = createReadStream(file, { start, end }); stream.pipe(response);
    response.on('close', () => stream.destroy());
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Playback server did not bind');
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.locator('video').evaluate(async (video: HTMLVideoElement) => { await video.play(); });
    const decoded = await page.locator('video').evaluate(async (video: HTMLVideoElement) => {
      const frames = [];
      for (const at of [0, video.duration / 2, Math.max(0, video.duration - 2)]) {
        video.currentTime = at;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Playback frame did not arrive')), 10_000);
          video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); });
        });
        frames.push({ at: video.currentTime, width: video.videoWidth, height: video.videoHeight });
      }
      return { duration: video.duration, frames };
    });
    if (decoded.frames.some(f => f.width !== 1280 || f.height !== 720)) throw new Error('Unexpected video dimensions');
    return decoded;
  } finally {
    await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
