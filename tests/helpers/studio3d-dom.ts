// SPDX-License-Identifier: MPL-2.0
/**
 * Node support for the 3D Studio source loader.
 *
 * `loadStudioSource` parses SVG with the browser's DOMParser and XMLSerializer, and
 * three's SVGLoader parses the prepared markup the same way. Node has neither, so
 * `installStudioDom()` takes them from a jsdom window (jsdom 26.1.0, the root
 * node_modules copy) and puts them on globalThis. Nothing else is needed: SVGLoader
 * reads attributes and inline styles only, and prepareStudioSvg asks for nothing more.
 *
 * jsdom does not apply `<style>` rules to an XML document (a style element there has no
 * `sheet`), so a fill written as a class would reach the loader as the default black.
 * `inlineClassFills()` copies each `.class { property: value }` rule onto the elements
 * that carry the class, as presentation attributes, and removes the stylesheet. Only
 * plain class selectors are supported; anything else throws, so a fixture cannot pass
 * with a silently dropped rule.
 *
 * `loadSvgFixture()` runs the real loader on SVG text: a scene built by
 * `buildStudioScene` (source artwork, shape values as given) and a `read` that returns
 * the text as bytes.
 */
import { JSDOM } from 'jsdom';
import { buildStudioScene } from '../../engine/src/studio3d.ts';
import { loadStudioSource, type StudioAsset } from '../../shells/web/src/lib/studio3d/source.ts';

let installed = false;

/** Put jsdom's DOMParser and XMLSerializer on globalThis once per process. */
export function installStudioDom(): void {
  if (installed) return;
  const { window } = new JSDOM('');
  if (typeof globalThis.DOMParser === 'undefined') globalThis.DOMParser = window.DOMParser;
  if (typeof globalThis.XMLSerializer === 'undefined')
    globalThis.XMLSerializer = window.XMLSerializer;
  installed = true;
}

/** Copy class rules from `<style>` onto the classed elements and drop the stylesheet. */
export function inlineClassFills(svg: string): string {
  installStudioDom();
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('The fixture is not well-formed XML.');
  const rules = new Map<string, [string, string][]>();
  for (const style of [...doc.querySelectorAll('style')]) {
    const css = (style.textContent || '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = match[2]!
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part): [string, string] => {
          const colon = part.indexOf(':');
          if (colon < 1) throw new Error(`Unsupported declaration "${part}".`);
          return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
        });
      for (const selector of match[1]!.split(',').map((s) => s.trim())) {
        if (!/^\.[\w-]+$/.test(selector))
          throw new Error(`Only plain class selectors are supported, not "${selector}".`);
        const name = selector.slice(1);
        rules.set(name, [...(rules.get(name) ?? []), ...declarations]);
      }
    }
    const parent = style.parentElement;
    style.remove();
    if (parent && parent.localName === 'defs' && !parent.children.length) parent.remove();
  }
  for (const el of [...doc.querySelectorAll('[class]')]) {
    for (const name of (el.getAttribute('class') || '').split(/\s+/).filter(Boolean))
      for (const [property, value] of rules.get(name) ?? [])
        if (!el.hasAttribute(property)) el.setAttribute(property, value);
    el.removeAttribute('class');
  }
  return new XMLSerializer().serializeToString(doc);
}

export interface FixtureShape {
  /** Requested bevel in studio units. */
  bevel: number;
  /** Extrusion depth in studio units; the recipe default when left out. */
  depth?: number;
  /** Curve segments per curve; the recipe default (24) when left out. */
  smoothness?: number;
}

/** Load SVG text through the real studio loader, as an uploaded artwork file. */
export function loadSvgFixture(
  svg: string,
  shape: FixtureShape,
  signal: AbortSignal = new AbortController().signal
): Promise<StudioAsset> {
  installStudioDom();
  const scene = buildStudioScene({
    version: 1,
    values: { source: 'artwork', artwork: { url: '/fixture.svg', name: 'fixture.svg' }, shape },
  });
  const bytes = new TextEncoder().encode(svg);
  return loadStudioSource(scene, async () => bytes, signal);
}
