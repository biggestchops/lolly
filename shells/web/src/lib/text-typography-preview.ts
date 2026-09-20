// SPDX-License-Identifier: MPL-2.0
/** A selected word preview shares the production composer and exact font pins. */
import type { TextCharacterV1, TextDocumentV1, TextLayoutRequestV1, TextLayoutV1, TextRangeV1, TextStoryV1 } from '@lolly-tools/core';
import { createTextStory, defaultTextFrameSettings, textSemanticSource, snapTextRange, textStyleResolver } from '@lolly/engine';
export async function textTypographyPreview(document:TextDocumentV1,story:TextStoryV1,range:TextRangeV1,character:TextCharacterV1,layout:(request:TextLayoutRequestV1)=>Promise<TextLayoutV1>){
  let selected=range;
  if(range.start===range.end){const words=[...new Intl.Segmenter(undefined,{granularity:'word'}).segment(story.source)];const word=words.find(word=>word.isWordLike&&word.index<=range.start&&word.index+word.segment.length>=range.start);selected=word?{start:word.index,end:word.index+word.segment.length}:{start:0,end:Math.min(story.source.length,64)};}
  selected=snapTextRange(story.source,{start:selected.start,end:Math.min(selected.end,selected.start+256)});
  const source=textSemanticSource(story,selected).source.replace(/[\r\n\u2028\u2029]/g,' '),preview=createTextStory('type-preview',source||'Ag 0123',index=>`preview-${index}`);
  const paragraph=story.paragraphs.find(paragraph=>paragraph.start<=selected.start&&paragraph.end>=selected.start)??story.paragraphs[0]!;
  const language=textStyleResolver(document).paragraph(story,paragraph).language;
  preview.frameIds=['type-preview-frame'];preview.defaultStyle='type-preview-style';
  const value=await layout({document:{...document,stories:[preview],styles:[{id:'type-preview-style',kind:'paragraph',name:'Preview',paragraph:{character,...(language?{language}:{})}}]},storyId:preview.id,frames:[{...defaultTextFrameSettings('auto-width'),id:preview.frameIds[0]!,storyId:preview.id,width:600,height:100}],includeSvg:true});
  return value.frames[0]?.svg??'';
}
