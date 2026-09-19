# Brand derive: Lolly's local answer to Taste Labs

Date: 19 September 2026. Status: both implementation releases complete and locally verified.

## Product decision

The first release must win the first-use experience: bring a reference, see a useful proposed look, adjust it, and use it in Lolly. It is free and runs on the device. No hosted extraction service, subscription, API key, proxy, or required AI model is introduced.

Taste Labs advertises three jobs: extracting a design system, searching a curated inspiration collection, and verifying brand adherence. Its extraction is beta; search and verification are alpha. These are the vendor's descriptions, not measured quality claims. [Product and FAQ](https://tastelabs.com/api), [launch description](https://tastelabs.com/blog/helping-agents-create-things-worth-making), accessed 18 September 2026.

Lolly should compete on the complete creative workflow: references become editable tokens, those tokens drive the existing tools, and the user can inspect and undo changes. A palette dump does not fulfil that promise. A subjective quality score without evidence would not fulfil it either.

## What the supplied proposal missed

| Proposed foundation | Current implementation | Decision |
| --- | --- | --- |
| New brand derivation and colour libraries | `engine/src/brand-derive.ts`, `color-tools.ts`, `tokens.ts` | Reuse the existing colour maths, token aliases, themes and contrast handling. |
| Website extraction | `lib/design-system/extract-site.ts`, `sources/website.ts` | Reuse the bounded parser and native/extension transports. |
| New native fetch and extension | Native `site_fetch` and extension capture already exist | Preserve their consent and capability gates. Browser-only use needs local file/paste fallback. |
| Brand Studio | Design System studio, `views/start.ts` and its feature modules | Extend this existing flow and vocabulary. |
| Role inference and application | `brand-propose.ts`, `census.ts`, `studio-state.ts`, `start/tokens.ts` | Feed all references through the same role proposal and installation path. |
| PDF, SVG and raster extraction | Existing source adapters and image sampling | Improve the review experience rather than adding more decoders. |
| Provenance and signed output | Existing Content Credentials pipeline | A source report/checksum is evidence, not signed C2PA or proof of ownership. |

The extension reads a background page in the user's browser session. Native fetch is signed in to nothing. Plain web cannot fetch arbitrary sites under the current CSP. A saved page contains declared styles, not a computed rendering. None of these differences should be hidden.

## First tester release

1. Add a visual proposal to the existing image and website import flow. Raster references yield colours only; no font recognition is implied.
2. Add a local HTML/CSS source, with file selection first and pasted source as a secondary option. Read only explicitly provided text. Do not render imported HTML or fetch linked resources.
3. Preview a suggested design system before any write. Show its primary colour, surface, text and a small example composition. Let the person select a different observed primary colour. Derive the actual preview from the same token document that will be installed.
4. Keep one primary action, **Use this design system**. Explain that it replaces the active system's colours and other token settings and retains the existing font choices. Require a successful checkpoint before replacing existing settings. **Restore brand settings** recovers that checkpoint. Users can instead keep individual candidates through the existing tray.
5. Put source details, detected font names, and downloadable context under a disclosure. Fonts are observations, not downloaded assets. Preserve source metadata with the proposed tokens and in a portable JSON report. Do not include raw page text in that report.
6. Reuse the existing overview and tool entry points after install. Do not create a second editor, a second token store, or an onboarding flow that strands people at an extraction report.

## Interaction and visual design

- Use the existing modal, fields, buttons, icon set, typography, spacing and semantic colour tokens. Reference colours affect only the preview until application.
- Start with the material people have: logo/screenshot, existing design file, PDF, website when supported, saved HTML/CSS. Existing routes remain valid.
- Review is immediate and visual. Technical source metadata is optional. Empty and partial reads name what was found and the next useful action.
- Targets are at least 44 CSS pixels, wrap at tablet/phone widths, and remain usable with large text. Colour choices have text labels and native radio controls; colour alone never signals selection.
- Focus moves to the completed review. Escape, Back, source changes and a newer scan invalidate an earlier result. No hidden result may install or steal focus.
- Font names from references are shown as names. The preview uses the user's current font until they choose and install another in Type.
- The common path needs one source action, an optional colour adjustment, and one apply action. No account, permissions ceremony or advanced setup step is introduced.

## Architecture and performance

- Keep platform I/O in the shell. Existing pure engine derivation is the authority for generated colours and contrast.
- Add a small source adapter around `extractSite`, enforcing file count and byte limits before reading. Canonical ordering and SHA-256 identify the supplied snapshot, not the live website.
- Add a shared review model and feature module, accessed through `StartCtx` operations. Keep new UI out of the already large source orchestrator.
- Retain only bounded observations for review. No screenshots, document text, font files or full HTML are persisted as side effects of scanning.
- No new packages or runtime services. Heavy image/PDF decoders remain lazy. Local HTML/CSS parsing runs in a worker so it cannot block touch and keyboard interaction.

## Brand loading and component review

- Swatch ordering was missing. Extend the shared `reorder-list` component for grids, with dedicated 44-pixel handles, keyboard pickup/drop, cancellation and one undoable commit. Persist display order as stable token keys in the existing DTCG extension. Keep group changes in the existing Group and Move controls.
- Swatch selection targets were only 30 pixels. Increase the checkbox hit area to 44 pixels, separate from editing and dragging, and use existing semantic control and focus tokens.
- Design-system cards allowed overlapping asynchronous actions and could lose errors. Show loading status, block duplicate actions, retain failure messages, and restore focus and controls after completion. Continue using the single registry/switch pipeline.
- The overflow menu was only 32 pixels wide. Bring it and its menu actions up to the shared touch target.
- Refresh the documentation's retired palette-generation actions against the current UI. Review desktop, tablet, phone and large-text layouts and retain the current palette's undo and persistence path.

## Acceptance and release gate

- Unit tests: bounds before file reads; deterministic snapshots; malicious markup remains inert; missing/external styles are described honestly; primary choice changes both preview and exported tokens; fonts remain inherited; no source objects are mutated.
- Browser tests: desktop and touch viewport; no write until Apply; apply and restore; alternate colour selection; local file and paste; cancel/stale results; empty/errors; keyboard focus; no remote reads from imported source; no overflow at large text.
- Run type checks, the full repository test gate, ratcheting lint, wording, generated module inventories, parser inventory/assurance and production build budgets. Record any infrastructure limitation explicitly.
- Work in the isolated `codex/brand-derive-reviewed-import` checkout so ongoing sequence-editor changes are not included.
- Only after the exact tree is green: commit, stage the `lolly-start` build through the existing ship workflow and run its first-load checks. Then integrate and push to current remote main without discarding concurrent work. Main also starts an automatic production build: wait for CI and that build, then promote the measured staged deployment and verify its identity on `lolly.tools`.

## Remaining milestones: implemented

1. **Richer observations.** The existing browser extension now samples up to 200 visible elements, with a 1,000-element traversal bound. Typography, spacing and corner observations record measured values, occurrences, viewport and browser colour preference. Native and saved-page reads retain declared coverage. A shared normalizer bounds and revalidates every observation, lists missing fields and drops page text/selectors. Source details remain optional and never install fonts or geometry automatically.
2. **Local inspiration.** **Find a look** opens from Overview or Profile. It searches saved systems and three original Lolly examples by name, explicit tags or declared font. Palette similarity uses existing colour maths; matching font families break equal-distance ties. Users compare up to two specimens, with a persistent review action on small screens. Examples use the existing checkpoint/install flow; saved systems use the existing switch flow. Tag changes persist through the registry. There is no remote inspiration corpus.
3. **Explainable checks.** Export's existing check panel compares authored Design colours, aliases, font choices and asset IDs against the effective render snapshot, including a pinned version. Custom values are review items and absent evidence is unknown. Colour and font suggestions are individual, explicit changes through the tool's existing history wrapper. A fix rechecks the current system, layer ID, lock and original value before writing. It reads the composition after the asynchronous token lookup so a newer edit or lock is retained. Existing mounted contrast/layout checks remain in the same panel. No overall taste score is invented.
4. **Portable context.** The JSON context carries tokens, resolved values, recorded source evidence, coverage and explicit rules. The CLI imports both context and reference reports; `lolly system context` and `lolly system check` read local files or the terminal system. The existing MCP resource list gains `lolly://design-context`, backed by the same resolved document as a render. No service, subscription or model dependency is added.

## Component and performance review

- Profile, the local library and comparison now share one specimen renderer and stylesheet. The sheet loads with either view, so first-use previews do not depend on previously opening Profile.
- Existing modal, fields, buttons, tokens, focus styles, back handling and touch sizes remain the UI foundation. Applying a look is separate from selecting one. Technical evidence and context downloads stay under disclosure.
- Library reads run four at a time, at most 60 systems and 2 MiB per token document. Unavailable previews are counted and do not prevent usable systems loading.
- Repeated colours reuse their nearest-token comparison during a check. Checks run when Export is open, and stale async reports cannot replace a newer report. A pending check keeps the details surface open after an edit.
- Capture adds no permissions, renderer process or network transport. The extension update is optional; older extension replies still work with declared styles.

## Validation and tester handoff

Behavior tests cover evidence bounds and missing fields, actual extension collection, deterministic proposals, local discovery and tags, context import/CLI/MCP, guarded fixes, cancellation, and no writes on preview. Browser journeys cover local files, applied looks, tablet/phone with large text, context downloads, and a real Design fix followed by Undo. Existing swatch and import regression suites remain in the release gate.

Local verification on Node 24: the full gate passed with 17,466 passing tests and 273 expected skips. The final timing guard also passed its regression and browser journeys (nine focused tests). All 26 affected documentation captures matched. The 2,000-case source fuzz run found no crashes, hangs or allocation failures. Type checking, lint and wording ratchets, parser assurance, dependency audits, secret scanning and production budgets passed. Boot JavaScript was 157.9 KB compressed against 158 KB; built docs were 157.2 MB against 178 MB. Native Tauri checks skip locally when their separate packages are absent; CI installs those packages and runs the strict checks.

Moderated usability research still needs people: ask a new tester to choose or derive a look, apply it, make a composition, correct one wrong suggestion and restore the previous look. Record time, corrections, abandons and restore success manually. Shipping this implementation is not evidence that those user outcomes have been measured, and adds no background telemetry.
