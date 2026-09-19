// SPDX-License-Identifier: MPL-2.0
import type { ExportOpts } from './export.ts';
import { presentationOf } from './presentation.ts';
import { renderPortableHtml } from './export-portable.ts';

type Render = (node: Element, format: string, opts: ExportOpts) => Promise<Blob>;

/** Bound and render a declared presentation kit through the normal export path. */
export async function renderPresentationKit(
  node: Element,
  opts: ExportOpts,
  render: Render,
  prepared: Render
): Promise<Array<{ name: string; bytes: Uint8Array }> | null> {
  const controller = presentationOf(node);
  if (!controller?.kit || !opts.portableDocument) return null;
  const kit = controller.kit();
  if (kit.variants.length > 36) throw new Error('Choose at most 32 rooms for one event kit.');
  const estimate = kit.variants.reduce((n, v) => n + v.markup.length * 2, 0);
  if (estimate > 96 * 1024 * 1024)
    throw new Error('The event kit is too large. Use fewer rooms or smaller images.');
  if (kit.video && controller.duration > 600)
    throw new Error(
      'The event kit video exceeds ten minutes. Choose fewer sessions or export the video separately.'
    );
  const members: Array<{ name: string; bytes: Uint8Array }> = [];
  let bytes = 0;
  const add = async (name: string, blob: Blob): Promise<void> => {
    bytes += blob.size;
    if (bytes > 256 * 1024 * 1024)
      throw new Error(
        'The event kit exceeds 256 MB. Use smaller images or export the video separately.'
      );
    members.push({ name, bytes: new Uint8Array(await blob.arrayBuffer()) });
  };
  const names = new Set<string>();
  for (const variant of kit.variants) {
    const name = variant.name.replace(/[^a-z0-9_-]/gi, '-').slice(0, 100) + '.html';
    if (names.has(name)) throw new Error('Event kit filenames must be unique.');
    names.add(name);
    await add(
      name,
      await renderPortableHtml(node, {
        ...opts.portableDocument,
        markup: variant.markup,
        ...(variant.static ? { script: '' } : {}),
      })
    );
  }
  const unfreeze = controller.freeze?.();
  try {
    await add('programme.pdf', await render(node, 'pdf', opts));
    const restore = controller.poster?.();
    try {
      await add('poster.png', await prepared(node, 'png', opts));
    } finally {
      restore?.();
    }
    if (kit.video)
      await add(
        'programme.mp4',
        await render(node, 'mp4', {
          ...opts,
          duration: controller.duration,
          durationUserSet: false,
          videoCodec: 'avc1.640028',
        })
      );
  } finally {
    unfreeze?.();
  }
  if (kit.calendar) await add('programme.ics', new Blob([kit.calendar], { type: 'text/calendar' }));
  await add('README.txt', new Blob([kit.readme]));
  return members;
}
