# Authored text composition

Engine 1.217 adds an optional composed-text path. Legacy text keeps its existing renderer until an explicit upgrade. The implementation is shared by web, CLI and the Node bridge used by TUI and MCP. Read [the Design text guide](/info/create/text-composition.html) for the editing workflow.

## Source and ownership

`TextDocumentV1` contains stories, named styles and content-pinned font resources. A story owns literal UTF-16 source, typed paragraph/soft breaks, paragraphs, spans, inline objects and ordered frame IDs. Frame geometry belongs to the container. The schema and `parseTextDocument` reject broken references, duplicate ownership, invalid source boundaries and oversized documents.

Design stores the document in the declared `textDocument` input (`tdoc` in URL mode). Appended box fields reference the story and frame settings. `pathPaint`, `vectorSource` and `textWrap` are also appended fields. Do not reorder the blocks wire format. Every command updates document and frame ownership in one transaction.

Edits preserve CRLF, NBSP, soft hyphens, combining sequences and literal Markdown. Visual case, inserted discretionary hyphens and display-only cleanup previews do not rewrite source. Inline vectors occupy U+FFFC with `originalText` retaining their semantic source. A plain-text copy restores that meaning.

## Shaping and layout

The SDK adds `host.text.fontInfo`, `shapeRun` and `layoutRuns`. The host supplies verified font bytes, XML parsing and the existing emoji service. Engine modules own bidi resolution, legal breaks, paragraph policy, frame flow, path placement, carets and SVG output. Font resources identify a face by SHA-256 and collection index. No platform font substitution is used in this path.

Unicode 17 grapheme, bidi and line-break data are pinned. Thai segmentation uses the bundled ICU dictionary and a bounded deterministic word search. Unknown runs remain intact. HarfBuzz shapes script runs with language, direction, variation axes and OpenType features. Metrics-only shaping avoids constructing outlines during measurement. Final lines are reshaped for their actual boundaries. Ligature carets use GDEF positions when present.

`layoutRuns` returns immutable-source ranges, visual runs, carets, resources, diagnostics and frame extents. SVG paths and native input projection consume that same result. `data-text-layout` is a receipt for authored document, resources and settled geometry. Consumers must not calculate independent browser line wrapping.

Standard composition retains legal greedy lines. Best paragraph scores admitted candidates across the paragraph; Balanced heading adds a preference for similar line lengths. Hard breaks, no-break ranges and cluster boundaries take priority over spacing preferences. The candidate graph has a fixed budget and reports its bounded fallback. Frame flow retries at most 12 width schedules; balancing uses at most 16 searches. Shrink-to-fit uses at most 12 searches and respects the smallest authored size. Linked frames cannot shrink independently.

A host-owned cache retains at most 32 prepared paragraphs within 32 MiB, with a separate 8 MiB settled flow snapshot and at most 128 prefix checkpoints. Individual line-shape caches are limited to 128 entries and 1 MiB. Source, ranges, styles, fonts, artwork, frames and wrap geometry invalidate the relevant work. A single paragraph bypasses prefix retention because every source edit invalidates that paragraph. Returned layouts cannot mutate cached revisions.

Settled clipboard receipts use a separate eight-entry, 32 MiB cache. Serialized receipts produce fresh objects on retrieval. Native glyph measurements retain at most 1,024 entries within 128 KiB. Cached screen transforms include all six matrix coordinates, so rotated frames invalidate their projections correctly.

## Native editing and collaboration

The web shell projects one logical contenteditable over settled source positions. Linked frames use their actual SVG screen transforms. Path holders follow curved baselines. The native surface retains clipboard, spellcheck, selection and IME behaviour; it does not own layout. DOM nodes are not replaced during active composition.

The current native font loader requires `faceIndex: 0`; other collection faces need a separate font file for editing. HarfBuzz composition and export retain the explicit collection index. When a frame disappears during composition, the native DOM draft is recovered before the editing surface is removed.

A text edit retains its local versions for safe cancellation. Before writing, a three-way record merge preserves unrelated incoming stories, fonts, styles and frames. Conflicting records are refused, and the local draft is retained for recovery. The existing collab transport remains whole-document LWW, not a character CRDT. Split text/frame deliveries are held until their ownership graph is consistent. Recovery is local and bounded to eight snapshots totalling 16 MiB.

## Paths, paint and exports

Path text accepts one paragraph and one continuous guide, with at most one traversal of a closed contour. It keeps joined clusters together and never reverses literal source. Compound guides, excessive geometry and unsupported typography combinations fail explicitly. Fit, reverse, side and baseline are authored settings.

Vector conversion uses the shaped geometry and admitted SVG paint. `pathPaint` references contours in the box's sole editable path field; it is not a second path store. Gradients, clips and group opacity retain their admitted structure. Inline conversion preserves fixed advances, semantic source and emoji credits. Ambiguous partial clusters, unsupported paint and split-text animation are refused. Linked detach/freeze uses a settled receipt before changing source ownership.

Design's export hook recomposes active stories and checks every in-scope SVG receipt. The runtime checks for input changes during asynchronous preparation. Missing artwork, stale layouts and unresolved errors cannot produce a successful export. Visible-only export is an explicit clipping policy. Hidden editable vector backups are validated as unplaced source without loading fonts; showing them again restores normal font checks.

Generated Design tools carry declared text fields, allowed styling and verified font resources. Strict workers return layout receipts for runtime verification. Portable files rekey font asset references and pins along with other session assets. The font receipt names pinned faces, variation settings and feature settings independently of any font bytes packaged under the asset policy.

SVG, PDF, raster and Sequence use settled outlines. PPTX and Penpot retain vector appearance rather than ordinary text editing for composed text. C2PA source credits for converted emoji follow the retained source census. Font identity receipts are reproducibility metadata, not a claim that every font permits redistribution.

## Evidence and limits

Focused tests cover full Unicode bidi/line-break conformance, literal edits, actual HarfBuzz/GDEF shaping, cache equivalence, wrapping, ownership commands, portable fonts, strict generated tools and export preflight. Browser journeys cover native editing, cross-frame selection, IME recovery, path editing, typography, vector conversion and format exports. CLI, TUI and MCP are compared through their real export entry points.

On the reference laptop, an isolated 20-sample run measured warm composition p95 of 33 ms for 2,000 characters and 245 ms for 20,000 characters across ten frames, including SVG generation. Native browser projection remains slower: steady samples are around 85-145 ms, with initial samples around 450-580 ms. The proposed 50 ms visible-feedback target is not met. Chromium at 200% browser zoom passes the compact-layout check. Physical-device IME, touch, screen readers and Office application review remain unverified; browser emulation does not establish those results.
