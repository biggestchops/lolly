// SPDX-License-Identifier: MPL-2.0
import type { AssetRef } from '@lolly-tools/core/host-v1';
import type { PdfNode } from '../../../../engine/src/pdf-map.ts';
import type { DesignNode } from '../../../../engine/src/design-map.ts';
import { pdfNodeExtent, pdfNodesToSvg, windowPdfSvg } from '../../../../engine/src/pdf-svg.ts';

export interface PdfDesignNotice {
  kind: 'fixed' | 'review';
  message: string;
  object?: string;
}
export interface PdfDesignNode extends DesignNode { name: string }

/** A rectangular clip outside the text bounds has no effect on that text. */
function containsText(clip: NonNullable<PdfNode['_clips']>[number], node: PdfNode): boolean {
  const parts = clip.d.match(/[A-Za-z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || [];
  if (parts.length === 16 && parts[12] === 'L' && parts[13] === parts[1] && parts[14] === parts[2]) parts.splice(12, 3);
  if (parts.length !== 13 || parts[0] !== 'M' || parts[3] !== 'L' || parts[6] !== 'L' || parts[9] !== 'L' || !/^[zZ]$/.test(parts[12]!)) return false;
  const points = [0, 3, 6, 9].map(i => ({x:Number(parts[i + 1]), y:Number(parts[i + 2])}));
  if (!points.every((p,i) => {const q=points[(i+1)%4]!;return p.x===q.x || p.y===q.y;})) return false;
  const xs=points.map(p=>p.x), ys=points.map(p=>p.y);
  return !node.rot && node.x >= Math.min(...xs) && node.y >= Math.min(...ys)
    && node.x + node.w <= Math.max(...xs) && node.y + node.h <= Math.max(...ys);
}

/** Preserve PDF paint in SVG where the Design box model cannot express it. */
export async function pdfDesignNodes(nodes: PdfNode[], opts: {
  width: number; height: number;
  image(key: string): Promise<string | undefined>;
  store(svg: string): Promise<AssetRef>;
  notice(notice: PdfDesignNotice): void;
}): Promise<PdfDesignNode[]> {
  const result: PdfDesignNode[] = [];
  for (const original of nodes) {
    const n = {...original};
    const label = n.text?.trim().slice(0, 80) || `Artwork ${result.length + 1}`;
    if (n.kind === 'text' && n._clips?.every(clip=>containsText(clip,n))) delete n._clips;
    const fixed = !!(n._vectorPath || n._gradient || n._clips?.length || n._softMask);
    if (fixed || n.kind === 'image') {
      const images: Record<string,string> = {};
      const pending = [n]; const seen = new Set<PdfNode>();
      while (pending.length) {
        const item=pending.pop()!;if(seen.has(item))continue;seen.add(item);
        for (const key of [item._imageXObject,item._gradient?.tileKey]) {
          if (!key || images[key]) continue;
          const uri = await opts.image(key);
          if (!uri) throw new Error(`An image used by ${label} could not be decoded.`);
          images[key]=uri;
        }
        if(item._softMask)pending.push(...item._softMask.nodes);
      }
      const bounds=pdfNodeExtent(n);
      if (!bounds) throw new Error(`The bounds of ${label} could not be read.`);
      if (!(bounds.w > 0 && bounds.h > 0)) continue;
      const svg=windowPdfSvg(pdfNodesToSvg([n],{width:opts.width,height:opts.height,images}),{x:bounds.x,y:bounds.y,width:bounds.w,height:bounds.h});
      const image=await opts.store(svg);
      result.push({name:label,kind:'image',x:bounds.x,y:bounds.y,w:bounds.w,h:bounds.h,rot:0,opacity:100,fill:'',pad:0,fit:'fill',image,group:n.group});
      if (n.kind === 'text') opts.notice({kind:'review',object:label,message:'Cropped text is retained as artwork. Replace it with editable text before exposing it as an input.'});
      else if (n._clips?.length || n._softMask || n._gradient) opts.notice({kind:'fixed',object:label,message:'Clipping and effects are retained inside this image. Replace the whole image to change its artwork.'});
    } else {
      if(n.kind !== 'text' && n.w < 1 && n.h < 1) continue;
      result.push({...n,name:label,pad:0,...(n.kind==='text'?{fill:'',lineHeight:n.lineHeight||1.4}:{} )});
    }
  }
  return result.filter(n => n.kind === 'text' || Number(n.w) >= 1 || Number(n.h) >= 1);
}
