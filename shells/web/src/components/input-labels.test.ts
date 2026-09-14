// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { linkInputLabels } from './input-labels.ts';

test('a field keeps its visible label when help and data buttons precede it', () => {
  const dom = new JSDOM(`<main><label class="input-row">
    <span class="input-label"><span class="input-label-text">URL</span>
      <button aria-label="More info">i</button><button>Add data</button></span>
    <input value="https://example.org/welcome" aria-describedby="help">
    <span id="help" hidden>The destination encoded in the QR code.</span>
  </label></main>`);
  try {
    const scope = dom.window.document.querySelector('main')!;
    const label = scope.querySelector('label')!;
    const input = scope.querySelector('input')!;
    assert.notEqual(label.control, input, 'reproduces the help button taking the label');
    linkInputLabels(scope);
    assert.equal(label.control, input, 'clicking URL now focuses its input');
    assert.equal(dom.window.document.getElementById(input.getAttribute('aria-labelledby')!)?.textContent, 'URL');
    assert.equal(input.getAttribute('aria-describedby'), 'help');
    const markup = scope.innerHTML;
    linkInputLabels(scope);
    assert.equal(scope.innerHTML, markup, 'repeat wiring retains the same links');
  } finally { dom.window.close(); }
});

test('selects, textareas and checkboxes retain captions; composite fields keep their own labels', () => {
  const dom = new JSDOM(`<main>
    <label class="input-row"><span class="input-label-text">Encodes</span><button>Help</button><select><option>Link</option></select></label>
    <label class="input-row"><span class="input-label-text">Details</span><button>Add data</button><textarea></textarea></label>
    <label class="input-row"><input type="checkbox"><span class="input-label-text">Transparent background</span><button>Help</button></label>
    <div class="input-row" role="group" aria-label="Position"><input aria-label="X"><input aria-label="Y"></div>
    <label class="input-row"><span class="input-label-text">Size</span><input aria-label="Width"></label>
  </main>`);
  try {
    const scope = dom.window.document.querySelector('main')!;
    linkInputLabels(scope);
    for (const label of scope.querySelectorAll('label')) {
      assert.equal(label.control, label.querySelector('input, select, textarea'));
    }
    assert.equal(scope.querySelector('[aria-label="Width"]')?.hasAttribute('aria-labelledby'), false);
    assert.equal(scope.querySelector('[aria-label="X"]')?.hasAttribute('aria-labelledby'), false);
    const ids = [...scope.querySelectorAll('[id]')].map(el => el.id);
    assert.equal(ids.length, new Set(ids).size);
  } finally { dom.window.close(); }
});
