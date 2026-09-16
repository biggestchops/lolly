# Skera byte adapter

The upstream `skera` 0.7.0 crate and transitive versions are pinned in Cargo.lock. No upstream source is patched. The adapter exports three prefixed allocation/subsetting functions; it has no JavaScript runtime dependencies. See LICENSES.txt for upstream notices.

From the Lolly root: `node scripts/build-skera.ts`. Rust 1.96.0 and the wasm32-unknown-unknown target are required. The committed `skera.wasm` is the browser asset. Browser users do not install Rust. Release settings and the 128 MiB memory ceiling are in Cargo.toml and the build script.

The worker terminates after each subset or on abort/timeout, releasing its linear memory. The client serializes work, admits at most eight requests / 64 MiB input, and retains at most 16 subsets / 4 MiB accounted output and keys. Fonts over 32 MiB are declined.

Policy: retain glyph IDs, retain the missing-glyph outline, all layout scripts/features and names, no variation instantiation. The PDF writer uses original glyph IDs through Identity-H. Changing any selection/version requires a new SKERA_POLICY key. Font flags and supported TrueType outlines are checked at the PDF embedding boundary. This adapter is not a rights grant.

Verification: `node --test shells/web/src/bridge/font-subset.test.ts`; `node scripts/verify-skera-pdf.ts` additionally requires Poppler's pdftoppm/pdftotext. Source fonts remain authoritative for subsequent edits.
