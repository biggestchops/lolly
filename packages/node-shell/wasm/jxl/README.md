# Portable JPEG XL codec

Built from libjxl 0.12.0, commit `a7a9c787341cf703dede03c2009fa460cae5e5df`, with Emscripten 4.0.23 (emsdk commit `c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56`). The libjxl Git submodule pointers pin Brotli, Highway and skcms. Licenses and the upstream patent notice are adjacent. libjxl, Highway and skcms use BSD licenses; Brotli uses MIT; Emscripten's MIT/NCSA terms cover its generated glue.

Run `bash scripts/build-jxl-wasm.sh` from the repository. It installs its toolchain into scratch storage, checks the source commits, builds the adapter in `scripts/jxl/adapter.cc`, and regenerates the Node worker with `scripts/build-jxl-worker.ts`. Node and browser workers execute the same adapter and options. The generated JS lives in `vendor/`; edit the source adapter, never the generated files.

No pthreads, SharedArrayBuffer, SIMD, dynamic evaluation, network or filesystem is required by the codec. The browser loads the local, content-hashed WASM only for an operation. Its service worker caches that file and worker chunks through the existing immutable-asset cache. Node loads the identical WASM from this directory. CLI/npm/desktop and MCP packaging include the complete directory.

The WASM is 2,532,768 bytes (951,010 bytes with gzip -9). SHA-256:

- `lolly-jxl.wasm`: `6a72b14c1f6c2530169b0554d862d60a629b496547c6ea6fecd44c554b7a9d8b`
- `vendor/lolly-jxl.mjs`: `8849cb0c8083d1e691d7119576131d6fd43f9f9d28dc1154b67efcb8e58d9063`

The wrapper has a 384 MiB libjxl allocation budget and a 768 MiB maximum WASM heap. Encoded input/output is limited to 128 MiB, still decode to 16 MP, still encoding to 8 MP, and each edge to 16384 pixels. Each operation owns a disposable worker with a two-minute deadline. One worker runs at a time per host, with at most 24 pending operations. Abort terminates active work.

Measured on the development Mac with Node 24.21.0, scalar single-thread codec, quality 0.9, effort 5, a photograph resized to 3200 x 2500: lossy encode 4.19 s, decode 0.65 s, 314,495 bytes, 404 MB WASM heap; lossless encode 2.90 s, decode 1.09 s, 2,318,403 bytes, 337 MB heap. These are desktop measurements, not mobile performance guarantees. The independent jxl-oxide 0.12.6 decoder reproduced all RGBA samples of the synthetic lossless fixture exactly, including transparent RGB. Physical mobile and HDR-display verification remains outstanding.
