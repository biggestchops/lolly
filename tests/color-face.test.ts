// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenSet, TOKEN_EXT, colorToHex } from '../engine/src/tokens.ts';
import { swatchFace, tokenColorVar } from '../engine/src/color-face.ts';
test('authored sRGB and P3 faces follow a semantic alias without flattening',()=>{
  const set=createTokenSet({ color: {
    $type: 'color',
    brand: { green: { $value: 'color(display-p3 0 1 0)', $extensions: {
      [TOKEN_EXT]: { faces: { srgb: { value: '#00aa44' }, 'display-p3': { value: 'color(display-p3 0 1 0)' } } }
    } } },
    semantic: { primary: { $value: '{color.brand.green}' } }
  } });
  const color=set.colors().find(s=>s.path==='color.semantic.primary')!;
  assert.equal(swatchFace(color,'srgb'),'#00aa44');
  assert.equal(swatchFace(color,'display-p3'),'color(display-p3 0 1 0)');
  assert.equal(swatchFace(color,'rec2020'),'color(display-p3 0 1 0)');
  assert.notEqual(tokenColorVar('{a.b}'),tokenColorVar('{a-b}'));
});
test('DTCG colourSpace is respected instead of treating P3 components as sRGB',()=>{
  const value={colorSpace:'display-p3',components:[1,.3,0],alpha:.5};
  assert.notEqual(colorToHex(value),colorToHex({...value,colorSpace:'srgb'}));
});
