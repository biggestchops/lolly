# Lottie and dotLottie

Engine 1.212 supports whole-animation clips, internal layer/property editing and structural `.lottie` export from Design. Imported layers retain their Lottie property model. The original upload stays unchanged.

## Data and playback

`dotlottie.ts` reads raw Lottie JSON and dotLottie v1 (`animations/`) and v2 (`a/`) archives. The manifest declares the available animations; its initial choice seeds the chooser. The original upload remains one unchanged asset, including every animation and any unexecuted state machine. Each Design box stores its own `animationId`. Save/share/portable `.lolly` documents retain that selector independently of the asset's default.

The light SVG player is lottie-web 5.13.0, without its expression interpreter. A sequence owns its players' clock; they do not autoplay or loop independently. A late player load requests a repaint at the paused playhead. Missing players fail movie export instead of silently substituting a still.

## Supported content

| Content | Current behavior |
|---|---|
| Shape, solid, image, null and nested composition layers | Preserved, including parent transforms, property easing, holds, spatial tangents and time remapping |
| Paths, rectangles, ellipses, groups, fill/stroke, gradients and trim paths in imported sources | Preserved |
| PNG, JPEG and WebP resources | Embedded data URLs or unambiguous archive members; exported into `i/`, with identical image references deduplicated |
| Clip placement, trim, speed and finite duration | Compiled into nested compositions with explicit time remapping |
| Outer x/y, uniform scale, rotation and opacity keys | Compiled from the engine's sparse-channel keyframe semantics; opacity is linear except for explicit holds |
| Native Design rectangles, rounded rectangles, pills, ellipses and paths | Solid fills and strokes lower to native Lottie shapes |
| Converted vectors with independent `pathPaint` fills, transforms or clipping | Refused instead of replacing their paint with the box's single fill |
| Native still images | Centred contain/cover fitting, transforms and transparency |
| Text/fonts, 3D, expressions, masks/mattes, blends, effects and unlisted shape operations | Refused with the source/layer named |
| Themed appearance | Refused; slots must be resolved before import |
| State machines and package playback preferences | Retained in original bytes; the chooser explains that Sequence plays a linear clip once |
| Native Design transitions, motion presets, unsupported effects or media | Export fails with a named feature; use movie export for those compositions |

Precompositions with their own frame rate differing from the root are refused; separate imported clips may use different rates. The package cache retains at most 16 sources and 128 MiB of expanded animation data. All animations in one source share the expansion budget, including repeated image references.

No resource URL causes a network fetch during admission. SVG image payloads and external fonts/images are refused. Import requires a clip lasting at least 100 ms. All 20 existing catalog Lottie animations pass the shared reader, including those using trim paths.

## Internal editing

Expand an animation clip with its **+** control or choose **Animation layers** in the clip inspector. Select a nested layer, then a property. The existing Sequence transport controls preview time. Layer names, visibility, in/out frames, position (including separated X/Y), anchor, nonuniform scale, rotation and opacity are editable. Shape fills and strokes expose static color, opacity and stroke width. Parent indices, asset references and non-rendering reference transforms are retained.

Property values and key times stay in the source model: frame numbers are in the containing composition, vectors retain their dimensions, and each property and axis retains its own easing. Keys can be selected, inserted, changed or deleted. The existing curve editor changes the selected segment; Hold applies to that property's segment. Inserting a numeric key subdivides its temporal curve without quantising it into Lolly's outer `kf` grammar. Scrubbing maps clip trim/speed and nested offsets/stretch/remapping to the selected composition's source frame.

Each box's append-only `animationEdits` string holds a version-1 revision bound to the admitted source JSON's SHA-256. It stores allowlisted edit operations, never source bytes or hidden asset references. The first change creates a revision; subsequent edits replace that string through ordinary document history. Preview and structural export call the same `applyLottieEdits` function, which validates and applies edits to a source clone. Duplicates have independent revision strings. **Reset internal edits** restores this clip's original source view in one undoable step. Other instances and the original asset remain available.

A nested composition reused inside one clip keeps that source relationship: editing it affects every occurrence within that clip. The editor states this scope. A remapped nested composition may visit the same source key at several timeline times, so clicking its key selects a source frame without guessing an inverse seek; scrub the existing timeline to preview it.

The current bounded editor preserves spatial position tangents when editing existing keys or easing. It refuses insertion inside a spatial curve, duplicate/unordered source key times, numeric subdivisions at unrepresentable easing extrema, and animated fill/stroke changes. Path geometry, group transforms, time-remap curves, fonts, masks, effects and interactive behavior have no new authoring controls. Existing supported source data remains intact. A revision is limited to 256 KiB and 512 operations; consecutive writes to the same value are coalesced. A changed source is refused rather than applying old edits to different content.

## Export contract

The runtime freezes `ExportOpts.sourceDocument` before export IO. Both web and CLI call `exportDesignLottie` over that snapshot and resolve source bytes through `host.assets`. They compile one artboard into one dotLottie v2 animation named `sequence`, using the Lottie 5.13 dialect. Native text is not silently converted to bitmaps.

A new imported document adopts 24, 25, 30, 50 or 60 fps when the source uses that rate, otherwise its editing grid is 30 fps. The source's precise frame rate is retained. Export uses the project rate unless an explicit `fps` overrides it. Frame-domain keys, layer boundaries and offsets are retimed by the rate ratio; time-remap values remain seconds. No per-clip frame rounding accumulates. The animation interval is half open: render output frame times from zero while they remain below `op`; players may clamp seeks to their last frame. In/out markers cut the compiled composition through one additional time-remapped wrapper.

For interoperability, nonspatial layer position tracks with different axis curves export as separated X/Y tracks with the same motion. Layer anchor and scale tracks with different axis curves cannot use this representation; structural export names and refuses them because the independent player uses one curve for the vector. Use matching axis curves or movie export. The original source and its editable revision remain intact.

Output is deterministic for identical snapshots, resolved assets and metadata. Original download and edited export are different operations: the latter creates a new package. Readable credits and ordinary Lolly metadata travel as companion members. The writer reads credit members back and reports their hash and receipt. `.lottie` does not carry a signed C2PA credential.

## Bounds and evidence

| Bound | Limit |
|---|---:|
| Source or output archive | 64 MiB |
| Expanded archive | 128 MiB |
| One JSON/member | 32 MiB |
| ZIP members | 2,048 |
| JSON depth / values | 64 / 500,000 |
| Source layers / animated keys | 2,000 / 100,000 |
| Internal revision / operations | 256 KiB / 512 |
| Image references / composed clips | 1,000 / 1,000 |
| Precomposition dependency depth | 32 |
| Width or height | 16,384 px |
| One raster image | 32 million pixels |
| Frame rate / duration | 1–240 fps / one hour |

These are admission limits, not mobile performance targets. Duplicate/unsafe members, missing resources, cyclic references, invalid timing and excessive complexity fail explicitly.

The synthetic fixtures in `tests/helpers/lottie-fixtures.ts` are MPL-2.0, authored in this repository. Structural and runtime/portable-document tests are in `tests/lottie.test.ts` and `tests/design-lottie.test.ts`. `tests/lottie.browser.test.ts` compares the production SVG renderer with independent ThorVG playback through pinned `@lottiefiles/dotlottie-web` 0.80.0 (MIT), loading its WASM locally. It covers mixed 24/25 fps sources, fractional 29.97 fps trim paths, nonzero in-points, nested time remapping, trim/speed, overlap, image packaging, holds, scale and opacity. It also compares compiled samples directly with the original source's corresponding times. Pixel checks allow edge antialiasing and raster resampling differences; PNG decoding makes both sides use straight RGBA before premultiplication.

Internal-edit coverage is in `tests/lottie-edit.test.ts` and `tests/lottie-internal.browser.test.ts`. The actual browser journey covers nested selection, key insertion/deletion, value/curve/color edits, visibility, undo/redo, independent duplicates and save/reopen/export. Portable-document and compact-state checks use the real runtime. Independent-player samples include edited nested transforms, per-property keys, independent position curves, color and layer intervals, with mean active-channel error below 12/255. Compiled source samples also match the source SVG player within 0.2/255 mean full-frame error. The `lottie-edits` mutation target covers the revision reader. The source property and layer contracts follow the [Lottie properties specification](https://lottie.github.io/lottie-spec/latest/specs/properties/) and [layer specification](https://lottie.github.io/lottie-spec/latest/specs/layers/).
