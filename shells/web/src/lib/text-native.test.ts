// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeTextChange } from './text-native.ts';
import { textBoundaries } from '../../../../engine/src/text-source.ts';
test('native replacements preserve literal source and expand to complete graphemes in both revisions',()=>{
  const fragments=['','A','e\u0301','👨‍👩‍👧‍👦','🇬🇧','👩🏽‍💻','\r\n','\u2028','\u00a0','क्ष'];
  for(const left of fragments)for(const right of fragments)for(const replacement of fragments){
    const before=`${left}middle${right}`,after=`${left}${replacement}${right}`,change=nativeTextChange(before,after)!;
    assert.equal(before.slice(0,change.range.start)+change.text+before.slice(change.range.end),after);
    assert.ok(textBoundaries(before).has(change.range.start));assert.ok(textBoundaries(before).has(change.range.end));
    assert.ok(textBoundaries(after).has(change.range.start));assert.ok(textBoundaries(after).has(change.range.start+change.text.length));
  }
  assert.equal(nativeTextChange('Unchanged\u00a0\n','Unchanged\u00a0\n'),null);
});
test('an IME replacing only a combining suffix expands its source transaction',()=>{
  const change=nativeTextChange('Cafe\u0301','Cafe\u0300')!;
  assert.deepEqual(change,{range:{start:3,end:5},text:'e\u0300'});
});
