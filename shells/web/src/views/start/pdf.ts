// SPDX-License-Identifier: MPL-2.0
/**
 * start: pdf.
 *
 * Every function takes the shared `start: StartCtx` first (see context.ts). Sibling
 * calls in this file are direct; a call into another module, and every use of a
 * function as a value (an event listener), goes through `start.<module>.<fn>`. Extracted verbatim
 * from mountStart() by scripts/split-closure.ts.
 */
import { announce } from '../../a11y.ts';
import { bustFontRegistry } from '../../bridge/font-registry.ts';
import { t, tRaw } from '../../i18n.ts';
import { stashPendingLogoFiles } from '../../lib/design-system/pending-files.ts';
import type { PdfFontCandidate } from '../../lib/design-system/sources/pdf.ts';
import { detectFontFormat } from '../../lib/font-utils.ts';
import { playSfx } from '../../lib/sfx.ts';
import { installFontFromBytes } from '../../user-fonts.ts';
import type { UserFontsHost } from '../../user-fonts.ts';
import { escape as escapeText } from '../../utils.ts';
import { MAX_PDF_FONT_ROWS, faceChipText } from './shared.ts';
import type { PdfFontRow } from './shared.ts';
import { bindOp, type StartCtx } from './context.ts';

/** What kind of font file these bytes are, through the same magic-number read
 *  the install itself performs. Only the first four bytes are copied: a
 *  Uint8Array's own `.buffer` is the whole allocation behind it, which for a
 *  face lifted out of a PDF can be the document. */
export const formatOf = (_start: StartCtx, bytes: Uint8Array): ReturnType<typeof detectFontFormat> =>
  detectFontFormat(bytes.slice(0, 4).buffer as ArrayBuffer);
export const pdfResultEl = (start: StartCtx): HTMLElement | null =>
  start.importModal?.el.querySelector<HTMLElement>('[data-ds-pdf-result]') ?? null;
/**
 * One PDF, scanned into design-system material.
 *
 * The scanner returns a refusal rather than throwing, so every failure here is
 * a sentence rather than a lost drop. Colours and families go straight to the
 * tray (which says how many it kept, through the same note line the progress
 * used); the marks and the faces need a decision, so they are painted into the
 * stage's result card and wait there.
 */
export const scanPdfFile = async (start: StartCtx, 
  file: File,
  note?: (msg: string, isError?: boolean) => void
): Promise<void> => {
  const { host } = start;
  start.pdfPicks = [];
  start.pdfFonts = [];
  start.pdfStem = file.name.replace(/\.[^./\\]+$/, '') || file.name;
  const before = pdfResultEl(start);
  if (before) {
    before.hidden = true;
    before.textContent = '';
  }
  // Escape CANCELS, and a cancel keeps nothing. The read cannot be called back
  // once the chunk is running, so the cancel is enforced at the one place it
  // matters: the commit. Identity, not truthiness - a scan started from the
  // drag-anywhere path can legitimately run with no dialog at all.
  const startedIn = start.importModal;
  const cancelled = (): boolean => !!startedIn && start.importModal !== startedIn;

  note?.(tRaw('Reading {filename} on this device…', { filename: file.name }));
  // The only step that can throw is loading the chunk itself - the scan reports
  // every failure of its own as a value, so that a bad drop is a sentence.
  let source: typeof import('../../lib/design-system/sources/pdf.ts');
  try {
    source = await import('../../lib/design-system/sources/pdf.ts');
  } catch {
    note?.(t('The PDF reader could not be loaded. Reload the page and try again.'), true);
    return;
  }
  const result = await source.scanPdfForDesignSystem(
    host as unknown as Parameters<typeof source.scanPdfForDesignSystem>[0],
    file,
    {
      onProgress: (phase) => {
        // A cancelled scan stops talking. `note` falls back to the rail when
        // the dialog is gone, so without this the progress of a read nobody
        // is waiting for keeps posting itself onto the page behind it.
        if (cancelled()) return;
        if (phase === 'vectors') note?.(t('Looking for marks and colours…'));
        else if (phase === 'fonts') note?.(t('Reading the fonts…'));
      },
    }
  );

  // The dialog went away while the reader ran: the person cancelled, so the
  // findings are dropped whole. Nothing is kept, nothing is said - a rail note
  // reporting colours somebody just cancelled out of is the confusing half of
  // a half-cancel, and the marks and faces were being discarded anyway.
  if (cancelled()) return;

  if (result.kind === 'refused') {
    note?.(
      result.reason === 'too-large'
        ? tRaw('{filename} is too large (max {n} MB).', {
            filename: file.name,
            n: Math.round((result.limit ?? 0) / (1024 * 1024)),
          })
        : tRaw('{filename} could not be read as a PDF.', { filename: file.name }),
      true
    );
    return;
  }

  // The tray first: it is the one place a source's findings wait, and its own
  // count is the answer to "what did that do", so it replaces the progress line.
  await start.candidates.keepInTray(result.census, note);

  start.pdfPicks = result.logoPicks;
  start.pdfFonts = result.fontCandidates.slice(0, MAX_PDF_FONT_ROWS).map(
    (c: PdfFontCandidate): PdfFontRow => ({
      family: c.family,
      raw: c.raw,
      chips: c.chips,
      bytes: c.bytes,
      subset: c.chips.includes('SUBSET'),
      format: formatOf(start, c.bytes),
    })
  );
  renderPdfResult(start, {
    filename: file.name,
    marks: start.pdfPicks.length,
    hiddenFonts: Math.max(0, result.fontCandidates.length - start.pdfFonts.length),
    pageWindow: result.pageWindow,
    pages: result.pageCount,
    warnings: result.warnings,
  });
};
/**
 * The PDF stage's result card: what the scan found, and the two things that can
 * be done with it without leaving the dialog.
 *
 * A warning is printed for each half that did not run. "No fonts" and "the font
 * table could not be read" are different facts, and a card that shows the first
 * when the second happened is lying by omission.
 *
 * The card is a status message with controls in it, so it does BOTH things
 * showImportResult does for the sibling card: its one-sentence summary is
 * spoken, then focus moves into it. Focus alone is not an announcement - a
 * `tabindex="-1"` div has no role and no name, so a reader that reaches it
 * says nothing at all, and the marks, the faces and the warnings would go
 * unheard behind the tray's own count.
 */
export function renderPdfResult(start: StartCtx, o: {
  filename: string;
  marks: number;
  hiddenFonts: number;
  pageWindow: number;
  pages: number;
  warnings: readonly string[];
}): void {
  const el = pdfResultEl(start);
  if (!el) return; // the dialog closed while the scan ran - the tray still has it
  const warnings: string[] = [];
  if (o.warnings.some((w) => w.startsWith('vectors'))) {
    warnings.push(
      t('The artwork in this document could not be read, so no colours or marks came from it.')
    );
  }
  if (o.warnings.some((w) => w.startsWith('fonts'))) {
    warnings.push(t('The fonts in this document could not be read.'));
  }
  const fontRows = start.pdfFonts
    .map(
      (row, i) => `
      <li class="ds-pdf-font">
        <span class="ds-pdf-font-name">${escapeText(row.family)}</span>
        <span class="ds-pdf-font-chips">${row.chips
          .map(
            (chip) => `
          <span class="ds-pdf-chip${chip === 'SUBSET' || chip === 'restricted' ? ' ds-pdf-chip--warn' : ''}">${escapeText(faceChipText(chip))}</span>`
          )
          .join('')}
        </span>
        ${
          row.format === 'unknown'
            ? `<span class="ds-pdf-font-note">${t('These are raw font-program bytes, not a file that can be installed.')}</span>`
            : `<button type="button" class="be-btn be-btn--sm ds-pdf-add" data-ds-pdf-font="${i}">${t('Add to the design system')}</button>`
        }
      </li>`
    )
    .join('');

  el.innerHTML = `
      <p class="start-import-name">${escapeText(o.filename)}<span class="start-import-source">${t('PDF')}</span></p>
      ${
        o.pages > o.pageWindow
          ? `<p class="start-import-stats">${t('Marks and colours were taken from the first {n} pages of {total}.', { n: o.pageWindow, total: o.pages })}</p>`
          : ''
      }
      ${warnings.map((w) => `<p class="start-import-warn">${escapeText(w)}</p>`).join('')}
      ${
        o.marks
          ? `
        <div class="start-color-actions">
          <button type="button" class="be-btn be-btn--sm ds-pdf-logos" data-ds-pdf-logos>${t(
            o.marks === 1 ? 'Review {n} mark in Logos' : 'Review {n} marks in Logos',
            { n: o.marks }
          )}</button>
        </div>`
          : ''
      }
      ${
        fontRows
          ? `
        <p class="ds-src-stage-note">${t('Fonts in this document')}</p>
        <ul class="ds-pdf-fonts" role="list">${fontRows}</ul>`
          : ''
      }
      ${
        start.pdfFonts.some((r) => r.subset)
          ? `<p class="start-import-warn">${t('A subset carries only the characters this document printed, so it will be missing others.')}</p>`
          : ''
      }
      ${
        o.hiddenFonts
          ? `<p class="start-import-stats">${t(
              o.hiddenFonts === 1
                ? '{n} more font is embedded in this document.'
                : '{n} more fonts are embedded in this document.',
              { n: o.hiddenFonts }
            )}</p>`
          : ''
      }
      ${
        !o.marks && !fontRows && !warnings.length
          ? `<p class="start-import-stats">${t('No marks and no embedded fonts were found in the pages that were read.')}</p>`
          : ''
      }
      <p class="ds-src-stage-note">${t('Images, text and attachments are in Unpack, which asks for the file again.')}</p>
      <a class="be-btn be-btn--sm ds-pdf-more" href="#/unpack">${t('Open Unpack')}</a>`;
  el.hidden = false;
  // What the card SAYS, in one line: the two counts it offers a decision on,
  // plus any half of the scan that did not run. Deliberately not the whole
  // card read aloud (the caveats, the hidden-font tally and the way out are
  // all there to be read at leisure) and deliberately not the tray count,
  // which keepInTray already said through the dialog's own note line.
  const said: string[] = [...warnings];
  if (o.marks)
    said.push(o.marks === 1 ? t('1 mark found') : tRaw('{n} marks found', { n: o.marks }));
  if (start.pdfFonts.length) {
    said.push(
      start.pdfFonts.length === 1 ? t('1 font found') : tRaw('{n} fonts found', { n: start.pdfFonts.length })
    );
  }
  if (!said.length)
    said.push(t('No marks and no embedded fonts were found in the pages that were read.'));
  announce(said.join(' '));
  // The card is a status message with controls in it, exactly like the design
  // file card's - focus moves to it so a screen reader reads from where the
  // buttons are, rather than being read the whole thing over the tray's own line.
  el.focus();
}
/**
 * Install one embedded face (plan 97 section 7.2 / M5).
 *
 * `installFontFromBytes` is the whole vetting story - the cap, the magic
 * number, the name table, the fsType reading and the variable axis - and it
 * returns null rather than throwing for bytes it cannot use. So the judgement
 * here is only what to SAY: a refusal is reported plainly and the control goes
 * back to being an offer, and a subset that installs is still called a subset,
 * because the missing characters turn up long after this dialog is closed.
 *
 * Busy and added are `aria-disabled`, never `disabled`: disabling the button
 * under the press hands focus to the body, and on the failure path there would
 * be nothing to hand it back to.
 */
export async function addPdfFont(start: StartCtx, index: number, btn: HTMLButtonElement): Promise<void> {
  const { host } = start;
  const row = start.pdfFonts[index];
  if (!row || btn.getAttribute('aria-disabled') === 'true') return;
  const was = btn.textContent;
  btn.setAttribute('aria-disabled', 'true');
  btn.textContent = t('Adding…');

  let family: string | null = null;
  // A throw and a null are different answers, and only one of them means
  // nothing was written: installFontFromBytes stores the asset first and
  // registers/promotes it afterwards, so a failure in a later step leaves the
  // face already saved. Claiming "nothing was added" there would be false.
  let threw = false;
  try {
    const installed = await installFontFromBytes(host as unknown as UserFontsHost, row.bytes, {
      filename: `${(row.raw || row.family).replace(/[^a-z0-9.+-]/gi, '_')}.${row.format}`,
    });
    family = installed?.family ?? null;
  } catch (err) {
    // installFontFromBytes returns null for bytes it cannot use rather than
    // throwing, so anything caught here is unexpected: log it, and say the
    // one thing that is certainly true - this did not finish.
    threw = true;
    (host as unknown as { log?: (level: string, msg: string, ctx?: object) => void }).log?.(
      'warn',
      'start: pdf font install failed',
      { error: String((err as { message?: unknown })?.message ?? err) }
    );
  }
  if (!family) {
    btn.textContent = t('Could not add');
    announce(
      threw
        ? tRaw(
            '{name} could not be added. Part of it may have been saved, so check the fonts in the design system before trying again.',
            { name: row.family }
          )
        : tRaw('{name} could not be read as a font, so nothing was added.', { name: row.family }),
      { assertive: true }
    );
    setTimeout(() => {
      if (!btn.isConnected) return;
      btn.textContent = was;
      btn.removeAttribute('aria-disabled');
    }, 1800);
    return;
  }
  // The face is a user font now, so the Type room has to be told: the registry
  // caches its resolutions and the room paints from the document.
  try {
    bustFontRegistry();
    await start.editor?.reload();
  } catch {
    /* it installed either way */
  }
  // Said before the button is touched: the face was saved whether or not the
  // dialog is still open, and a closed dialog must not swallow the one
  // sentence that reports it.
  announce(
    row.subset
      ? tRaw(
          '{family} added to the design system. It is a subset, so characters this document did not print are missing from it.',
          { family }
        )
      : tRaw('{family} added to the design system', { family })
  );
  playSfx('save');
  if (!btn.isConnected) return;
  // A quiet, permanent state: offering to install it again would say the first
  // press did nothing.
  btn.textContent = t('Added');
  btn.classList.add('is-added');
}
/**
 * The marks, to the Logos room.
 *
 * The stash is armed HERE rather than at scan time: it survives one navigation
 * and is drained by the room's own paint, so arming it for a scan nobody acted
 * on would drop chips into some later visit that were never asked for.
 *
 * And it REMOUNTS the studio on the Logos room rather than flipping rooms in
 * place, because the drain runs from that paint and the paint runs on a mount
 * (lib/brand-editor.ts). This is the same door #/pdf's own "Send to Logos"
 * goes through, so a mark arrives the same way whichever one sent it. The
 * remount reads `hasPendingLogoFiles()` and focuses the destination room.
 *
 * The stash reports what it actually armed, and this says so: a mark can be
 * refused for being over its 4 MB cap (an extracted mark inherits the page's
 * inlined rasters, so a logo over a photograph can be), and a button that
 * promised three marks must not navigate to a room holding two without
 * mentioning it - or, when nothing survived, navigate at all.
 */
export function sendPdfMarksToLogos(start: StartCtx): void {
  if (!start.pdfPicks.length) return;
  // Named after the mark's place in the document, not its rank in this list:
  // the same number the exploder's tile carries, so one document names its
  // marks the same way whichever door sent them.
  const { sent } = stashPendingLogoFiles(
    start.pdfPicks.map(
      (pick) =>
        new File([pick.svg], `${start.pdfStem}-logo-${pick.index + 1}.svg`, { type: 'image/svg+xml' })
    )
  );
  if (!sent) {
    start.sources.srcNote(
      start.pdfPicks.length === 1
        ? t('That mark is over the 4 MB limit, so it was not sent.')
        : t('Those marks are all over the 4 MB limit, so none were sent.'),
      true
    );
    return;
  }
  // Said out loud rather than into the dialog's note: the remount below takes
  // the dialog with it, and the live region is body-mounted and survives it.
  if (sent < start.pdfPicks.length) {
    announce(
      tRaw('{n} of {total} marks were sent. The rest are over the 4 MB limit.', {
        n: sent,
        total: start.pdfPicks.length,
      })
    );
  }
  playSfx('click');
  sendToLogosRoom(start);
}
/** The one way this view hands marks to the Logos room. The room drains the
 *  stash from its own PAINT, and the paint runs on a mount, so this remounts
 *  the studio on that room rather than flipping to it in place. */
export function sendToLogosRoom(_start: StartCtx): void {
  // A start→start hand-off: REPLACE the current history entry rather than
  // pushing a new #/start?area=logos one. A push left a phantom studio stop
  // that the browser Back button (and the back pill's history.back()) had to
  // unwind before it could leave the studio at all - the "back loop" that
  // stranded anyone who reached /start mid-session. The remount is what drains
  // the logos stash (the room reads it on paint), so it fires unconditionally.
  // Like selectRoom, this writes `area` alone: the one-shot arrival flags
  // (focus/wheel/import/source/seed) are consumed on mount by design and must not
  // be carried forward - a remount would re-fire them.
  try {
    history.replaceState(null, '', '#/start?area=logos');
  } catch {
    /* sandboxed */
  }
  window.dispatchEvent(new Event('lolly:remount'));
}
export function pdfOps(start: StartCtx) {
  return {
    formatOf: bindOp(start, formatOf),
    pdfResultEl: bindOp(start, pdfResultEl),
    scanPdfFile: bindOp(start, scanPdfFile),
    renderPdfResult: bindOp(start, renderPdfResult),
    addPdfFont: bindOp(start, addPdfFont),
    sendPdfMarksToLogos: bindOp(start, sendPdfMarksToLogos),
    sendToLogosRoom: bindOp(start, sendToLogosRoom),
  };
}
