// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { analyzeTextBidi, textLineLevels, reorderTextRuns, textBreakOpportunities, textScriptRuns, textScript, textBidiClass } from '../engine/src/text-unicode.ts';
import { textBoundaries } from '../engine/src/text-source.ts';
test('Unicode property defaults cover unassigned RTL ranges and script extensions', () => {
  assert.equal(textBidiClass(0x0590), 'R'); assert.equal(textBidiClass(0x08ff), 'NSM');
  assert.equal(textScript(0x0915), 'Deva');
  assert.deepEqual(textScriptRuns('क्षेत्र العربية A'), [
    { start: 0, end: 8, script: 'Deva' }, { start: 8, end: 16, script: 'Arab' }, { start: 16, end: 17, script: 'Latn' },
  ]);
});
test('line trailing whitespace resets to the paragraph direction after wrapping', () => {
  const source = 'abc אבג   דהו end', paragraph = analyzeTextBidi(source);
  const line = textLineLevels(paragraph, { start: 0, end: 10 });
  assert.equal(line.at(-1)!.level, 0); assert.equal(line.at(-1)!.start, 7);
  assert.equal(reorderTextRuns(line).map(run => source.slice(run.start, run.end)).join(''), source.slice(0,10));
});
test('bidi logical UTF-16 mapping agrees with every admitted Unicode character conformance case', () => {
  const lines = gunzipSync(readFileSync('scripts/data/unicode/17.0/BidiCharacterTest.txt.gz')).toString().split('\n');
  let count = 0;
  for (const line of lines) {
    const values = line.split('#')[0]!.trim().split(';'); if (values.length !== 5) continue;
    const source = String.fromCodePoint(...values[0]!.split(/\s+/u).map(cp => parseInt(cp,16)));
    const paragraph = analyzeTextBidi(source, (['ltr','rtl','auto'] as const)[+values[1]!]!);
    const expectedLevels = values[3]!.trim().split(/\s+/u), expectedOrder = values[4]!.trim().split(/\s+/u).filter(Boolean).map(Number);
    assert.equal(paragraph.base, +values[2]!, `base ${count}`);
    expectedLevels.forEach((level,index) => { if (level !== 'x') assert.equal(paragraph.levels[index], +level, `level ${count}:${index}`); });
    const levels = textLineLevels(paragraph, { start: 0, end: source.length });
    const points = levels.flatMap(run => paragraph.starts.flatMap((start,index) => start >= run.start && start < run.end ? [{ level: run.level, removed: run.removed, index }] : []));
    const order = reorderTextRuns(points).filter(item => expectedLevels[item.index] !== 'x').map(item => item.index);
    assert.deepEqual(order, expectedOrder, `order ${count}`); count++;
  }
  assert.equal(count, 91707);
});
test('line candidates preserve grapheme, special-space and mandatory-break boundaries', () => {
  for (const source of ['Hello\u00a0there friend', '👨‍👩‍👧‍👦 🇬🇧 👩🏽‍💻', 'క్ష్మి\nकर्म\n', '中文，标点。换行', 'ภาษาไทย']) {
    const boundaries = textBoundaries(source), breaks = textBreakOpportunities(source);
    assert.ok(breaks.every(item => boundaries.has(item.offset))); assert.equal(breaks.at(-1)!.offset, source.length);
  }
  assert.ok(!textBreakOpportunities('Hello\u00a0there').some(item => item.offset < 11));
  assert.ok(textBreakOpportunities('a\nb').some(item=>item.offset===2 && item.required));
});
test('all Unicode 17 line-break cases agree after the editor grapheme-boundary constraint', () => {
  const corpus = gunzipSync(readFileSync('scripts/data/unicode/17.0/LineBreakTest.txt.gz')).toString();
  let count = 0;
  for (const line of corpus.split('\n')) {
    const tokens = line.split('#')[0]!.trim().split(/\s+/u); if (tokens.length < 3) continue;
    let source = ''; const expected: number[] = [];
    for (const token of tokens) {
      if (token === '÷') expected.push(source.length);
      else if (token !== '×') source += String.fromCodePoint(parseInt(token,16));
    }
    const boundaries = textBoundaries(source);
    assert.deepEqual(textBreakOpportunities(source).map(item => item.offset), expected.filter(at => at > 0 && boundaries.has(at)), `case ${count}: ${line}`);
    count++;
  }
  assert.ok(count > 19000, `only ${count} conformance cases ran`);
});

test('every Unicode 17 bidi class conformance case retains levels and visual order',()=>{
  const representatives:Record<string,string>={L:'A',R:'א',AL:'ا',EN:'1',AN:'١',ES:'+',ET:'$',CS:',',B:'\n',S:'\t',WS:' ',ON:'!',BN:'\u00ad',NSM:'\u0300',LRE:'\u202a',RLE:'\u202b',LRO:'\u202d',RLO:'\u202e',PDF:'\u202c',LRI:'\u2066',RLI:'\u2067',FSI:'\u2068',PDI:'\u2069'};
  for(const [kind,source]of Object.entries(representatives))assert.equal(textBidiClass(source.codePointAt(0)!),kind);
  let expected:string[]=[],order:number[]=[],count=0;
  for(const raw of gunzipSync(readFileSync('scripts/data/unicode/17.0/BidiTest.txt.gz')).toString().split('\n')){
    const line=raw.split('#')[0]!.trim();if(!line)continue;
    if(line.startsWith('@Levels:')){expected=line.slice(8).trim().split(/\s+/u);continue;}
    if(line.startsWith('@Reorder:')){order=line.slice(9).trim().split(/\s+/u).filter(Boolean).map(Number);continue;}
    if(line.startsWith('@'))continue;
    const [classes,flags]=line.split(';'),source=classes!.trim().split(/\s+/u).map(kind=>representatives[kind]!).join('');
    for(const [flag,direction]of [[1,'auto'],[2,'ltr'],[4,'rtl']] as const){if(!(parseInt(flags!,16)&flag))continue;
      const paragraph=analyzeTextBidi(source,direction);expected.forEach((level,index)=>{if(level!=='x')assert.equal(paragraph.levels[index],Number(level),`${line} ${direction} level ${index}`);});
      const levels=textLineLevels(paragraph,{start:0,end:source.length}),points=levels.flatMap(run=>paragraph.starts.flatMap((start,index)=>start>=run.start&&start<run.end?[{level:run.level,removed:run.removed,index}]:[]));
      assert.deepEqual(reorderTextRuns(points).filter(point=>expected[point.index]!=='x').map(point=>point.index),order,`${line} ${direction}`);count++;
    }
  }
  assert.equal(count,770241);
});
