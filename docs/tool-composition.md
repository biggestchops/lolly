# Composition and brand overlays

Compose tools and resolve brand-specific logos and overlays.

Part of [Authoring Tools](/info/authoring-tools.html).

## Composition (`composes`)

A tool can embed **another tool's rendered output** as an image instead of re-implementing it. Declare it in the manifest and reference it in the template like any asset - no hook code, no copy-paste.

```jsonc
// tool.json
"capabilities": ["compose"],
"composes": [
  { "id": "badgeQr", "tool": "qr-code", "format": "svg",
    "inputs": { "url": "{{url}}", "color": "#0c322c", "join": true } }
]
```
```handlebars
{{!-- template.html - guard it: composition can fail gracefully --}}
{{#if badgeQr}}<img src="{{asset badgeQr}}" alt="">{{/if}}
```

- Each entry renders `tool` with `inputs` and exposes the result under `id` as an `{{asset <id>}}` extra (the same store hook-computed values use).
- String `inputs` values are **Handlebars**, hydrated against your tool's own context (its input values + extras), so a child input can bind to a parent value - e.g. `"url": "{{url}}"`.
- `format` (defaults to the child tool's first declared format, `render.formats[0]`) fixes the child render; `width`/`height` (px) default to the child's native size. **Compose any tool's render: an `svg` child stays a true vector when the parent exports to SVG or PDF and rasterises crisply for PNG; raster children (`png`, `jpg`/`jpeg`, `webp`) embed as images.** `svg` is the only format wired declaratively today (`event-name-badge` composes `qr-code` as `svg`) and is the best-supported. The enum also lists `pdf`, but a **PDF child is not supported as a source** - nothing inlines a PDF blob, so don't set `format: "pdf"`. HTML / Markdown / plain-text composition is **not** supported.
- The composed value is a **normal asset URL**, so it works in a CSS `url()` background just as well as in an `<img src>` - bring another tool in exactly like a library image.
- The child renders through the **same engine path** (pixel-identical) and is never watermarked or provenance-stamped (it's an intermediate). Recursion is **depth- and cycle-guarded**: `a → b → a` fails gracefully and the slot stays empty, so always `{{#if}}`-guard the reference.
- Works wherever the shell can render the child to bytes; the lean CLI composes `svg` children. The mechanism is `host.compose` - see [Host API](/info/host-api.html).
- **End users get this too, without a manifest.** Any `asset` input can take a pasted Lolly tool link (see [`asset` - library or device upload](/info/tool-files.html#asset-library-or-device-upload)); the host renders it through the same `host.compose` path. `composes` is for renders *you* wire into the layout; the pasted-link path is for the user to choose which tool fills an image slot.

### Composition depth and baking

Nesting is capped at **3 levels** - a tool composing a tool composing a tool. A deeper chain fails the same way a cycle does: gracefully, with an empty slot. When a design genuinely needs to go deeper, **bake** the inner render: tick *Freeze as a static image* in the picker's render card. A baked image is a frozen copy - self-contained bytes that consume **no** nesting depth and never live-re-render - so it won't update when the source tool changes. Its slot shows a "❄ baked from …" row with a **Re-bake** button (and an Edit path into the source tool's inputs) that re-renders on demand, so a stale copy is one click from fresh.

## Brand logo (auto-switching)

The catalog ships the SUSE logo as **8 variants** under `suse/logo/` - `{hor|vert}-{neg|pos}-{green|white|black}` (`hor`/`vert` = wide vs stacked; `neg` = for **dark** backgrounds, `pos` = for **light**; `green` is the brand mark, `white`/`black` are the high-contrast mono pair). A tool shouldn't hard-code one - it should pick the variant that fits the current background and space, and use the **actual SVG image** (this is distinct from `brand-lockup`, which renders the wordmark from the SUSE font, outlined via HarfBuzz `host.text`).

The pattern: a hook chooses the id, resolves it with `host.assets.get()` and hands the template a ready `<image>`/`<img>`:

```js
// hooks.js - WCAG luminance decides neg/pos; orientation + ink come from inputs.
function logoId(inputs) {
  const dark   = relLuminance(inputs.background) < 0.5;   // dark bg → neg
  const orient = inputs.orientation === 'vertical' ? 'vert' : 'hor';
  const ink    = inputs.ink === 'mono' ? (dark ? 'white' : 'black') : 'green';
  return `suse/logo/${orient}-${dark ? 'neg' : 'pos'}-${ink}`;
}
async function onInit({ model }) {
  const inputs = Object.fromEntries(model.map(i => [i.id, i.value]));
  return { logo: await host.assets.get(logoId(inputs)) }; // → extras.logo (an AssetRef)
}
```

```html
<!-- template.html - the actual SVG asset, not a font lockup -->
{{#if logo}}<image href="{{asset logo}}" .../>{{/if}}   <!-- inside an <svg> → true vector export -->
{{!-- or, in an HTML canvas: --}}
{{#if logo}}<img src="{{asset logo}}" alt="Logo">{{/if}}
```

Putting the `<image>` inside an `<svg>` lets the export inline it (data-URI) and emit **true vector SVG**; an `<img>` in an HTML canvas exports raster/PDF only. `tools/tool-logo/` is the reference implementation (background colour, orientation, brand/mono, transparent-bg export). Reusing this in another org: keep the structure and swap the `suse/logo/...` id prefix for your own logo namespace (same variant matrix).

## Brand overlays (`extends`)

A brand pack that only needs to tweak a community tool - a different template, a handful of re-worded translations - shouldn't carry a whole fork that silently drifts from its base. Instead, declare the brand's tool dir an **overlay**:

```json
// brands/<brand>/tools/<id>/tool.json - same id as the community tool
{
  "id": "color-palette",
  "extends": "community",
  ...
}
```

and keep **only the files that differ** in the overlay dir. The content resolver (`packages/node-shell/src/content-roots.ts`) then reads that tool as the per-file union of the base (`community/<id>/`) and the overlay (`brands/<brand>/tools/<id>/`), the same union for every consumer - a `dist/` build, the CLI, the dev server, the catalog signer:

- **Overlay wins** on any filename collision; everything else comes from the base.
- Composition recurses **one level** into subdirs (`i18n/`, `assets/`) - files there union per-file too; anything nested deeper is taken wholesale from the winning side.
- The `extends` field is **stripped from the composed `tool.json`**, so the engine, shells and catalog scripts always see a plain tool. Anything that reads manifest *bytes* goes through `readToolManifestText(id)` for exactly that reason, so the signed, served and shipped manifests are one set of bytes. Edit the pack source; there is no composed copy on disk to edit.
- Overlay and base **share the same tool id** (ids are permanent contracts; the URL `tools/<id>/` never changes), so the overlay's `tool.json` doubles as the marker carrier even when it's otherwise identical to the base's.

**Fail-closed:** a declared overlay whose base is missing (`community/<id>/tool.json` doesn't exist), an `extends` value other than `"community"` (the only base pack in v1) or an `extends` declared on a community tool itself fails loudly the first time anything resolves that profile, and is also rejected by `pnpm run validate:catalog`. You never get a silent partial tool. The composed result is validated like any other tool, because the validator asks the same resolver every shell asks.

[Back to Authoring Tools](/info/authoring-tools.html).
