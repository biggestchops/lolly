// SPDX-License-Identifier: MPL-2.0
/** Frame-local composition maps into one continuous native source surface. */
export interface NativeFrameMatrix { a:number; b:number; c:number; d:number; e:number; f:number }
export type NativeFrameProjection = (frameId: string) => NativeFrameMatrix | null | undefined;
export const nativeIdentity: NativeFrameMatrix = {a:1,b:0,c:0,d:1,e:0,f:0};
export function nativeFramePoint(matrix: NativeFrameMatrix, x: number, y: number) {return {x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f};}

export function nativeFrameRotation(matrix: NativeFrameMatrix, x:number, y:number, angle:number): NativeFrameMatrix {
  const radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians),origin=nativeFramePoint(matrix,x,y);
  return {a:matrix.a*c+matrix.c*s,b:matrix.b*c+matrix.d*s,c:-matrix.a*s+matrix.c*c,d:-matrix.b*s+matrix.d*c,e:origin.x,f:origin.y};
}
