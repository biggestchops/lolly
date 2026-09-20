// SPDX-License-Identifier: MPL-2.0
/** Read bounded fvar instances from the exact admitted face. */
import type { TextFontInfoV1 } from '@lolly-tools/core';
export function textFontInstances(table:Uint8Array|undefined,axes:TextFontInfoV1['axes'],name:(id:number)=>string):NonNullable<TextFontInfoV1['instances']>{
  if(!table||table.length<16)return [];
  const view=new DataView(table.buffer,table.byteOffset,table.byteLength),offset=view.getUint16(4),axisCount=view.getUint16(8),axisSize=view.getUint16(10),count=view.getUint16(12),size=view.getUint16(14);
  if(view.getUint16(0)!==1||axisCount>64||axisSize<20||count>1024||size<4+axisCount*4||offset+axisCount*axisSize+count*size>table.length)return [];
  const tags=Array.from({length:axisCount},(_,index)=>String.fromCharCode(...table.subarray(offset+index*axisSize,offset+index*axisSize+4)));
  return Array.from({length:count},(_,index)=>{const at=offset+axisCount*axisSize+index*size,coordinates=Object.fromEntries(tags.map((tag,index)=>[tag,view.getInt32(at+4+index*4)/65536]));return {name:name(view.getUint16(at)),axes:coordinates};}).filter(instance=>instance.name&&Object.entries(instance.axes).every(([tag,value])=>axes[tag]&&value>=axes[tag]!.min&&value<=axes[tag]!.max));
}
