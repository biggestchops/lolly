// SPDX-License-Identifier: MPL-2.0
/**
 * Exports of a tool that shows a 3D studio scene.
 *
 * The export clock (bridge/frame-clock.ts) logs a frame that fails to render and carries
 * on, because most clocked tools are better served by a frame late than an export lost.
 * A studio frame that failed is a blank or stale picture, so the export that took it must
 * fail instead. This wrapper asks the studio after the export has run and throws its error,
 * which discards the output before anything is saved.
 *
 * It lives outside lib/studio3d/ and imports nothing, so the tool view can use it without
 * loading the studio or three.js (studio3d-boot-guard.test.ts pins that).
 */

/** The two studio mount functions an export needs (lib/studio3d/mount.ts provides them). */
export interface StudioExportHooks<Container> {
  prepareToolStudio(container: Container, quality?: 'preview' | 'export'): void;
  studioCaptureError(container: Container): Error | null;
}

/**
 * Run an export of `container`. Without a studio module this is `run()`. Otherwise the
 * studio first draws the frame at `prepare` quality when that is given, then the export
 * runs, and a capture error recorded meanwhile is thrown in place of the output.
 */
export async function withStudioExport<Container, T>(
  studio: StudioExportHooks<Container> | null | undefined,
  container: Container,
  run: () => Promise<T>,
  prepare?: 'preview' | 'export'
): Promise<T> {
  if (!studio) return run();
  if (prepare) studio.prepareToolStudio(container, prepare);
  const output = await run();
  const error = studio.studioCaptureError(container);
  if (error) throw error;
  return output;
}
