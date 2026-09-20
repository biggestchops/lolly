// SPDX-License-Identifier: MPL-2.0
/** The same composition service backs browser, desktop and terminal bridges. */
import type { TextAPI } from '@lolly-tools/core/host-v1';
import type { TextFontResourceV1 } from '@lolly-tools/core';
import { composeText, parseTextDocument } from '@lolly/engine';
import { textLayoutSvg } from '../../../engine/src/text-layout-svg.ts';
import type { EmojiXmlParser } from '../../../engine/src/emoji-svg.ts';
import { createTextCompositionCache } from '../../../engine/src/text-composition-cache.ts';
import { createPinnedTextShaper } from './text-fonts.ts';
export function createTextCompositionAPI(read: (font: TextFontResourceV1) => Promise<Uint8Array>, parseXml?: EmojiXmlParser): Required<Pick<TextAPI, 'fontInfo' | 'shapeRun' | 'layoutRuns'>> {
  const shaper = createPinnedTextShaper(read), cache=createTextCompositionCache();
  return { fontInfo: shaper.fontInfo, shapeRun: shaper.shapeRun, async layoutRuns(request) {
    const doc = parseTextDocument(request.document);
    const layout = await composeText({ ...request, document: doc }, shaper, cache);
    if(request.includeSvg) {
      if(!parseXml) throw new Error('This host cannot admit inline SVG artwork.');
      const story = doc.stories.find(story => story.id === request.storyId)!;
      for(const frame of layout.frames) frame.svg = await textLayoutSvg(layout, story, frame.id, parseXml);
    }
    return layout;
  } };
}
