# Launch motion collection

Four editable 1920 × 1080 compositions share the same launch message:

| Template | Motion treatment |
| --- | --- |
| `launch-editorial` | Ordered headline lifts, a small settle, an assembling geometric mark and a long reading hold. |
| `launch-snap` | Anticipation, three type beats, restrained overshoot and answering graphic accents. |
| `launch-cascade` | Three benefit cards arrive in sequence. Each card and its contents share a translation track to stay aligned. |
| `launch-loop` | Type and ribbons assemble, hold, then depart in reverse order to the identical first pose. |

Open `#/tool/design?template=<id>`. Each template includes `calm` (7.5 s) and
`brisk` (4.2 s) presets; the base lasts 6 s. Add `&preset=calm` to the link, or
choose a pace in the template dialog. The editor opens at the readable poster;
an explicit `_t=` playhead in a link takes precedence.

Colours reference semantic `--brand-*` roles; fonts use `display`, `sans` and
`mono`. Text shrinks to fit its authored box when a brand's typography is wider.
Change the active design system to restyle the same composition. No brand artwork,
font files, remote media, or rendered video is embedded in these seeds.

All motion is ordinary `boxes` data: `lane`, `start`, `dur` and `kf`. Every
arrival, overshoot, settle and hold remains editable in the timeline and survives
URL mode. The corresponding four Choreograph recipes can be applied to a selection
with one button; length, stagger and order remain adjustable.

`motion` is discovery metadata only: collection, recipe, duration, poster time and
short beat descriptions. Preview and export hydrate the same Design template and
use the shared sequence clock. Reduced-motion users get still posters and may
explicitly play a preview. Only one discovery preview plays at a time.

After editing, rebuild and validate **all** mounted catalogs. Parent-repo checks:

```sh
pnpm run build:catalog:all
pnpm run validate:catalog:all
node --import ./tests/css-stub.mjs --test tests/launch-motion.test.ts
LOLLY_MOTION_TEST_URL=http://localhost:5173 LOLLY_MOTION_EXPORT=1 node --test tests/launch-motion.browser.test.ts
```

The browser check uses an isolated profile, installs two test brands, checks
desktop/mobile previews and loop poses, and writes sampled PNGs, WebM/MP4 exports
and timings to `/tmp/lolly-motion-223` (override `LOLLY_MOTION_TEST_OUTPUT`).

## Publishing collection

The **Publishing** filter offers three still, editable compositions:

| Template | What it demonstrates |
| --- | --- |
| `publishing-field-notes` | A portrait journal page with a balanced two-column article and named paragraph styles. |
| `publishing-long-read` | One article in three linked frames across two artboards; the opening frame also has two columns. |
| `publishing-type-in-orbit` | Separate circular and open curved guides, with ordinary editable source text. |

Open `/design?template=<id>`. These seeds carry a versioned `textDocument`,
ordered story/frame links and exact pins for the bundled SUSE and SUSE Mono
faces. The paper, ink and mint are authored artwork colours; the journal's
small accent follows the active brand. Source text remains editable and the
examples start without overflow. The text guide includes captured examples of
all three compositions.
