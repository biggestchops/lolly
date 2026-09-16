# 3D Studio

Studio for extruded SVG artwork and GLB/STL product imagery, alone, as a collection of separate photographs, or arranged together in one scene.

[User guide](../../docs/3d-studio.md)

The manifest supplies Guided and Expert views over the same saved inputs. Hooks resolve asset references and emit an escaped versioned data marker. They do not own a GPU context or load Three.js.

- `engine/src/studio3d.ts`: portable recipe normalization and turntable time.
- `engine/src/studio3d-collection.ts`: shared collection evaluation, per-item framing and deterministic output names.
- `engine/src/studio3d-arrangement.ts`: several objects in one scene, with stable ids, selection, numerical edits, overlap guidance and the footprint pivot.
- `engine/src/studio3d-lights.ts`: light placement math (orbit about the subject, distance) and where a moved light is saved for preset and custom rigs.
- `packages/core/src/studio3d-v1.ts`: shared scene types.
- `shells/web/src/lib/studio3d/`: retained source, material, lighting, environment, camera and capture implementation. Objects that name the same bytes share one loaded asset; `environment.ts` generates the studio, soft box and window environments and decodes imported `.hdr`/`.exr` radiance maps.
- Editor, multi-edit and batch/composition mount the same shell renderer. Exports await a successful render and re-render at the export's pixel size (the frame clock's third argument).

The existing `3d` tool keeps its own tool identity and saved sessions.

Run the scene and material tests with:

```sh
node --test tests/studio3d.test.ts tests/studio3d-materials.test.ts tests/studio3d-collection.test.ts tests/studio3d-arrangement.test.ts tests/studio3d-environment.test.ts
node --test tests/studio3d.browser.test.ts
STUDIO_SHELL_URL=http://127.0.0.1:5173 node --test tests/studio3d.shell.browser.test.ts
```

The browser tests need Playwright Chromium. `STUDIO_NATIVE=1` selects native Metal on macOS for local GPU review. `STUDIO_SUSE=1` enables the private six-icon fixtures when that brand pack is mounted. `STUDIO_SHOTS=<directory>` saves the fixture output for visual review.

Preview and export share the same recipe. GPU pixels are tested for repeatability on a given backend; equality across every GPU is not promised. SVG admission and output limits are documented in the user guide.

The collection review owns one temporary renderer and serializes preview updates. Closing it or changing settings invalidates unfinished previews. PNG sets use the normal batch job and its progress, cancellation and delivery behavior. Animated lights use saved clip time, never the wall clock, when exporting.
