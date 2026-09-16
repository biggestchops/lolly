// SPDX-License-Identifier: MPL-2.0
/** A live tool publishes audience content and private controls through separate mounts. */
export interface PresentationContent {
  readonly id: string;
  /** Attach a view of the same source. Removing one view cannot stop another. */
  mount(host: HTMLElement): () => void;
  controls(host: HTMLElement): () => void;
  pause(): void;
}

export function presentationSourcePage(doc: Document, source: PresentationContent): HTMLElement {
  const page = doc.createElement('div');
  page.className = 'lolly-frame-page'; page.dataset.frameId = source.id;
  page.style.width = '1280px'; page.style.height = '720px';
  const root = doc.createElement('div'); root.append(page); return root;
}
