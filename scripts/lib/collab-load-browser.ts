// SPDX-License-Identifier: MPL-2.0
import type { BrowserContext, Page } from 'playwright-core';
import assert from 'node:assert/strict';

export interface LoadSpan { kind: string; start: number; end: number; sample: number; count?: number; stores?: string[] }
export interface LoadTrace { sample: number; spans: LoadSpan[] }

/** Instrument platform boundaries without adding diagnostics to the shipped application. */
export async function traceCollabBrowser(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const state: LoadTrace = { sample: -1, spans: [] };
    (window as unknown as { __collabLoadTrace: LoadTrace }).__collabLoadTrace = state;
    const now = () => performance.timeOrigin + performance.now();
    const record = (span: LoadSpan) => { if (state.spans.length < 10000) state.spans.push(span); };
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(this: IDBDatabase, ...args: Parameters<typeof transaction>) {
      const tx = transaction.apply(this, args);
      const start = now(), sample = state.sample, stores = Array.from(tx.objectStoreNames);
      tx.addEventListener('complete', () => record({ kind: `idb-${tx.mode}`, start, end: now(), sample, stores }));
      return tx;
    } as typeof transaction;
    const NativeSocket = WebSocket;
    class ObservedSocket extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (!String(url).includes('/ws/collab/')) return;
        this.addEventListener('message', event => {
          try {
            const frame = JSON.parse(String(event.data)), at = now();
            if (frame.t === 'ops' || frame.t === 'receipt') record({ kind: `ws-receive-${frame.t}`, start: at, end: at, sample: state.sample, count: frame.ops?.length });
          } catch { /* Non-JSON transport messages have no collaboration span. */ }
        });
      }
      override send(data: Parameters<WebSocket['send']>[0]): void {
        if (this.url.includes('/ws/collab/') && typeof data === 'string') {
          try {
            const frame = JSON.parse(data), at = now();
            if (frame.t === 'ops') record({ kind: 'ws-send', start: at, end: at, sample: state.sample, count: frame.ops.length });
          } catch { /* Preserve native send behavior. */ }
        }
        super.send(data);
      }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, writable: true, value: ObservedSocket });
  });
}

export async function beginCollabSample(page: Page, sample: number): Promise<void> {
  await page.evaluate(sample => { (window as unknown as { __collabLoadTrace: LoadTrace }).__collabLoadTrace.sample = sample; }, sample);
}

export async function readCollabTrace(page: Page): Promise<LoadSpan[]> {
  return page.evaluate(() => (window as unknown as { __collabLoadTrace: LoadTrace }).__collabLoadTrace.spans);
}

export async function startCpuProfile(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval', { interval: 1000 });
  await session.send('Profiler.start');
  return async () => {
    const { profile } = await session.send('Profiler.stop');
    await session.detach();
    return profile;
  };
}

/** Exercise warning freshness using a real Design edit and the normal Export panel. */
export async function verifyExportFidelity(page: Page, boxes: { id: string; [key: string]: unknown }[]) {
  const format = async (value: string) => {
    await page.locator('[data-fmt-trigger]').click();
    if (!await page.locator(`[data-fmt="${value}"]`).count()) await page.locator('[data-fmt-show-all]').click();
    await page.locator(`[data-fmt="${value}"]`).click();
  };
  await page.locator('[data-topbar="export"]').click();
  await format('png');
  const warning = page.locator('[data-fidelity-warning]');
  const blur = async (value: number) => {
    await page.evaluate(rows => {
      (window as unknown as { __lollySetInput(id: string, value: unknown): void }).__lollySetInput('boxes', rows);
    }, boxes.map(row => row.id === 'shape' ? { ...row, bgBlur: value } : row));
  };
  await blur(8);
  await warning.waitFor({ state: 'visible' });
  assert.match(await warning.innerText(), /frosted glass/);
  await blur(0);
  await warning.waitFor({ state: 'hidden' });
  await page.locator('button[data-export-close]').click();
  await blur(8);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-box-id="shape"]')!).backdropFilter.includes('8px'));
  assert.equal(await warning.isVisible(), false);
  await page.locator('[data-topbar="export"]').click();
  await warning.waitFor({ state: 'visible' });
  await format('svg');
  await warning.waitFor({ state: 'hidden' });
  await blur(0);
  await page.locator('button[data-export-close]').click();
  return { blurAppearsAfterPaint: true, clearsAfterPaint: true, refreshesOnReopen: true, svgKeepsBlur: true };
}
