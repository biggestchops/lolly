# Brand derive: Lolly's local answer to Taste Labs

Date: 19 September 2026. Status: first tester release implemented.

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
- Only after the exact tree is green: commit, integrate with the current remote main without discarding concurrent work, push, run the existing staged ship workflow for the `lolly-start` profile, then verify the promoted `lolly.tools` deployment.

## Following milestones, with explicit boundaries

These are subsequent releases, not claims of first-release parity.

1. **Richer observations:** computed typography/spacing/radius evidence from existing capture transports, with per-field coverage and cross-platform fixtures. Extend shared pure code only after the observation schema is proven. Do not add a privileged hidden browser by default.
2. **Local inspiration:** browse and compare the user's saved design systems and bundled, reusable examples. Rank by palette, type and explicit tags. No imitation search over a remotely scraped brand corpus. Validate whether this improves first-use success before expanding it.
3. **Explainable checks:** compare a composition's actual token references, colours, type, contrast and asset IDs with the selected design system; provide individual fixes. Keep missing evidence separate from a pass. No invented overall taste score.
4. **Portable context:** make the reviewed tokens, source coverage and rules consumable through Lolly's existing local CLI/MCP facilities if wanted. This is not a new hosted API product.

Measure success in moderated tester sessions: can a first-time user reach a result they want to keep without help, understand what Apply changes, and correct one wrong suggestion? Record time to first applied look, corrections, abandons and restore success without adding background telemetry.
