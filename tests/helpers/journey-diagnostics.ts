// SPDX-License-Identifier: MPL-2.0
/** Keep local fixture screenshots and browser messages when an app journey fails. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
export function journeyDiagnostics(context: BrowserContext, name: string) {
  const messages: Array<{ kind: string; message: string }> = [];
  const record = (kind: string, message: string): void => {
    messages.push({ kind, message: message.slice(0, 2000) });
    if (messages.length > 100) messages.shift();
  };
  const watch = (page: Page): void => {
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) record(message.type(), message.text()); });
    page.on('pageerror', error => record('pageerror', error.message));
    page.on('requestfailed', request => record('requestfailed', `${request.url()}: ${request.failure()?.errorText}`));
  };
  for (const page of context.pages()) watch(page);
  context.on('page', watch);
  return async (error: unknown): Promise<void> => {
    const directory = join('artifacts', 'browser-journeys', name);
    try {
      await mkdir(directory, { recursive: true });
      const pages: Array<{ url: string; text: string }> = [];
      for (const [i, page] of context.pages().entries()) {
        if (page.isClosed()) continue;
        pages.push({ url: page.url(), text: await page.locator('body').innerText({ timeout: 2000 }).catch(() => '') });
        await page.screenshot({ path: join(directory, `page-${i}.png`), timeout: 3000 }).catch(() => {});
      }
      await writeFile(join(directory, 'failure.json'), JSON.stringify({ error: String(error), messages, pages }, null, 2));
      console.error(`Browser journey evidence: ${directory}`);
    } catch (captureError) { console.error('Could not retain browser journey evidence:', String(captureError)); }
  };
}
