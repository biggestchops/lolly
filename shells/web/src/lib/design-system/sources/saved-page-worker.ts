// SPDX-License-Identifier: MPL-2.0
import { extractSavedPage, type PageText } from './saved-page.ts';

self.onmessage = async (event: MessageEvent<PageText[]>) => {
  try { self.postMessage({ result: await extractSavedPage(event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'read' }); }
};
