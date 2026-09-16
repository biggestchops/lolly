# 3D Studio

Studio for extruded SVG artwork and GLB/STL product imagery.

[User guide](../../docs/3d-studio.md)

The manifest supplies Guided and Expert views over the same saved inputs. Hooks resolve asset references and emit an escaped versioned data marker. They do not own a GPU context or load Three.js.

- `engine/src/studio3d.ts`: portable recipe normalization and turntable time.
- `engine/src/studio3d-collection.ts`: shared collection evaluation, per-item framing and deterministic output names.
- `packages/core/src/studio3d-v1.ts`: shared scene types.
- `shells/web/src/lib/studio3d/`: retained source, material, lighting, camera and capture implementation.
- Editor, multi-edit and batch/composition mount the same shell renderer. Exports await a successful render.

The existing `3d` tool keeps its own tool identity and saved sessions.

Run the scene and material tests with:

```sh
node --test tests/studio3d.test.ts tests/studio3d-materials.test.ts tests/studio3d-collection.test.ts
node --test tests/studio3d.browser.test.ts
STUDIO_SHELL_URL=http://127.0.0.1:5173 node --test tests/studio3d.shell.browser.test.ts
```

The browser tests need Playwright Chromium. `STUDIO_NATIVE=1` selects native Metal on macOS for local GPU review. `STUDIO_SUSE=1` enables the private six-icon fixtures when that brand pack is mounted. `STUDIO_SHOTS=<directory>` saves the fixture output for visual review.

Preview and export share the same recipe. GPU pixels are tested for repeatability on a given backend; equality across every GPU is not promised. SVG admission and output limits are documented in the user guide.

The collection review owns one temporary renderer and serializes preview updates. Closing it or changing settings invalidates unfinished previews. PNG sets use the normal batch job and its progress, cancellation and delivery behavior. Animated lights use saved clip time, never the wall clock, when exporting.
