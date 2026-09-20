// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { createMockHost } from '@lolly-tools/core';
import { createRuntime } from '../engine/src/runtime.ts';
import { loadTool } from '../engine/src/loader.ts';
import { makeGeomApi } from '../engine/src/geom-api.ts';
import { parseUrlState, serializeUrlState } from '../engine/src/url-mode.ts';
import { createTextCompositionAPI } from '../packages/node-shell/src/text-composition.ts';
import { upgradeDesignText, defaultTextFrameSettings, readDesignText } from '../engine/src/text-design.ts';
const tool=await loadTool('design',path=>readFile(new URL(`../community/${path}`,import.meta.url),'utf8'));
const bytes=await readFile('shells/web/public/fonts/SUSE[wght].ttf');
const parser=new (new JSDOM('').window.DOMParser)(),parseXml=(source:string)=>parser.parseFromString(source,'image/svg+xml');
const font={id:'sans',family:'SUSE',sha256:createHash('sha256').update(bytes).digest('hex'),faceIndex:0,source:{kind:'bundled' as const,path:'/fonts/SUSE[wght].ttf'}};
function host(){const value=createMockHost();value.geom=makeGeomApi();value.text={...value.text!,...createTextCompositionAPI(async()=>bytes,parseXml)};return value;}
test('the actual Design render, appended URL fields and reopen preserve composed source and paths',async()=>{
  const initial=upgradeDesignText('',[{id:'box',kind:'text',text:'',x:5,y:10,w:180,h:40}],'box',{storyId:'story',source:'Office e\u0301\u00a0copy\r\nLast line\n',character:{font:'sans',size:24,weight:400,color:'#225577'},fonts:[font],settings:defaultTextFrameSettings('auto-height')});
  const runtime=await createRuntime(tool,host(),initial as Parameters<typeof createRuntime>[2]);
  try{
    assert.deepEqual(runtime.hookErrors,[]);const markup=runtime.getHydrated();assert.match(markup,/data-composed-text="story"/);
    const parsed=parseUrlState(serializeUrlState(runtime.getModel()),tool.manifest);
    assert.equal(parsed.values.textDocument,initial.textDocument);
    const reopened=await createRuntime(tool,host(),parsed.values);
    try{assert.deepEqual(reopened.hookErrors,[]);const first=new JSDOM(markup).window.document,next=new JSDOM(reopened.getHydrated()).window.document;
      assert.equal(next.querySelector('[data-composed-text]')!.outerHTML,first.querySelector('[data-composed-text]')!.outerHTML);
      assert.equal(next.querySelector('[data-box-id]')!.getAttribute('style'),first.querySelector('[data-box-id]')!.getAttribute('style'));}finally{reopened.destroy();}
    const boxes=parsed.values.boxes as Record<string,unknown>[];
    assert.ok(Number(boxes[0]!.h)>40);assert.equal(Number(boxes[0]!.w),180);
    const model=readDesignText(parsed.values.textDocument,boxes);assert.equal(model.document.stories[0]!.source,'Office e\u0301\u00a0copy\r\nLast line\n');
  }finally{runtime.destroy();}
});
test('font pin failures remain visible and block export instead of delivering empty text',async()=>{
  const initial=upgradeDesignText('',[{id:'box',kind:'text',text:'',w:180,h:80}],'box',{storyId:'story',source:'Hello',character:{font:'sans'},fonts:[{...font,sha256:'0'.repeat(64)}]});
  const runtime=await createRuntime(tool,host(),initial as Parameters<typeof createRuntime>[2]);
  try{assert.ok(runtime.hookErrors.length);await assert.rejects(()=>runtime.export({} as Element,'svg',{c2pa:false}),/font content changed/i);}finally{runtime.destroy();}
});
test('mixed paragraph emoji use the chosen pack, survive source edits and report only visible artwork',async()=>{
  const {createNodeEmojiAPI}=await import('../packages/node-shell/src/emoji.ts');
  const emoji=await createNodeEmojiAPI({parseXml}),sets=await emoji.sets();
  const value=host();value.emoji=emoji;
  const initial=upgradeDesignText('',[{id:'box',kind:'text',text:'',w:350,h:150}],'box',{storyId:'story',source:'Office 😀 ❤️\nSecond 👨‍👩‍👧‍👦',character:{font:'sans',size:24,color:'#22668880'},fonts:[font]});
  const runtime=await createRuntime(tool,value,initial as Parameters<typeof createRuntime>[2]);
  try{
    assert.deepEqual(runtime.hookErrors,[]);
    const set=sets.find(set=>set.pin.id==='community/emoji/twemoji/color')!;
    await runtime.setEmojiStyle({schemaVersion:1,primary:set.pin,fallbacks:[],metricsPolicy:'inline-em-v1',treatment:{mode:'original',strengthBps:0}});
    assert.deepEqual(runtime.hookErrors,[]);
    const node=new JSDOM(runtime.getHydrated()).window.document.body;
    await runtime.applyEmojiToDom(node);
    assert.equal(runtime.emojiIngredients().length,3);
    assert.match(runtime.emojiCredits(),/Twemoji/);
    assert.equal(node.querySelectorAll('[data-composed-text] svg').length,3);
    const before=node.querySelector('[data-composed-text]')!.outerHTML;
    const black=sets.find(set=>set.pin.id==='community/emoji/openmoji/black')!;
    await runtime.setEmojiStyle({schemaVersion:1,primary:black.pin,fallbacks:[],metricsPolicy:'inline-em-v1',treatment:{mode:'original',strengthBps:0}});
    assert.notEqual(new JSDOM(runtime.getHydrated()).window.document.querySelector('[data-composed-text]')!.outerHTML,before);
    const model=readDesignText(initial.textDocument,initial.boxes);
    const layout=await runtime.layoutText({document:model.document,storyId:'story',frames:model.frames,includeSvg:true});
    assert.equal(layout.lines.flatMap(line=>line.inlines).length,3);
    assert.ok(layout.resources.some(resource=>resource.id.includes('emoji')));
    assert.ok(layout.lines.flatMap(line=>line.inlines).every(inline=>!inline.svg.includes('currentColor')));
  }finally{runtime.destroy();}
});


test('export preflight refuses stale text and requires a named choice for clipped source',async()=>{
  const initial=upgradeDesignText('',[{id:'box',kind:'text',text:'',w:180,h:60}],'box',{storyId:'story',source:'A short heading',character:{font:'sans',size:24},fonts:[font],settings:defaultTextFrameSettings('fixed')});
  const value=host();let rendered=0;value.export.render=async()=>{rendered++;return new Blob(['ok']);};const runtime=await createRuntime(tool,value,initial as Parameters<typeof createRuntime>[2]);
  try{
    const old=new JSDOM(runtime.getHydrated()).window.document.body;
    const missing=new JSDOM(runtime.getHydrated()).window.document.body;missing.querySelector('[data-text-frame]')!.remove();
    await assert.rejects(()=>runtime.export(missing,'svg',{c2pa:false}),/layout is still changing/);assert.equal(rendered,0);
    const doc=JSON.parse(initial.textDocument);doc.stories[0].source='A longer article that continues beyond the last frame. '.repeat(8);doc.stories[0].paragraphs[0].end=doc.stories[0].source.length;doc.stories[0].revision++;
    await runtime.setInput('textDocument',JSON.stringify(doc));const current=new JSDOM(runtime.getHydrated()).window.document.body;
    await assert.rejects(()=>runtime.export(current,'svg',{c2pa:false}),/Export visible text only/);assert.equal(rendered,0);
    await runtime.setInput('exportVisibleText',true);
    await assert.rejects(()=>runtime.export(old,'svg',{c2pa:false}),/layout is still changing/);assert.equal(rendered,0);
    await runtime.export(current,'svg',{c2pa:false});assert.equal(rendered,1);assert.equal(current.querySelector('[data-text-frame]')!.getAttribute('overflow'),'hidden');assert.equal(JSON.parse(runtime.getModel().find(item=>item.id==='textDocument')!.value as string).stories[0].source,doc.stories[0].source);
  }finally{runtime.destroy();}
});

test('text export detects edits made while an asynchronous preflight is settling',{timeout:10000},async()=>{
  const initial=upgradeDesignText('',[{id:'box',kind:'text',text:'',w:300,h:100}],'box',{storyId:'story',source:'Before export',character:{font:'sans',size:24},fonts:[font]});
  const value=host();let release!:()=>void,entered!:()=>void;
    const waiting=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  value.state.load=async()=>{entered();await waiting;return null;};
  const pausedTool={...tool,hooksSource:`${tool.hooksSource}\nconst originalBeforeExport=beforeExport;beforeExport=async ctx=>{await host.state.load('test-preflight');return originalBeforeExport(ctx);};`};
  const runtime=await createRuntime(pausedTool,value,initial as Parameters<typeof createRuntime>[2]);
  try{const exporting=runtime.export(new JSDOM(runtime.getHydrated()).window.document.body,'svg',{c2pa:false});
    await started;await runtime.setInput('background','#112233');release();await assert.rejects(()=>exporting,/text changed while its export/);
  }finally{runtime.destroy();}
});

test('hidden editable vector backups validate their source without requiring the original font to export', async () => {
  const initial = upgradeDesignText('', [{ id: 'source', kind: 'text', text: '', w: 180, h: 60, hidden: true, vectorSource: JSON.stringify({ version: 1, sourceCopy: true }) }, { id: 'vector', kind: 'path', path: 'M0 0L80 0L80 40Z', w: 80, h: 40, x: 0, y: 0, fill: '#223344' }], 'source', { storyId: 'story', source: 'Editable backup', character: { font: 'sans', size: 24 }, fonts: [{ ...font, sha256: '0'.repeat(64) }], settings: defaultTextFrameSettings('fixed') });
  const value = host(); let rendered = 0; value.export.render = async () => { rendered++; return new Blob(['ok']); };
  const runtime = await createRuntime(tool, value, initial as Parameters<typeof createRuntime>[2]);
  try {
    assert.deepEqual(runtime.hookErrors, []); const node = new JSDOM(runtime.getHydrated()).window.document.body;
    assert.ok(node.querySelector('[data-box-id="vector"] path')); assert.equal(node.querySelectorAll('[data-text-frame]').length, 0);
    await runtime.export(node, 'svg', { c2pa: false }); assert.equal(rendered, 1);
    assert.equal(JSON.parse(runtime.getModel().find(item => item.id === 'textDocument')!.value as string).stories[0].source, 'Editable backup');
    const boxes = runtime.getModel().find(item => item.id === 'boxes')!.value as Array<Record<string, unknown>>;
    await runtime.setInput('boxes', boxes.map(box => box.id === 'source' ? { ...box, hidden: false } : box) as Parameters<typeof runtime.setInput>[1]);
    await assert.rejects(() => runtime.export(node, 'svg', { c2pa: false }), /font content changed/i);
    const doc = JSON.parse(initial.textDocument); doc.fonts[0] = font; await runtime.setInput('textDocument', JSON.stringify(doc));
    const restored = new JSDOM(runtime.getHydrated()).window.document.body;
    assert.ok(restored.querySelector('[data-text-frame="source"]')); assert.ok(!restored.querySelector('[data-box-id="source"]')!.hasAttribute('data-export-hide'));
    await runtime.export(restored, 'svg', { c2pa: false }); assert.equal(rendered, 2);
  } finally { runtime.destroy(); }
});
