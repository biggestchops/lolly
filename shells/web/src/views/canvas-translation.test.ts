// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { patchCanvasTranslations } from './canvas-translation.ts';

const markup = (x: number, text = 'stable') => `<div class="lolly-box" data-box-id="a" style="left:${x}px;top:20px;width:100px"><video></video>${text}</div><div class="lolly-box" data-box-id="b" style="left:0px;top:0px">other</div>`;
const plan = [{ id: 'a', x: 40, y: 20 }];

test('export metadata follows translations while executable or unknown script changes repaint', () => {
  const payload = (x: number) => `<script type="application/json" data-penpot-doc>{"x":${x}}</script>`;
  const before = markup(10) + payload(10);
  const after = markup(40) + payload(40);
  const dom = new JSDOM(before);
  const root = dom.window.document.body;
  const script = root.querySelector('script');
  assert.equal(patchCanvasTranslations(root, before, after, plan), true);
  assert.equal(root.querySelector('script'), script);
  assert.equal(script!.textContent, '{"x":40}');
  for (const attr of ['type="application/json" data-unknown', 'data-penpot-doc']) {
    const a = markup(10) + `<script ${attr}>{"x":10}</script>`;
    const b = markup(40) + `<script ${attr}>{"x":40}</script>`;
    root.innerHTML = a;
    assert.equal(patchCanvasTranslations(root, a, b, plan), false);
    assert.equal(root.querySelector('script')!.textContent, '{"x":10}');
  }
  dom.window.close();
});

test('a translation preserves live nodes and local state while changing export geometry', () => {
  const dom = new JSDOM(markup(10));
  const root = dom.window.document.body;
  const box = root.firstElementChild as HTMLElement;
  const video = box.querySelector('video')!;
  const other = root.lastElementChild;
  box.style.setProperty('--fit', '0.8');
  assert.equal(patchCanvasTranslations(root, markup(10), markup(40), plan), true);
  assert.equal(root.firstElementChild, box);
  assert.equal(root.lastElementChild, other);
  assert.equal(box.querySelector('video'), video);
  assert.equal(box.style.getPropertyValue('--fit'), '0.8');
  assert.equal(dom.window.getComputedStyle(box).left, '40px');
  dom.window.close();
});

test('changes outside the planned coordinates and missing/duplicate targets fall back atomically', () => {
  const dom = new JSDOM(markup(10));
  const root = dom.window.document.body;
  const before = root.innerHTML;
  for (const next of [markup(40, 'new text'), markup(40).replace('other', 'changed'), markup(40).replace('width:100px', 'width:120px')]) {
    assert.equal(patchCanvasTranslations(root, markup(10), next, plan), false);
    assert.equal(root.innerHTML, before);
  }
  assert.equal(patchCanvasTranslations(root, markup(10), markup(40), [...plan, { id: 'missing', x: 0, y: 0 }]), false);
  assert.equal(root.innerHTML, before);
  assert.equal(patchCanvasTranslations(root, markup(10), markup(40), [...plan, ...plan]), false);
  assert.equal(patchCanvasTranslations(root, markup(10), markup(40), []), false);
  dom.window.close();
});
