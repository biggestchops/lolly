# Emoji source specimens

These three unchanged SVGs exercise source-pack admission and dependency resolution. They are not complete families and are not installed into a community profile. `packs.lock.json` records immutable upstream commits, original URLs and exact file hashes. The manifests preserve each source's notices and licence separately.

| Specimen | Source release and artwork | Terms |
|---|---|---|
| OpenMoji, grinning face | [17.0.0, color/svg/1F600.svg](https://github.com/hfg-gmuend/openmoji/blob/f9fc506a3f913be9897ab0181d611d4c910a4104/color/svg/1F600.svg) | OpenMoji contributors; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). All emojis designed by OpenMoji, the open-source emoji and icon project. See `openmoji/LICENSE.txt`. |
| Twemoji, grinning face | [17.0.3, assets/svg/1f600.svg](https://github.com/jdecked/twemoji/blob/b6b55fef1e8636b540a6d016a4729ca8cdf2e60b/assets/svg/1f600.svg) | Twitter, Inc. and other contributors; [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See `twemoji/LICENSE.txt`. |
| Noto Emoji, grinning face | [v2.051, svg/emoji_u1f600.svg](https://github.com/googlefonts/noto-emoji/blob/8998f5dd683424a73e2314a8c1f1e359c19e8742/svg/emoji_u1f600.svg) | Copyright 2013 Google, Inc.; [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0). The SVG-specific notice is in `noto/LICENSE.txt`; full terms are in `noto/Apache-2.0.txt`. |
| Noto Emoji, tornado | [v2.051, svg/emoji_u1f32a.svg](https://github.com/googlefonts/noto-emoji/blob/8998f5dd683424a73e2314a8c1f1e359c19e8742/svg/emoji_u1f32a.svg) | Same terms as above. Added 2026-09-12 as the real clipPath-through-use specimen (Illustrator's idiom) for the widened static subset; `tests/emoji-svg.test.ts` proves its canonical form decodes to the source pixels at three sizes. |

The source licence files are retained unchanged. SVG bytes are untouched: source and asset hashes currently match. The added JSON manifests and test code are Lolly metadata/code; they do not relicense the artwork.

The baseline metric is an explicitly provisional 0.85 em, with advance and em size derived from each source viewBox. The strict static-SVG subset and mixed-line specimen now produce canonical SVG and reference raster output. Since engine 1.196 a creative export records each placed pack as a Content Credentials source ingredient, so licence fulfilment on export is implemented; complete repertoire import is not, and these four specimens remain one glyph each. The visual comparison shows that OpenMoji's additional canvas padding needs optical metric normalization; source viewBox size alone is insufficient.

Run `node scripts/check-emoji-packs.ts` from the repository root to audit every pinned file offline. Run `node scripts/build-emoji-data.ts --check` for the independent Unicode source corpus.

`render.lock.json` pins the existing Outfit font, HarfBuzz WASM/glue bytes and the resvg reference version. `line.golden.json` records canonical SVG and decoded RGBA hashes for the fixed 48 px line in `tests/helpers/emoji-render.ts`. These were visually reviewed on macOS arm64. `replay-evidence.json` records the same hashes reproduced on Linux arm64 and Linux x86_64 (Node 24 in a container with the repository mounted read-only, resvg installed fresh for Linux) on 2026-09-12; `scripts/emoji-replay-linux.sh` reruns that comparison with podman or docker. A changed golden requires reviewing the source/implementation diff and regenerated comparison, not merely accepting new hashes, and the replay evidence must then be regenerated.

Run `node scripts/build-emoji-specimens.ts` to rebuild the local SVG/PNG comparison and source/recipe sidecars under `dist/emoji-specimens/`. The script retains upstream notices and Outfit's OFL alongside the results. These development outputs have no C2PA ingredient or completed attribution-delivery receipt. See `engine/emoji.md` for the supported SVG subset, current layout limits and remaining release gates.
