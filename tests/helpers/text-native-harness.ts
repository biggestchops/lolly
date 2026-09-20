// SPDX-License-Identifier: MPL-2.0
/** Real composition and native input, without the surrounding Design chrome. */
import type { TextLayoutRequestV1, TextLayoutV1, TextStoryV1 } from '@lolly-tools/core';
import { composeText } from '../../engine/src/text-layout.ts';
import { textLayoutSvg } from '../../engine/src/text-layout-svg.ts';
import { replaceStoryRange } from '../../engine/src/text-edits.ts';
import { createPinnedTextShaper } from '../../packages/node-shell/src/text-fonts.ts';
import { mountNativeText } from '../../shells/web/src/lib/text-native.ts';
export async function startTextProof(request: TextLayoutRequestV1) {
  const bytes = new Map(await Promise.all(request.document.fonts.map(async font => {
    if (font.source.kind !== 'bundled') throw new Error('This fixture requires bundled fonts.');
    const data = new Uint8Array(await (await fetch(font.source.path)).arrayBuffer());
    const face = new FontFace(`Proof_${font.id}`, data, { weight: '100 900' });
    document.fonts.add(await face.load());
    return [font.id, data] as const;
  })));
  const services = createPinnedTextShaper(async font => bytes.get(font.id)!);
  let story = request.document.stories[0]!, serial = 100, painted = -1, settled: TextLayoutV1 | null = null;
  const artwork = (request.artwork ?? []).map(item => ({ item, source: story.source.slice(item.start, item.end) }));
  const history: TextStoryV1[] = [], future: TextStoryV1[] = [], errors: string[] = [];
  document.body.innerHTML = '<div id="stage"><div id="ink" aria-hidden="true"></div><div id="editor" aria-label="Authored text"></div></div>';
  const style = document.createElement('style');
  style.textContent = 'body{margin:40px}#stage{position:relative;width:420px;height:350px;transform-origin:0 0}#ink{position:absolute;inset:0;pointer-events:none}#editor{width:420px;height:350px}';
  document.head.append(style);
  const editor = document.querySelector<HTMLElement>('#editor')!, ink = document.querySelector<HTMLElement>('#ink')!;
  async function draw() {
    request.artwork = artwork.flatMap(({ item, source }) => { const start = story.source.indexOf(source); return start < 0 ? [] : [{ ...item, start, end: start + source.length }]; });
    const layout = await composeText(request, services);
    if (layout.revision !== story.revision) return;
    const svg = await textLayoutSvg(layout, story, 'frame', source => new DOMParser().parseFromString(source, 'image/svg+xml'));
    if (layout.revision !== story.revision) return;
    settled = layout; ink.innerHTML = svg; surface.update(layout); painted = layout.revision;
  }
  function historyStep(redo: boolean) {
    const from = redo ? future : history, to = redo ? history : future, entry = from.pop();
    if (!entry) return;
    to.push(structuredClone(story)); story = { ...entry, revision: story.revision + 1 };
    request.document.stories[0] = story; void draw().catch(error => errors.push(String(error)));
  }
  const surface = mountNativeText(editor, {
    source: () => story.source, revision: () => story.revision, family: run => `Proof_${run.font.id}`,
    edit(range, source) {
      history.push(structuredClone(story)); future.length = 0;
      story = replaceStoryRange(story, range, { source }, { paragraphId: () => `p${serial++}` }).story;
      request.document.stories[0] = story; void draw().catch(error => errors.push(String(error)));
    }, history: historyStep, error: error => errors.push(String(error)),
  });
  await draw();
  return {
    surface, editor, draw, layout: () => settled!,
    state: () => ({ source: story.source, revision: story.revision, painted, errors, history: history.length, future: future.length, composing: surface.composing }),
    select: (a: number, b = a) => { editor.focus(); surface.select(a, b); },
  };
}
export type TextProof = Awaited<ReturnType<typeof startTextProof>>;
declare global { interface Window { textProof: TextProof } }
