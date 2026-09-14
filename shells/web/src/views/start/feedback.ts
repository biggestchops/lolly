// SPDX-License-Identifier: MPL-2.0
/**
 * start: feedback.
 *
 * Every function takes the shared `start: StartCtx` first (see context.ts). Sibling
 * calls in this file are direct; a call into another module, and every use of a
 * function as a value (an event listener), goes through `start.<module>.<fn>`. Extracted verbatim
 * from mountStart() by scripts/split-closure.ts.
 */
import { announce } from '../../a11y.ts';
import { escape as escapeText } from '../../utils.ts';
import { bindOp, type StartCtx } from './context.ts';

/**
 * The one result sink: what a picked or dropped file turned out to be, and the
 * controls that act on it.
 *
 * It is a STATUS MESSAGE in the WCAG 4.1.3 sense - new content that answers
 * something the person just did, in a place their focus is not. It is not a
 * live region: the card is a whole panel (stats, warnings, a question, two or
 * three buttons) and reading all of it aloud on every render is noise. So each
 * caller says its one fact through `say`, and focus moves to the card, which
 * is where the buttons are and where a screen reader then reads from.
 */
export const showImportResult = (start: StartCtx, 
  html: string,
  opts: { say?: string; assertive?: boolean } = {}
): void => {
  const { importResult } = start;
  importResult.innerHTML = html;
  importResult.hidden = false;
  if (opts.say) announce(opts.say, { assertive: !!opts.assertive });
  importResult.focus();
};
/** A refusal, in the card and out loud. `text` is PLAIN text: the card escapes
 *  it, the announcement must not (a live region is a text sink, and entities
 *  are read out as entities there). */
export const showImportError = (start: StartCtx, text: string): void => {
  showImportResult(start, `<p class="start-import-err">${escapeText(text)}</p>`, {
    say: text,
    assertive: true,
  });
};
export function feedbackOps(start: StartCtx) {
  return {
    showImportResult: bindOp(start, showImportResult),
    showImportError: bindOp(start, showImportError),
  };
}
