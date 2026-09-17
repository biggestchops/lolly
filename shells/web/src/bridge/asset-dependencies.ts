// SPDX-License-Identifier: MPL-2.0
import { assetDependency } from '../../../../engine/src/asset-version.ts';
import { designSceneAssetIds } from '../../../../engine/src/design-scene.ts';
import type { InputManifest } from '../../../../engine/src/inputs.ts';

// ── scene boxes: the 3D Studio manifest, for the two asset walkers ──────────────
//
// A Design `kind:'3d'` box keeps its whole scene in ONE string field: the 3D Studio's
// own link query. The uploads it points at are ids inside that query, so neither asset
// walker can see them by walking objects - the query has to be decoded first, and
// decoding it needs the studio's manifest (which keys are assets, and the field order
// of the `subjects` / `objects` rows).
//
// The walkers are synchronous and are called from six places, none of which has a
// manifest to hand, so the manifest is REGISTERED here once and read synchronously
// after that. A walk that runs before it arrives starts the load and returns no scene
// ids for that pass, rather than guessing which values in a query are asset ids.
//
// The LOADER is injected rather than imported, the same inversion tauri-shared uses for
// `fs`: this module sits under bridge/state.ts, which the TUI and the Tauri shells both
// reach, and the web shell's tool loader is a Vite module (`import.meta.env`) that
// cannot be in either of those programs. So the web shell registers a loader once and
// everything else just reads the manifest.
/** The tool a scene box's query belongs to, and whose manifest reads it. One name for it,
 *  because the boot registration, the canvas mount and the editor door all need to agree. */
export const SCENE_TOOL_ID = '3d-studio';

let sceneManifest: InputManifest | null = null;
let sceneLoader: (() => Promise<InputManifest | null>) | null = null;
let scenePrime: Promise<InputManifest | null> | null = null;

/** Register the 3D Studio manifest directly (a test, or a caller that already has it). */
export function setSceneManifest(manifest: InputManifest | null): void {
  sceneManifest = manifest;
}

/** Register how to fetch the 3D Studio manifest. The web shell calls this once at boot
 *  with its own tool loader; a host without one simply never resolves scene ids. */
export function setSceneManifestLoader(load: (() => Promise<InputManifest | null>) | null): void {
  sceneLoader = load;
  scenePrime = null;
}

/** Load and register the manifest once. Awaited by the pack and beam paths before they
 *  walk. Safe to call repeatedly; a failed load is not fatal and the next caller retries. */
export async function ensureSceneManifest(): Promise<InputManifest | null> {
  if (sceneManifest) return sceneManifest;
  if (!sceneLoader) return null;
  scenePrime ??= sceneLoader()
    .then(manifest => {
      sceneManifest = manifest;
      return manifest;
    })
    .catch(() => {
      scenePrime = null;
      return null;
    });
  return scenePrime;
}

/** The asset ids one `boxes` row's scene references, and nothing for any other row. */
export function sceneRowAssetIds(record: Record<string, unknown>): string[] {
  if (record.kind !== '3d') return [];
  const scene = typeof record.scene === 'string' ? record.scene : '';
  if (!scene) return [];
  if (!sceneManifest) {
    void ensureSceneManifest();
    return [];
  }
  return designSceneAssetIds(scene, sceneManifest);
}

/** Metadata-only roots for cache retention and explicit version deletion. */
export function collectAssetRefs(value: unknown, refs: Set<string>): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) collectAssetRefs(item, refs); return; }
  const record = value as Record<string, unknown>;
  // A scene box's uploads are ids inside its `scene` query, never refs in the row, so
  // they are read out explicitly. Only a PINNED id becomes a root, exactly as for a ref
  // below: retention is about held versions, and an unpinned id names no version.
  for (const id of sceneRowAssetIds(record)) {
    const dep = assetDependency({ id });
    if (dep.pin?.version != null && dep.pin.format) refs.add(`${dep.id}:${dep.pin.format}:${dep.pin.version}`);
  }
  if ((record.source === 'library' || record.source === 'user') && typeof record.id === 'string') {
    const dep = assetDependency(record as { id: string });
    const version = dep.pin?.version ?? record.version;
    const format = dep.pin?.format ?? record.format;
    if (version != null && format) { refs.add(`${dep.id}:${format}:${version}`); return; }
  }
  for (const item of Object.values(record)) collectAssetRefs(item, refs);
}
