# Public-user walkthrough, 14 September 2026

This is a reviewer walkthrough and targeted regression testing, not an observation of unfamiliar users. Interruptions make elapsed completion times unusable; none are claimed.

## Environment

- Base: `0f7d69a74e08954c75a6ae9a68093ed511af6c0b`, with this branch's fixes.
- Profile: `lolly-start`; no private brand pack, sign-in or company assets.
- Catalog served by the isolated process: 66 tools, 88 templates before saving a user template.
- Development: `http://127.0.0.1:5188`; `http://localhost:5188` provided separate brand/storage state.
- Chrome on macOS. Initial QR and known-colour passes used Incognito. Import also checked in a normal window.
- A production build succeeds after `pnpm run build:ort`. Development behavior does not establish deployed-release or offline behavior.
- Fixtures and participant tasks are in this directory. Northstar is fictional.

## Observations

| Journey | Observed result | Evidence and limits |
| --- | --- | --- |
| Immediate useful file | Welcome → Explore → QR Code → Encodes: Link → URL → Export PNG. | The downloaded 600 × 600 PNG decodes to `https://example.org/welcome`. The gallery example initially selected Calendar event; the participant had to switch to Link. |
| Existing material | Make it yours → Bring a file → tokens JSON → choose `color.primary` → install. Then Open → `welcome.svg` → Edit in Design. | All four exact colours arrived. Five editable objects imported. Changed the headline to `Northstar open day` and downloaded an SVG. The original run clipped text; see the fix below. |
| Keep and reuse | Saved `Northstar announcement` in `Northstar launch`, saved a reusable template, reloaded Projects, then New asset → Templates → search Northstar and created `Northstar next event`. | The folder contained two distinct saved-session slots. Reopening the original still showed `Northstar open day`, confirming that editing the second creation did not overwrite it. The adjacent `+ Add` route and persistent browser restart now have automated coverage below. |
| Known colours, no file | Welcome → Make it yours → add blue `#0067B1` and yellow `#FFC72C` → assign colour roles → Explore tools → Design. | No brand file or sign-in required. Both swatches remained through navigation/reload. The downloaded ZIP exposed an export scaling defect; see the fix below. A later check showed Secondary was still unassigned, explaining the grey accent. Explicitly selecting Northstar Yellow produced a saved confirmation; both role choices and the committed Northstar name then survived reload. Persistence after all Incognito windows close is not established. |

Font snapping is intentional: imported text adopts Lolly's brand font vocabulary. Andy confirmed that a brand user should add their own font in Make it yours → Type. Substitution itself is not a defect.

## Changes made from the walkthrough

- A tool field's visible caption now names and focuses its control even when help/data buttons precede it. The QR URL field exposed this problem.
- Renaming a swatch updates the accessible name of its selection checkbox immediately.
- SVG text uses unpadded bounds measured in the resolved brand font, retaining existing space and growing when needed. The source's tight glyph bounds previously clipped the replacement font. Authored font size and intentional font snapping remain.
- An SVG import that substitutes fonts offers an explanation and an Add brand fonts action, leading to Make it yours → Type. Keep editing retains the current font choice.
- Internal design-system state, including the import checkpoint ring, no longer appears as a resumable project.
- Still export temporarily removes both the inner canvas fit scale and the outer pan/zoom transform, restoring them afterwards. Leaving the outer scale active caused the carousel's headline to fall outside the exported page. A browser regression downloads the three-page PNG ZIP at two zoom levels, checks every page's dimensions, verifies lower-page text pixels and confirms that the editor view returns.

The native browser download was repeated after the scale fix. `Northstar announcement corrected.zip` contains three 1080 × 1350 PNGs; the cover visibly retains `Northstar open day` and `Swipe →`. Local output and checks are under `output/lolly-public-journeys-2026-09-14` beside the checkouts. The earlier failed exports are retained separately for comparison.

The geometry change is checked against the simple text/shape fixture, including both text layers, known-font behavior and returning from Type. It is not a claim of complete SVG fidelity for every transform or rich-text source.

## Priority completion, 14 September 2026

Brand recovery is now reachable from **Restore brand settings** in Make it yours. The dialog keeps a checkpoint of the settings it replaces. A persistent Chromium profile was closed and reopened: the selected blue tokens remained, and restoring **Before restore** brought the later yellow settings back. Recovery is scoped to the active brand and reports storage failures without overwriting the checkpoint ring.

The Projects picker renders previews for shipped and user templates through the shared brand-aware renderer. List failures retain usable choices and offer retry; preview failures retain a named card. Browser checks cover repeated **+ Add** creating distinct saved records with the original template unchanged, and **Open → edit → Save** filing and returning to the originating folder or root. The same walkthrough checks the create actions in Preview and List modes, Escape, focus restoration, both themes, large text and a 390px viewport.

Gallery navigation was exercised with keyboard, native horizontal wheel input and Chromium's touch input at a narrow viewport. The test controls preview completion order so gestures encounter a pending pane, then verifies that scrolling settles on a ready example. It also checks OS/app reduced motion and hidden previews. This is browser emulation, not an observation on a physical phone.

On the public production build, a QR tool and SVG export were warmed online. With the browser context's networking disabled, its URL was edited and a new 25,070-byte SVG was downloaded. The output parses as SVG, contains rendered geometry and differs from the online output. This establishes that cached edit/export path; it does not establish a cold offline visit or every tool's offline behavior. Files are in the local output directory alongside the earlier walkthrough exports.

The actual cold production gallery was also inspected before any Design preview was ready: all six pending dots and subdued arrows were visible, arrows reported disabled, and the New link remained usable. The settled brand rail, gallery card, Projects, template collection and picker were captured in both themes as signed SVGs. All ten baselines were inspected and repeated without changes; the focused documentation suite passed 69 checks and the built docs remain within their size budget.

## Remaining observation

Run the external-participant task sheet with people unfamiliar with Lolly. Keep their discovery, completion time, assistance and recoveries separate from these reviewer and automated checks. No external invitations were sent, and the four-journey research plan remains open for that observation.

## Validation

Targeted label, brand-editor, design-map and input-attribution checks: 113 passed. Checkpoint/state visibility checks: 12 passed. The SVG browser regression checks both text layers against the Inspector's overflow threshold, retains intentional font snapping, and visits Type and Back without losing the import. The carousel browser regression checks actual ZIP/PNG bytes. Both browser tests ran in Chrome with no skips. Web and test TypeScript checks, changed-file lint, maintainability, comment/UI-copy gates and the production build pass.
