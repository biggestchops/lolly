// SPDX-License-Identifier: MPL-2.0
/** The native input proxy follows composed carets. It never chooses line breaks. */
import type { TextLayoutV1, TextShapedRunV1 } from '@lolly-tools/core';
import { textBoundaries } from '@lolly/engine';
import { finishNativePaint, nativePaintState } from './text-native-paint-cache.ts';
import { nativeFramePoint, nativeFrameRotation, nativeIdentity, type NativeFrameMatrix, type NativeFrameProjection } from './text-native-projection.ts';
type FontFamily = (run: TextShapedRunV1) => string;
interface Unit { start: number; end: number; x: number; y: number; width: number; height: number; rtl: boolean; size: number; font: string; axes: Record<string,number>; features: Record<string,number>; matrix: NativeFrameMatrix }
export function paintNativeText(element: HTMLElement, source: string, layout: TextLayoutV1, family: FontFamily, project?: NativeFrameProjection): void {
  const units: Unit[] = [], boundaries = [...textBoundaries(source)];
  const matrices = new Map(layout.frames.map(frame => [frame.id, project?.(frame.id)]));
  const projection = (id: string) => matrices.get(id);
  const paint = nativePaintState(element), desired: HTMLElement[] = [], fresh: HTMLElement[] = [];
  const existing = new Map([...element.children].filter(node => node.hasAttribute('data-text-start')).map(node => [(node as HTMLElement).dataset.textStart, node as HTMLElement]));
  const hidden=layout.lines.filter(line=>projection(line.frameId)===null);
  for (const line of layout.lines) {
    if(projection(line.frameId)===null)continue;
    const matrix = projection(line.frameId) ?? nativeIdentity;
    const scale=layout.frames.find(frame=>frame.id===line.frameId)?.appliedScale??1;
    if (line.start === line.end) {
      const caret = line.carets[0]!;
      units.push({ start:line.start,end:line.end,x:line.path?0:caret.x,y:line.path?0:line.y,width:0,height:line.height,rtl:line.direction==='rtl',size:Math.max(1,line.height/1.2),font:'sans-serif',axes:{},features:{},matrix:line.path?nativeFrameRotation(matrix,caret.x,caret.y,caret.angle):matrix });
    }
    for (const run of line.runs) for (const cluster of run.shape.clusters) {
      for (let index = 1; index < cluster.carets.length; index++) {
        const a = cluster.carets[index-1]!, b = cluster.carets[index]!;
        units.push({ start:a.offset,end:b.offset,x:line.path?Math.min(a.x,b.x):run.x+Math.min(a.x,b.x),y:line.path?-line.baseline+(run.character.baselineShift??0)*scale:line.y,width:Math.abs(b.x-a.x),height:line.height,
          rtl:run.shape.direction==='rtl',size:run.shape.size,font:family(run.shape),axes:run.shape.font.axes,features:run.shape.font.features,matrix:line.path?nativeFrameRotation(matrix,run.x,run.y,run.angle):matrix });
      }
    }
    for (const inline of line.inlines) {
      const end = boundaries[boundaries.indexOf(inline.offset)+1] ?? inline.offset;
      units.push({ start:inline.offset,end,x:line.path?0:inline.x,y:line.path?(inline.ascent??0)-line.baseline+(inline.baselineShift??0):line.y,width:inline.advance,height:line.height,rtl:(inline.direction??line.direction)==='rtl',size:line.height,font:'sans-serif',axes:{},features:{},matrix:line.path?nativeFrameRotation(matrix,inline.x,inline.y,inline.angle):matrix });
    }
  }
  const byStart = new Map(units.map(unit=>[unit.start,unit]));
  const stops = layout.lines.filter(line=>projection(line.frameId)!==null).flatMap(line=>line.carets.map(caret=>({...caret,matrix:projection(line.frameId) ?? nativeIdentity})));
  if (layout.lines.some(line => line.start === source.length && line.end === source.length)) boundaries.push(source.length);
  for (let index=1;index<boundaries.length;index++) {
    const start=boundaries[index-1]!,end=boundaries[index]!;
    let unit=byStart.get(start);
    if (!unit) {
      const caret=stops.find(stop=>stop.offset===start) ?? stops.findLast(stop=>stop.offset<=start) ?? {x:0,y:0,height:20};
      unit={start,end,x:caret.x,y:caret.y,width:0,height:caret.height,rtl:false,size:16,font:'sans-serif',axes:{},features:{},matrix:'matrix' in caret ? caret.matrix : nativeIdentity};
    }
    const literal = source.slice(start,end), clipped = hidden.some(line=>start>=line.start && start<line.end);
    const paintKey = JSON.stringify([{ ...unit, matrix: [unit.matrix.a, unit.matrix.b, unit.matrix.c, unit.matrix.d, unit.matrix.e, unit.matrix.f] }, literal, clipped, paint.context]);
    const previous = existing.get(String(start));
    if (previous && paint.keys.get(previous) === paintKey && previous.textContent === literal && previous.style.color === 'transparent') { desired.push(previous); continue; }
    const span=element.ownerDocument.createElement('span'); span.dataset.textStart=String(start); span.dataset.textEnd=String(end);
    const mark:Record<string,string>={' ':'·','\u00a0':'⍽','\u202f':'⍽','\u2009':'·','\u200b':'¦','\u2060':'‿','\u00ad':'¬','\t':'→','\n':'¶','\r':'¶','\r\n':'¶','\u2028':'↵','\u2029':'¶'};
    const symbol=mark[source.slice(start,end)];if(symbol)span.dataset.textMark=symbol;
    span.dir='ltr';
    if(clipped){span.dataset.textHidden='';span.style.clipPath='inset(50%)';span.style.pointerEvents='none';}
    const ink=element.ownerDocument.createElement('span');ink.dir=unit.rtl?'rtl':'ltr';ink.dataset.textInk='';ink.append(element.ownerDocument.createTextNode(source.slice(start,end)));
    if(start===end)ink.append(element.ownerDocument.createElement('br'));
    ink.style.display='inline-block';ink.style.transformOrigin='0 0';span.append(ink);
    Object.assign(span.style,{display:'inline-block',position:'relative',verticalAlign:'top',width:'0px',height:`${unit.height}px`,lineHeight:`${unit.height}px`,fontFamily:unit.font,
      fontSize:`${unit.size}px`,fontVariationSettings:Object.entries(unit.axes).map(([tag,value])=>`"${tag}" ${value}`).join(',') || 'normal',
      fontFeatureSettings:Object.entries(unit.features).map(([tag,value])=>`"${tag}" ${value}`).join(',') || 'normal',whiteSpace:'pre',transformOrigin:'0 0',color:'transparent'});
    const point = nativeFramePoint(unit.matrix,unit.x,unit.y);
    span.dataset.textAdvance=String(unit.width); span.dataset.textX=String(point.x); span.dataset.textY=String(point.y);
    span.dataset.textDx=String(unit.matrix.a*unit.width); span.dataset.textDy=String(unit.matrix.b*unit.width);
    span.dataset.textMatrix=`matrix(${unit.matrix.a},${unit.matrix.b},${unit.matrix.c},${unit.matrix.d},${point.x},${point.y})`;
    paint.keys.set(span, paintKey); desired.push(span); fresh.push(span);
  }
  finishNativePaint(element, desired, fresh, paint);
}
