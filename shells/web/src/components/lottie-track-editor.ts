// SPDX-License-Identifier: MPL-2.0
/** Source-property controls shared by the timeline's nested animation editor. */
import { t } from '../i18n.ts';
import { mountEasingEditor, type EasingEditorHandle } from './easing-editor.ts';
import { easingPoints } from '../lib/transitions.ts';
import { keyEase, lottieKeyIndex, propertyKeys, sampleLottieProperty, type LottieEase } from '../../../../engine/src/lottie-properties.ts';
import type { LottieEdit, LottieLayerAddress, LottieTrack } from '../../../../engine/src/lottie-edit.ts';

export function animationButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'tl-btn tl-action'; button.textContent = label;
  button.addEventListener('click', action);
  return button;
}
export function animationField(label: string, control: HTMLElement): HTMLLabelElement {
  const row = document.createElement('label'), name = document.createElement('span');
  control.setAttribute('aria-label', label);
  row.className = 'tl-animation-field'; name.textContent = label; row.append(name, control);
  return row;
}
export function animationNumber(value: number, commit: (value: number) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number'; input.step = 'any'; input.className = 'field-input'; input.value = String(value);
  input.addEventListener('change', () => { if (input.value !== '' && Number.isFinite(input.valueAsNumber)) commit(input.valueAsNumber); });
  return input;
}
export interface LottieTrackEditorOptions {
  target: LottieLayerAddress; track: LottieTrack;
  selection?: { frame: number; dimension: number };
  frame(): number;
  seek(frame: number): void;
  edit(edit: LottieEdit): void;
}
export interface LottieTrackEditorHandle { tick(): void; destroy(): void; selection(): { frame: number; dimension: number } | undefined }
export function mountLottieTrackEditor(parent: HTMLElement, opts: LottieTrackEditorOptions): LottieTrackEditorHandle {
  const { track, target } = opts, property = track.property;
  let keys: ReturnType<typeof propertyKeys>, initial: number[];
  try { keys = propertyKeys(property); initial = sampleLottieProperty(property, opts.frame()); }
  catch (error) { parent.textContent = error instanceof Error ? error.message : String(error); return { tick() {}, destroy() {}, selection: () => undefined }; }
  if (track.staticOnly && property.a === 1) {
    parent.textContent = t('Animated fill and stroke properties are preserved. Only static values can be edited here.');
    return { tick() {}, destroy() {}, selection: () => undefined };
  }
  let frame = opts.selection?.frame ?? opts.frame(), lastClock = opts.frame(), dimension = opts.selection?.dimension ?? 0, easeEditor: EasingEditorHandle | null = null;
  const frameInput = animationNumber(frame, next => { frame = next; opts.seek(next); lastClock = opts.frame(); refresh(); });
  frameInput.setAttribute('aria-label', t('Source frame'));
  const seekRow = document.createElement('div'); seekRow.className = 'tl-animation-actions';
  seekRow.append(animationField(t('Source frame'), frameInput), animationButton(t('Use playhead'), () => { frame = opts.frame(); refresh(); }));
  if (!track.staticOnly) parent.append(seekRow);
  const values = document.createElement('div'); values.className = 'tl-animation-values';
  const fields: HTMLInputElement[] = [];
  const commitValue = (): void => {
    const value = fields.map(f => f.valueAsNumber);
    if (value.some(v => !Number.isFinite(v))) return;
    opts.edit(property.a === 1 ? { target, kind: 'key', track: track.id, frame, value } : { target, kind: 'value', track: track.id, value });
  };
  for (let d = 0; d < initial.length; d++) {
    const label = track.color ? ['R', 'G', 'B', 'Alpha'][d]! : initial.length === 1 ? t('Value') : ['X', 'Y', 'Z', 'W'][d]!;
    const input = animationNumber(initial[d]!, commitValue); fields.push(input); values.append(animationField(label, input));
  }
  parent.append(values);
  if (track.color) {
    const color = document.createElement('input'); color.type = 'color';
    color.value = `#${initial.slice(0, 3).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
    color.addEventListener('change', () => {
      for (let d = 0; d < 3; d++) fields[d]!.value = String(parseInt(color.value.slice(1 + d * 2, 3 + d * 2), 16) / 255);
      commitValue();
    });
    parent.append(animationField(t('Color'), color));
  }
  const actions = document.createElement('div'); actions.className = 'tl-animation-actions';
  const add = animationButton(t('Add keyframe'), () => opts.edit({ target, kind: 'key', track: track.id, frame, value: sampleLottieProperty(property, frame, keys) }));
  const remove = animationButton(t('Delete keyframe'), () => opts.edit({ target, kind: 'delete', track: track.id, frame }));
  actions.append(add, remove);
  if (!track.staticOnly) parent.append(actions);
  const keyList = document.createElement('div'); keyList.className = 'tl-animation-keys'; keyList.setAttribute('aria-label', t('Keyframes'));
  let keyButtons: { button: HTMLButtonElement; index: number }[] = [], windowStart = -1;
  function selectKey(index: number): void { frame = Number(keys[index]!.t); opts.seek(frame); lastClock = opts.frame(); refresh(); }
  function renderKeys(near: number): void {
    const start = Math.floor(near / 128) * 128;
    if (start === windowStart) return;
    windowStart = start; keyButtons = []; keyList.replaceChildren();
    if (start) keyList.append(animationButton(t('Previous'), () => selectKey(start - 1)));
    for (let index = start; index < Math.min(start + 128, keys.length); index++) {
      const key = keys[index]!, button = animationButton(String(key.t), () => selectKey(index));
      button.title = `${t('Source frame')} ${key.t}`; button.dataset.frame = String(key.t); keyList.append(button); keyButtons.push({ button, index });
    }
    if (start + 128 < keys.length) keyList.append(animationButton(t('Next'), () => selectKey(start + 128)));
  }
  if (keys.length) parent.append(keyList);
  const easeHost = document.createElement('div'); easeHost.className = 'tl-animation-easing'; parent.append(easeHost);
  let easeSignature = '';
  function refresh(): void {
    const near = lottieKeyIndex(keys, frame), epsilon = Number.EPSILON * Math.max(1, Math.abs(frame)) * 16;
    const at = [near, near + 1].find(index => keys[index] && Math.abs(Number(keys[index]!.t) - frame) <= epsilon) ?? -1, key = keys[at];
    if (key) frame = Number(key.t);
    if (document.activeElement !== frameInput) frameInput.value = String(frame);
    const sample = sampleLottieProperty(property, frame, keys);
    fields.forEach((input, d) => { if (document.activeElement !== input) input.value = String(sample[d]!); });
    renderKeys(near);
    remove.disabled = !key; add.disabled = !!key;
    keyButtons.forEach(({ button, index }) => { button.setAttribute('aria-pressed', index === at ? 'true' : 'false'); });
    const signature = `${at}:${dimension}`;
    if (signature === easeSignature) return;
    easeSignature = signature; easeEditor?.destroy(); easeEditor = null; easeHost.replaceChildren();
    if (!key || !keys[at + 1] || track.staticOnly) return;
    const mode = document.createElement('select'); mode.className = 'field-select';
    for (const [value, label] of [['curve', t('Easing curve')], ['hold', t('Hold')]]) {
      const option = document.createElement('option'); option.value = value!; option.textContent = label!; mode.append(option);
    }
    mode.value = key.h === 1 ? 'hold' : 'curve';
    mode.addEventListener('change', () => opts.edit({ target, kind: 'ease', track: track.id, frame, dimension, ease: mode.value === 'hold' ? 'hold' : [0, 0, 1, 1] }));
    easeHost.append(animationField(t('Interpolation'), mode));
    if (key.h === 1) return;
    if (initial.length > 1 && !key.to) {
      const axis = document.createElement('select'); axis.className = 'field-select';
      initial.forEach((_, d) => { const option = document.createElement('option'); option.value = String(d); option.textContent = ['X', 'Y', 'Z', 'W'][d]!; axis.append(option); });
      axis.value = String(dimension);
      axis.addEventListener('change', () => { dimension = Number(axis.value); refresh(); });
      easeHost.append(animationField(t('Easing axis'), axis));
    }
    easeEditor = mountEasingEditor(easeHost, {
      value: `cubic-bezier(${keyEase(key, key.to ? 0 : dimension).join(',')})`,
      onCommit(wire) {
        const points = easingPoints(wire);
        if (points) opts.edit({ target, kind: 'ease', track: track.id, frame, dimension: key.to ? 0 : dimension, ease: [...points] as LottieEase });
      },
    });
  }
  refresh();
  return {
    tick() { const now = opts.frame(); if (Math.abs(now - lastClock) < 1e-6) return; lastClock = now; frame = now; refresh(); },
    destroy() { easeEditor?.destroy(); },
    selection: () => ({ frame, dimension }),
  };
}
