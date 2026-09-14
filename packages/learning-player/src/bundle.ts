// SPDX-License-Identifier: MPL-2.0
import type { LearningContent, LearningTarget } from '@lolly-tools/core/learning-v1';
import {
  learningProgress,
  encodeLearningAttempt,
  decodeLearningAttempt,
} from '../../../engine/src/learning/progress.ts';
import { bootLearningPlayer } from './player.ts';
import { createLearningTracking } from './tracking.ts';

export const LEARNING_PLAYER_VERSION = '1.1.0';
export const learningPlayerCss = `:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.6}body{margin:0;padding:clamp(16px,4vw,48px);background:Canvas;color:CanvasText}*{box-sizing:border-box}header,footer,.learning-layout{max-width:1200px;margin:auto}h1{font-size:clamp(24px,4vw,40px)}.learning-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:32px}nav{display:flex;flex-direction:column;gap:8px}nav h2{font-size:1rem}button{font:inherit;padding:10px 16px;border:1px solid currentColor;border-radius:8px;background:Canvas;color:CanvasText;cursor:pointer;text-align:left}button[aria-current=step]{outline:3px solid Highlight}button:disabled{opacity:.5;cursor:default}:focus-visible{outline:3px solid Highlight;outline-offset:3px}main{min-width:0}main section{margin-bottom:24px}img,video{width:100%;height:auto}audio{max-width:100%}.learning-text,details p{white-space:pre-wrap}footer{display:flex;gap:12px;flex-wrap:wrap;padding-top:24px}a{color:LinkText}@media(max-width:650px){.learning-layout{grid-template-columns:1fr}nav{max-height:180px;overflow:auto}}`;

/** Functions have no external runtime bindings; bundling renames cannot break them. */
export function learningPlayerJs(
  content: LearningContent,
  target: LearningTarget | 'preview'
): string {
  const data = JSON.stringify(content)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `(${bootLearningPlayer.toString()})(window,${data},${JSON.stringify(target)},${learningProgress.toString()},${createLearningTracking.toString()},${encodeLearningAttempt.toString()},${decodeLearningAttempt.toString()});`;
}

export function learningPlayerHtml(title: string, language: string): string {
  const htmlEscape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
    );
  return `<!doctype html><html lang="${htmlEscape(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${htmlEscape(title)}</title><link rel="stylesheet" href="player.css"></head><body><div id="learning-player"></div><script src="player.js"></script></body></html>`;
}
