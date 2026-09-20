// SPDX-License-Identifier: MPL-2.0
/** Decode scene dependencies only when a document needs an asset walk. */
import { designSceneAssetIds } from '../../../../engine/src/design-scene.ts';
import { ensureSceneManifest, getSceneManifest } from './scene-manifest.ts';
export { SCENE_TOOL_ID, setSceneManifest, setSceneManifestLoader, ensureSceneManifest } from './scene-manifest.ts';

/** The asset ids one `boxes` row's scene references, and nothing for any other row. */
export function sceneRowAssetIds(record: Record<string, unknown>): string[] {
  if (record.kind !== '3d') return [];
  const scene = typeof record.scene === 'string' ? record.scene : '';
  if (!scene) return [];
  const sceneManifest = getSceneManifest();
  if (!sceneManifest) {
    void ensureSceneManifest();
    return [];
  }
  return designSceneAssetIds(scene, sceneManifest);
}
