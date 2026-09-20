// SPDX-License-Identifier: MPL-2.0
/** Path text owns its guide snapshot and uses the existing pen for node editing. */
import { textGuideGeometry, transformTextPath, parseSvgPath, pathFromSubPaths, toSvgPathData, defaultTextFrameSettings, parseTextFrame, upgradeDesignText, readDesignText } from '@lolly/engine';
import type { AuthoredPath } from '@lolly/engine';
import type { TextFrameV1 } from '@lolly-tools/core';
import { boxToPath, authoredFromContour } from '../vector-ops.ts';
import { penFrame, frameToLocal, lowerAuthored, penCommitFromNative, denormNodes, normNodes, encodePathField } from '../free-canvas-pen.ts';
import { seedBox, type Box } from '../free-canvas-math.ts';
import { captureLegacyText } from '../../lib/text-editor-migration.ts';
import { t } from '../../i18n.ts';
import { announce } from '../../a11y.ts';
import { bindOp, type FcCtx } from './context.ts';
const fail=(error:unknown)=>announce(error instanceof Error?error.message:String(error));
export function frame(fc:FcCtx,id:string){return fc.storyText.read().frames.find(frame=>frame.id===id);}
export function seed(fc:FcCtx,box:Box,boxes:Box[]):TextFrameV1['path']|undefined{
  const kind=box.__textPath,guideId=box.__textPathAttach,w=Number(box[fc.cfg.wField]),h=Number(box[fc.cfg.hField]);
  let d=typeof box.__textGuideD==='string'?box.__textGuideD:'';
  if(guideId){
    const source=boxToPath(boxes.find(item=>item[fc.cfg.idField]===guideId),fc.vectorCfg ?? undefined);if(!source)throw new Error(t('Choose one continuous path or shape.'));
    const target=penFrame(box,fc.cfg),o=frameToLocal(target,0,0),x=frameToLocal(target,1,0),y=frameToLocal(target,0,1);
    d=transformTextPath(toSvgPathData(source),{a:x.x-o.x,b:x.y-o.y,c:y.x-o.x,d:y.y-o.y,e:o.x,f:o.y});
  }else if(kind==='circle'){
    const r=Math.max(1,Math.min(w,h)*.38),cx=w/2,cy=h/2;d=`M${cx} ${cy-r}A${r} ${r} 0 1 1 ${cx} ${cy+r}A${r} ${r} 0 1 1 ${cx} ${cy-r}Z`;
  }
  if(!d)return undefined;
  return {d,start:0,end:textGuideGeometry(d).length,baseline:0,flip:false,reverse:false,fit:false,guide:false};
}
export function selection(fc:FcCtx):{text:Box;guide:Box}|null{
  if(fc.selection.size!==2)return null;
  const boxes=fc.select.getBoxes().filter(box=>fc.selection.has(String(box[fc.cfg.idField]))),text=boxes.find(box=>box[fc.cv.textStoryField!]||box[fc.cfg.kindField]==='text');
  const guide=boxes.find(box=>box!==text);return text&&guide&&boxToPath(guide,fc.vectorCfg ?? undefined)?{text,guide}:null;
}
export async function update(fc:FcCtx,id:string,value:Partial<TextFrameV1>,label:string):Promise<void>{
  const snapshot=fc.storyText.read(),before=JSON.stringify(snapshot),current=snapshot.frames.find(frame=>frame.id===id);if(!current)throw new Error(t('The text frame no longer exists.'));
  const story=snapshot.document.stories.find(story=>story.id===current.storyId)!;
  if(current.locked)throw new Error(t('Unlock this text frame before changing its geometry.'));
  if((value.mode??current.mode)==='path'&&story.frameIds.length!==1)throw new Error(t('Disconnect this text frame before attaching a guide.'));
  snapshot.frames=snapshot.frames.map(frame=>frame.id===id?parseTextFrame({...frame,...value}):frame);
  await fc.storyText.layout({document:snapshot.document,storyId:story.id,frames:snapshot.frames.filter(frame=>frame.storyId===story.id)});
  if(fc.disposed||JSON.stringify(fc.storyText.read())!==before)throw new Error(t('The text changed while its guide was prepared. Try again.'));
  await fc.storyText.write(snapshot,label);
}
export async function attach(fc:FcCtx,textId:string,guideId:string,remove=false):Promise<void>{
  try{
    if(fc.editing)fc.textEdit.commitTextEdit();
    let boxes=fc.select.getBoxes();const originalBoxes=JSON.stringify(boxes);
    const originalSnapshot=fc.storyText.read();
    let snapshot=originalSnapshot;
    if(!snapshot.frames.some(frame=>frame.id===textId)){
      const element=fc.stage.liveBoxEl(textId)?.querySelector<HTMLElement>('.lolly-box-text');if(!element)throw new Error(t('The text object no longer exists.'));
      const captured=await captureLegacyText(element);
      if(JSON.stringify(fc.select.getBoxes())!==originalBoxes||JSON.stringify(fc.storyText.read())!==JSON.stringify(originalSnapshot))throw new Error(t('The text changed while its fonts loaded. Try again.'));
      const patch=upgradeDesignText(originalSnapshot.document,boxes,textId,{storyId:`story-${crypto.randomUUID()}`,...captured});boxes=patch.boxes as Box[];snapshot=readDesignText(patch.textDocument,boxes);
    }
    const text=boxes.find(box=>box[fc.cfg.idField]===textId)!,guide=boxes.find(box=>box[fc.cfg.idField]===guideId);
    if(!text||!guide)throw new Error(t('Choose one text object and one guide.'));
    if(remove&&[true,'true',1,'1'].includes(guide[fc.frameCfg?.lockedField ?? 'locked'] as string|number|boolean))throw new Error(t('Unlock the guide before removing it.'));
    const before=JSON.stringify({snapshot:originalSnapshot,boxes:JSON.parse(originalBoxes)}),current=snapshot.frames.find(frame=>frame.id===textId)!;
    const story=snapshot.document.stories.find(story=>story.id===current.storyId)!;
    if(story.frameIds.length!==1||current.locked)throw new Error(t('Choose an unlocked, standalone text frame.'));
    const path=seed(fc,{...text,__textPathAttach:guideId},boxes)!;
    snapshot.frames=snapshot.frames.map(frame=>frame.id===textId?{...frame,...defaultTextFrameSettings('path'),path}:frame);
    await fc.storyText.layout({document:snapshot.document,storyId:story.id,frames:snapshot.frames.filter(frame=>frame.storyId===story.id)});
    if(fc.disposed||JSON.stringify({snapshot:fc.storyText.read(),boxes:fc.select.getBoxes()})!==before)throw new Error(t('The selection changed while its guide was prepared. Try again.'));
    const pending=fc.storyFlow.commit(snapshot,remove?boxes.filter(box=>box!==guide):boxes,t('Attach text to path'));fc.selection=new Set([textId]);fc.chromeSync.renderChrome();await pending;
  }catch(error){fail(error);}
}
export function paths(fc:FcCtx,id:string):AuthoredPath[]|null{
  const path=frame(fc,id)?.path;if(!path)return null;
  const contours=pathFromSubPaths(parseSvgPath(path.d));return contours.map(contour=>authoredFromContour(contour,(x,y)=>[x,y])).filter((path):path is AuthoredPath=>!!path);
}
export async function writePaths(fc:FcCtx,id:string,paths:AuthoredPath[]):Promise<void>{
  try{const old=frame(fc,id)?.path;if(!old)return;const d=toSvgPathData(paths.map(path=>({curves:lowerAuthored(path).cubics,closed:path.closed}))),ratio=textGuideGeometry(d).length/textGuideGeometry(old.d).length;
    await update(fc,id,{path:{...old,d,start:old.start*ratio,end:old.end*ratio}},t('Edit text guide'));fc.penTool.penSyncFromModel(fc.select.getBoxes());fc.chromeSync.renderChrome();
  }catch(error){fail(error);fc.penTool.penSyncFromModel(fc.select.getBoxes());fc.chromeSync.renderChrome();}
}
export async function detach(fc:FcCtx,id:string,keep:boolean):Promise<void>{
  try{if(fc.editing)fc.textEdit.commitTextEdit();const snapshot=fc.storyText.read(),current=snapshot.frames.find(frame=>frame.id===id)!;if(!current?.path||current.locked)return;
    let boxes=fc.select.getBoxes();const text=boxes.find(box=>box[fc.cfg.idField]===id)!;
    if(keep){const guide=paths(fc,id)![0]!,newId=fc.select.freshId(boxes);boxes=[...boxes,{...fc.addKinds.find(kind=>kind.id==='path')?.seed,...Object.fromEntries([fc.cfg.xField,fc.cfg.yField,fc.cfg.wField,fc.cfg.hField,fc.cfg.rotationField,fc.cfg.groupField,fc.frameCfg?.frameField].filter(Boolean).map(key=>[key!,text[key!]])),[fc.cfg.idField]:newId,[fc.cfg.kindField]:'path',[fc.cfg.pathField]:encodePathField(normNodes(guide,current.width,current.height)),[fc.cfg.fillField]:'none',[fc.cfg.strokeField]:'#666666',[fc.cfg.strokeWField]:1}];}
    snapshot.frames=snapshot.frames.map(frame=>{if(frame.id!==id)return frame;const {path:_path,...rest}=frame;return {...rest,...defaultTextFrameSettings('auto-height')};});
    await fc.storyFlow.commit(snapshot,boxes,t('Detach from path'));
  }catch(error){fail(error);}
}
export function circle(fc:FcCtx):void{const kind=fc.addKinds.find(kind=>kind.id==='text');if(kind)fc.modes.setMode('create',{kind:{...kind,id:'text-circle',label:t('Text on a circle'),seed:{...kind.seed,__textPath:'circle',[fc.cv.textFrameField!]:'fixed'}}});}
export function draw(fc:FcCtx):void{fc.toolbox.closePopover();fc.modes.setMode('pen');fc.textPathDrawing=true;announce(t('Draw one guide. Enter creates editable text on it. Escape cancels.'));}
export function drawn(fc:FcCtx,draft:AuthoredPath):boolean{
  const made=penCommitFromNative(draft);if(!made)return false;
  const kind=fc.addKinds.find(kind=>kind.id==='text');if(!kind)return false;
  const boxes=fc.select.getBoxes(),id=fc.select.freshId(boxes),box=seedBox(fc.cfg,{},kind.seed,{x:made.x,y:made.y,w:Math.max(made.w,80),h:Math.max(made.h,80),rot:0},id);
  box.__textGuideD=toSvgPathData([{curves:lowerAuthored(denormNodes(made.path,made.w,made.h)).cubics,closed:draft.closed}]);box[fc.cfg.textField]='';fc.modes.toPointer();void fc.storyText.create([...boxes,box],id,'fixed');return true;
}
export async function fromGuide(fc:FcCtx,id:string):Promise<void>{
  const boxes=fc.select.getBoxes(),guide=boxes.find(box=>box[fc.cfg.idField]===id),kind=fc.addKinds.find(kind=>kind.id==='text');if(!guide||!kind)return;
  const box=seedBox(fc.cfg,{},kind.seed,penFrame(guide,fc.cfg),fc.select.freshId(boxes));box.__textPathAttach=id;box[fc.cfg.textField]='';
  await fc.storyText.create([...boxes,box],String(box[fc.cfg.idField]),'fixed');
}
export function storyPathOps(fc:FcCtx){return {frame:bindOp(fc,frame),seed:bindOp(fc,seed),selection:bindOp(fc,selection),update:bindOp(fc,update),attach:bindOp(fc,attach),paths:bindOp(fc,paths),writePaths:bindOp(fc,writePaths),detach:bindOp(fc,detach),circle:bindOp(fc,circle),draw:bindOp(fc,draw),drawn:bindOp(fc,drawn),fromGuide:bindOp(fc,fromGuide)};}
