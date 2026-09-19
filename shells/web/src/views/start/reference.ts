// SPDX-License-Identifier: MPL-2.0
/** The common, read-only proposal between a reference scan and an explicit install. */
import { t, tRaw } from '../../i18n.ts';
import type { DesignCensus } from '../../lib/design-system/census.ts';
import { referenceLook, referenceReport, type ReferenceEvidence } from '../../lib/design-system/reference-look.ts';
import { styleEvidenceHtml } from '../../lib/design-system/style-evidence-view.ts';
import { saveBlob } from '../../pro/zip.ts';
import { bindOp, type StartCtx } from './context.ts';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

export function cancelReference(start: StartCtx): void {
  start.referenceRevision = (start.referenceRevision ?? 0) + 1;
  start.referenceCancel?.();
  start.referenceCancel = undefined;
}

export function reviewReference(start: StartCtx, census: DesignCensus, evidence: ReferenceEvidence): void {
  const stage = start.importModal?.el.querySelector<HTMLElement>('[data-ds-stage]:not([hidden])');
  if (!stage) return;
  stage.querySelector('[data-reference-review]')?.remove();
  const card = node('div', 'ds-reference-review');
  card.dataset.referenceReview = '';
  card.tabIndex = -1;
  card.setAttribute('aria-label', t('Your suggested design system'));
  const title = node('h3', '', t('Your suggested design system'));
  const source = node('p', 'ds-src-stage-note');
  source.textContent = evidence.label;
  card.append(title, source);
  const status = node('p', 'ds-src-note');
  status.setAttribute('role', 'status');
  const error = (msg: string): void => { status.textContent = msg; status.classList.add('is-error'); };

  const nameLabel = node('label', 'field-label', t('Design system name'));
  const name = node('input', 'field-input');
  name.maxLength = 80;
  name.value = (census.name || evidence.label.replace(/\.[^.]+$/, '') || t('My design system')).slice(0, 80);
  nameLabel.append(name);
  let primary: string | undefined;
  const nameValue = (): string => name.value.trim() || t('My design system');
  const preview = node('div', 'ds-reference-preview');
  const eyebrow = node('span', 'ds-reference-eyebrow', t('Colour preview'));
  const sampleName = node('strong', 'ds-reference-name');
  const sampleText = node('p', '', t('Make something that feels like you.'));
  const sampleAction = node('span', 'ds-reference-action', t('Your next idea'));
  preview.append(eyebrow, sampleName, sampleText, sampleAction);
  preview.setAttribute('role', 'img');
  preview.setAttribute('aria-label', t('Example using the proposed colours and your current font'));
  const contrast = node('p', 'ds-src-stage-note');
  const paint = (): void => {
    const look = referenceLook(census, nameValue(), evidence, primary);
    for (const [key, value] of Object.entries(look.preview)) preview.style.setProperty(`--reference-${key}`, value);
    sampleName.textContent = nameValue();
    contrast.textContent = t('Preview contrast: text {text}:1, action {action}:1.', {
      text: look.contrast.text.toFixed(1), action: look.contrast.action.toFixed(1),
    });
  };

  if (census.colors.length) {
    const suggested = referenceLook(census, nameValue(), evidence).roles.primary;
    const choices = node('fieldset', 'ds-reference-choices');
    choices.append(node('legend', 'field-label', t('Main colour')));
    const colors = census.colors.slice(0, 12);
    const proposed = census.colors.find(c => c.hex.toLowerCase() === suggested.toLowerCase());
    if (proposed && !colors.includes(proposed)) colors[colors.length - 1] = proposed;
    for (const color of colors) {
      const label = node('label', 'ds-reference-choice');
      const radio = node('input', '');
      radio.type = 'radio';
      radio.name = 'reference-primary';
      radio.value = color.hex;
      radio.checked = color.hex.toLowerCase() === suggested.toLowerCase();
      const swatch = node('span', 'start-color-swatch');
      swatch.style.backgroundColor = color.hex;
      swatch.setAttribute('aria-hidden', 'true');
      label.append(radio, swatch, node('span', '', color.hex));
      radio.addEventListener('change', () => { primary = color.hex; paint(); });
      choices.append(label);
    }
    card.append(nameLabel, preview, choices);
    paint();
    name.addEventListener('input', () => { sampleName.textContent = nameValue(); });
    card.append(node('p', 'ds-src-stage-note', t('Lolly builds light and dark palettes from these colours. Your current fonts stay in place.')));
    card.append(node('p', 'ds-src-stage-note', t('This replaces the active design system’s colours and style settings. Restore brand settings recovers the previous version.')));
    const use = node('button', 'be-cta is-active', t('Use this design system'));
    use.type = 'button';
    use.dataset.referenceApply = '';
    use.addEventListener('click', () => {
      if (use.disabled) return;
      const look = referenceLook(census, nameValue(), evidence, primary);
      void start.tokens.install(look.doc, nameValue(), use, { onError: error, area: 'overview', requireCheckpoint: true });
    });
    card.append(use);
  } else {
    card.append(node('p', '', t('No usable colours found. Try a screenshot, or include the page’s CSS files.')));
  }

  const details = node('details', 'ds-reference-details');
  details.append(node('summary', '', t('Source details and individual choices')));
  details.append(node('p', 'ds-src-stage-note', evidence.method === 'image'
    ? t('Colours were sampled from this image. Fonts and layout were not recognised.')
    : evidence.method === 'svg'
    ? t('Colours were read from this SVG. Fonts and layout were not assessed.')
    : t('Colours and font names were read from declared styles. Layout and motion were not assessed.')));
  if (evidence.method === 'files' || evidence.method === 'paste') {
    details.append(node('p', 'ds-src-stage-note', t('Only the supplied HTML and CSS were read. Linked stylesheets, images and fonts were not fetched.')));
  }
  if (census.styles) {
    const observations = node('div', '');
    observations.innerHTML = styleEvidenceHtml(census.styles);
    details.append(observations);
  }
  if (census.fonts.length) {
    details.append(node('p', 'ds-src-stage-note', t('Detected font names. Open Type to choose or install a font.')));
    const fonts = node('ul', '');
    for (const font of census.fonts.slice(0, 12)) fonts.append(node('li', '', font.family));
    details.append(fonts);
  }
  if (census.colors.length) details.append(contrast);
  const individual = node('button', 'be-btn', t('Choose individual items in the tray'));
  individual.type = 'button';
  individual.addEventListener('click', async () => {
    if (individual.disabled) return;
    const modal = start.importModal;
    individual.disabled = true;
    try {
      await start.candidates.keepInTray(census, msg => { status.textContent = msg; });
      if (start.importModal === modal && start.shell.isConnected) {
        start.sources.closeImport();
        start.trayUi?.open();
      }
    } catch { error(t('Could not keep these items. Please try again.')); }
    finally { individual.disabled = false; }
  });
  if (census.colors.length || census.fonts.length) details.append(individual);
  const download = node('button', 'be-btn', t('Download design context'));
  download.type = 'button';
  download.addEventListener('click', async () => {
    try {
      await saveBlob(new Blob([JSON.stringify(referenceReport(census, nameValue(), evidence, primary), null, 2)], { type: 'application/json' }), 'lolly-design-context.json');
    } catch { error(t('Could not save the file. Please try again.')); }
  });
  details.append(download);
  if (evidence.sha256) details.append(node('p', 'ds-reference-hash', tRaw('Source SHA-256: {hash}', { hash: evidence.sha256 })));
  card.append(details, status);
  const change = node('button', 'be-btn', t('Change reference'));
  change.type = 'button';
  change.addEventListener('click', () => {
    start.reference.cancelReference();
    stage.classList.remove('has-reference-review');
    card.remove();
    stage.querySelector<HTMLElement>('input[type=file], .ds-src-urlfield')?.focus();
  });
  card.append(change);
  stage.classList.add('has-reference-review');
  stage.append(card);
  start.sources.srcNote('');
  card.focus();
  if (start.importModal) start.importModal.el.scrollTop = 0;
}

export function referenceOps(start: StartCtx) {
  return { cancelReference: bindOp(start, cancelReference), reviewReference: bindOp(start, reviewReference) };
}
