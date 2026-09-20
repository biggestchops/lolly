// SPDX-License-Identifier: MPL-2.0
/** Hit testing maps composed carets to the browser's native Selection. */
import type { NativeTextStop } from './text-native-dom.ts';
export function hitNativeTextStop(stops: readonly NativeTextStop[], point: {x:number;y:number}): NativeTextStop | undefined {
  let best:NativeTextStop|undefined,distance=Infinity;
  for(const stop of stops){
    const angle=stop.angle*Math.PI/180,nx=-Math.sin(angle),ny=Math.cos(angle);
    const dx=point.x-stop.x,dy=point.y-stop.y,along=Math.max(0,Math.min(stop.height,dx*nx+dy*ny));
    const score=Math.hypot(dx-nx*along,dy-ny*along);
    if(score<distance){distance=score;best=stop;}
  }
  return best;
}
/** Empty probes recover the complete ancestor transform without adding source units. */
export function nativeClientPoint(element: HTMLElement, x: number, y: number): {x:number;y:number} {
  const markers=[[0,0],[1024,0],[0,1024]].map(([left,top])=>{const span=element.ownerDocument.createElement('span');span.setAttribute('aria-hidden','true');Object.assign(span.style,{position:'absolute',width:'0',height:'0',left:`${left}px`,top:`${top}px`,pointerEvents:'none'});element.append(span);return span;});
  const [origin,right,bottom]=markers.map(marker=>marker.getBoundingClientRect());for(const marker of markers)marker.remove();
  const matrix=new DOMMatrix([(right!.x-origin!.x)/1024,(right!.y-origin!.y)/1024,(bottom!.x-origin!.x)/1024,(bottom!.y-origin!.y)/1024,origin!.x,origin!.y]);
  return new DOMPoint(x,y).matrixTransform(matrix.inverse());
}
