// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { chromium } from 'playwright';

const origin = process.env.STUDIO_SHELL_URL;
const collectionPath =
  '/@fs' + fileURLToPath(new URL('../engine/src/studio3d-collection.ts', import.meta.url));
const step = (message: string) => {
  if (process.env.STUDIO_DEBUG) console.log(message);
};

test('3D Studio imports, reopens a portable model and exports through editor and batch', {
  skip: !origin && 'Set STUDIO_SHELL_URL to a running web shell.',
  timeout: 900_000,
}, async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.STUDIO_NATIVE
      ? { executablePath: chromium.executablePath(), args: ['--use-angle=metal'] }
      : {}),
  });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: 'block',
    });
    page.setDefaultTimeout(90000);
    await page.routeWebSocket(/127\.0\.0\.1/, (socket) => socket.close());
    page.on('pageerror', (e) => errors.push(e.message));
    step('studio: browser ready');
    await page.goto(
      `${origin}/t/3d-studio?source=model&samples=8&outputMode=object-shadow&camera.azimuth=42&camera.elevation=20&camera.fov=35&camera.zoom=1.4&c2pa=0&width=360&height=360`
    );
    step('studio: page loaded');
    await page.locator('[data-input-id="modelAsset"]').click();
    step('studio: model choice clicked');
    const upload = page.locator('input[type="file"][accept*=".glb"]');
    step('studio: picker opened');
    await upload.setInputFiles({
      name: 'duck.glb',
      mimeType: 'model/gltf-binary',
      buffer: await readFile('community/3d/assets/duck.glb'),
    });
    await page.locator('[data-studio-state="ready"]').waitFor();
    const values = await page
      .locator('[data-lolly-studio]')
      .evaluate((el) => JSON.parse((el as HTMLElement).dataset.lollyStudio!).values);
    assert.match(values.modelAsset.id, /^user\/upload\//);
    await page.locator('[data-input-id="controls"]').selectOption('expert');
    await page.locator('[data-studio-state="ready"]').waitFor();
    assert.equal(await page.locator('[data-input-id="projection"]').count(), 1);
    await page.locator('[data-input-id="controls"]').selectOption('guided');
    await page.locator('[data-studio-state="ready"]').waitFor();
    assert.equal(await page.locator('[data-input-id="projection"]').count(), 0);
    const after = await page
      .locator('[data-lolly-studio]')
      .evaluate((el) => JSON.parse((el as HTMLElement).dataset.lollyStudio!).values);
    assert.deepEqual(after.camera, values.camera);

    const cameraState = () =>
      page
        .locator('[data-lolly-studio]')
        .evaluate((el) => JSON.parse((el as HTMLElement).dataset.lollyStudio!).values.camera);
    const waitCamera = async (expected: Record<string, unknown>) => {
      await page.waitForFunction((expected) => {
        const marker = document.querySelector<HTMLElement>('[data-lolly-studio]');
        const camera = marker && JSON.parse(marker.dataset.lollyStudio!).values.camera;
        return (
          marker?.dataset.studioState === 'ready' &&
          camera &&
          Object.entries(expected).every(([key, value]) => camera[key] === value)
        );
      }, expected);
    };
    const waitValue = async (key: string, value: unknown) =>
      page.waitForFunction(
        ({ key, value }) => {
          const marker = document.querySelector<HTMLElement>('[data-lolly-studio]');
          return (
            marker?.dataset.studioState === 'ready' &&
            JSON.parse(marker.dataset.lollyStudio!).values[key] === value
          );
        },
        { key, value }
      );
    await page.getByRole('button', { name: 'Fit object', exact: true }).click();
    await page.waitForFunction((camera) => {
      const marker = document.querySelector<HTMLElement>('[data-lolly-studio]');
      return (
        marker?.dataset.studioState === 'ready' &&
        JSON.stringify(JSON.parse(marker.dataset.lollyStudio!).values.camera) !==
          JSON.stringify(camera)
      );
    }, values.camera);
    const fitted = await cameraState();
    assert.notDeepEqual(fitted, values.camera);
    await page.keyboard.press('ControlOrMeta+z');
    await waitCamera(values.camera);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await waitCamera(fitted);
    await page.getByRole('button', { name: 'Reset camera', exact: true }).click();
    await waitCamera({ azimuth: 25 });
    await page.keyboard.press('ControlOrMeta+z');
    await waitCamera(fitted);
    await page.keyboard.press('ControlOrMeta+z');
    await waitCamera(values.camera);
    const preview = page.locator('.lolly-studio-canvas');
    await preview.focus();
    await preview.press('ArrowRight');
    await waitCamera({ azimuth: Number(values.camera.azimuth) + 2 });
    assert.equal(await preview.evaluate(el => document.activeElement === el), true);
    await preview.press('ArrowRight');
    await waitCamera({ azimuth: Number(values.camera.azimuth) + 4 });
    await page.keyboard.press('ControlOrMeta+z');
    await waitCamera({ azimuth: Number(values.camera.azimuth) + 2 });
    await page.keyboard.press('ControlOrMeta+z');
    await waitCamera(values.camera);
    await page.evaluate(() =>
      (document.querySelector('[data-lolly-canvas]') as any).__lollyCommit('depthOfField', true)
    );
    await waitValue('depthOfField', true);
    await page.getByRole('button', { name: 'Pick focus', exact: true }).click();
    await preview.click({
      position: {
        x: (await preview.boundingBox())!.width / 2,
        y: (await preview.boundingBox())!.height / 2,
      },
    });
    await page.waitForFunction(() => {
      const marker = document.querySelector<HTMLElement>('[data-lolly-studio]');
      return (
        marker?.dataset.studioState === 'ready' &&
        JSON.parse(marker.dataset.lollyStudio!).values.focusDistance > 0
      );
    });
    await page.keyboard.press('ControlOrMeta+z');
    await waitValue('focusDistance', 0);
    await page.evaluate(() =>
      (document.querySelector('[data-lolly-canvas]') as any).__lollyCommit('depthOfField', false)
    );
    await waitValue('depthOfField', false);
    step('studio: fit, reset, separate keyboard undo, redo and focus picking passed');

    await page.getByRole('button', { name: 'Export options', exact: true }).click();
    step('studio: export opened');
    const downloading = page.waitForEvent('download');
    await page.locator('[data-action="download"]').click();
    const downloaded = await downloading;
    const bytes = await readFile((await downloaded.path())!);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.ok(bytes.length > 10_000);
    const alpha = await page.evaluate(async (bytes) => {
      const image = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/png' })
      );
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      image.close();
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let clear = 0,
        solid = 0,
        partial = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] === 0) clear++;
        else if (pixels[i] === 255) solid++;
        else partial++;
      }
      return { clear, solid, partial };
    }, Array.from(bytes));
    assert.ok(alpha.clear > 100 && alpha.solid > 100 && alpha.partial > 100, JSON.stringify(alpha));

    step('studio: downloaded');
    const packed = await page.evaluate(async () => {
      const bridgePath = '/src/bridge/index.ts',
        packPath = '/src/lib/lolly-pack.ts',
        rowPath = '/src/pro/render-export.ts';
      const [{ createBridge }, { buildLollyFile }, { renderRowToBlob }] = await Promise.all([
        import(bridgePath),
        import(packPath),
        import(rowPath),
      ]);
      const host = await createBridge();
      const canvas = document.querySelector('[data-lolly-canvas]') as Element & {
        __lollyModel?: () => { id: string; value: unknown }[];
      };
      if (!canvas?.__lollyModel) throw new Error('The editor did not publish its input model.');
      const values = Object.fromEntries(
        canvas.__lollyModel().map((input) => [input.id, input.value])
      );
      await host.state.save('studio-test', { ...values, __toolId: '3d-studio' });
      const session = await host.state.load('studio-test');
      const file = await buildLollyFile({
        session,
        toolId: '3d-studio',
        userAssets: await host.assets._exportUserAssets(),
      });
      const result = await renderRowToBlob({ toolId: '3d-studio', values }, host, {
        format: 'png',
        width: 360,
        height: 360,
        watermark: false,
        embedMeta: false,
        c2pa: false,
      });
      return {
        file: Array.from(new Uint8Array(await file.blob.arrayBuffer())),
        image: Array.from(new Uint8Array(await result.blob.arrayBuffer())),
      };
    });
    assert.ok(packed.image.length > 10_000);
    step('studio: packed and batch rendered');
    const reader = await browser.newPage({
      viewport: { width: 900, height: 700 },
      serviceWorkers: 'block',
    });
    reader.setDefaultTimeout(90000);
    await reader.routeWebSocket(/127\.0\.0\.1/, (socket) => socket.close());
    reader.on('pageerror', (e) => errors.push(e.message));
    await reader.goto(`${origin}/`);
    await reader
      .getByRole('button', { name: 'Open a file - import a .lolly, design or image', exact: true })
      .waitFor({ state: 'attached' });
    const reopened = await reader.evaluate(async (bytes) => {
      const bridgePath = '/src/bridge/index.ts',
        packPath = '/src/lib/lolly-pack.ts',
        rowPath = '/src/pro/render-export.ts';
      const [{ createBridge }, { ingestLollyFile }, { renderRowToBlob }] = await Promise.all([
        import(bridgePath),
        import(packPath),
        import(rowPath),
      ]);
      const host = await createBridge();
      const imported = await ingestLollyFile(new Uint8Array(bytes), host);
      const result = await renderRowToBlob(
        { toolId: '3d-studio', values: imported.session },
        host,
        { format: 'png', width: 360, height: 360, watermark: false, embedMeta: false, c2pa: false }
      );
      return {
        imported: imported.imported,
        image: Array.from(new Uint8Array(await result.blob.arrayBuffer())),
      };
    }, packed.file);
    assert.equal(reopened.imported, 1);
    assert.deepEqual(reopened.image, packed.image);
    step('studio: portable file reopened');
    await page.evaluate(async () => {
      const bridgePath = '/src/bridge/index.ts';
      const { createBridge } = await import(bridgePath);
      const host = await createBridge();
      const values = await host.state.load('studio-test');
      await host.state.save('studio-test-two', { ...values, __label: 'Second view' });
    });
    await page.goto(`${origin}/multi?s=studio-test,studio-test-two`);
    await page.locator('[data-me-cell="0"]').press('Enter');
    await page.locator('#me-c0 [data-studio-state="ready"]').waitFor();
    const firstCanvas = page.locator('#me-c0 canvas');
    const box = (await firstCanvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 10);
    await page.mouse.up();
    await page.waitForFunction((azimuth) => {
      const marker = document.querySelector<HTMLElement>('#me-c0 [data-lolly-studio]');
      return marker && JSON.parse(marker.dataset.lollyStudio!).values.camera.azimuth !== azimuth;
    }, values.camera.azimuth);
    await page.locator('#me-c0 [data-studio-state="ready"]').waitFor();
    const changedCamera = await page
      .locator('#me-c0 [data-lolly-studio]')
      .evaluate((el) => JSON.parse((el as HTMLElement).dataset.lollyStudio!).values.camera);
    assert.notEqual(changedCamera.azimuth, values.camera.azimuth);
    await page.locator('[data-me-cell="1"]').press('Enter');
    await page.locator('#me-c1 [data-studio-state="ready"]').waitFor();
    assert.equal(await firstCanvas.count(), 0);
    assert.equal(await page.locator('#me-c0 img.me-preview').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#me-c1 canvas').count(), 0);
    step('studio: live multi-edit cells and freeze passed');
    await page.goto(
      `${origin}/t/3d-studio?source=collection&samples=8&collectionSize.width=180&collectionSize.height=180&c2pa=0`
    );
    await page.locator('[data-studio-state="ready"]').waitFor();
    await page.evaluate(async () => {
      const path = '/src/bridge/index.ts';
      const { createBridge } = await import(path);
      const host = await createBridge();
      const saved = await host.state.load('studio-test');
      const el = document.querySelector('[data-lolly-canvas]') as any;
      el.__lollyCommit('subjects', [
        { name: 'Uploaded duck', kind: 'model', asset: saved.modelAsset.id },
        { name: 'Badge', kind: 'primitive', primitive: 'badge' },
        {
          name: 'Box',
          kind: 'primitive',
          primitive: 'box',
          ownFraming: true,
          azimuth: 45,
          elevation: 20,
          fov: 29,
          zoom: 1,
        },
      ]);
    });
    await page.waitForFunction(() =>
      document.querySelector('[data-studio-item-label]')?.textContent?.includes('Uploaded duck')
    );
    await page.locator('[data-studio-state="ready"]').waitFor();
    await page.getByRole('button', { name: 'Review collection', exact: true }).click();
    step('studio: collection review opened');
    const review = page.getByRole('dialog', { name: 'Review studio collection', exact: true });
    await review
      .locator('[data-studio-collection-status]')
      .filter({ hasText: '3 previews ready' })
      .waitFor();
    step('studio: collection preview ready');
    const firstShot = await review
      .locator('img')
      .first()
      .evaluate(async (img) =>
        Array.from(new Uint8Array(await (await fetch((img as HTMLImageElement).src)).arrayBuffer()))
      );
    await review.locator('[data-input-id="studio"]').selectOption('warm');
    step('studio: shared lighting changed');
    await review
      .locator('[data-studio-collection-status]')
      .filter({ hasText: '3 previews ready' })
      .waitFor();
    const changedShot = await review
      .locator('img')
      .first()
      .evaluate(async (img) =>
        Array.from(new Uint8Array(await (await fetch((img as HTMLImageElement).src)).arrayBuffer()))
      );
    assert.notDeepEqual(changedShot, firstShot);
    const collectionState = await page
      .locator('[data-lolly-canvas]')
      .evaluate((el: any) =>
        Object.fromEntries(el.__lollyModel().map((item: any) => [item.id, item.value]))
      );
    assert.equal(collectionState.studio, 'warm');
    assert.equal(collectionState.subjects[2].azimuth, 45);
    assert.equal(collectionState.subjects[2].ownFraming, true);
    const setDownload = page.waitForEvent('download');
    await review.getByRole('button', { name: 'Export PNG set', exact: true }).click();
    step('studio: collection export started');
    const set = await setDownload;
    const archive = unzipSync(await readFile((await set.path())!));
    const images = Object.keys(archive).filter((name) => name.endsWith('.png'));
    assert.equal(images.length, 3, images.join('\n'));
    for (const name of ['01-uploaded-duck.png', '02-badge.png', '03-box.png'])
      assert.ok(
        images.some((path) => path.endsWith(name)),
        images.join('\n')
      );
    await review.getByRole('button', { name: 'Edit Box', exact: true }).click();
    await page.locator('[data-studio-state="ready"]').waitFor();
    await page.getByRole('button', { name: 'Use shared framing', exact: true }).click();
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-studio-item-label]')?.textContent?.includes('own framing')
    );
    step('studio: collection shared edits, named PNG set and framing reset passed');
    await page.waitForFunction(async () => {
      const path = '/src/lib/batch-job.ts';
      return !(await import(path)).isBatchRunActive();
    });
    const collectionPack = await page.evaluate(
      async ({ values, collectionPath }) => {
        const bridgePath = '/src/bridge/index.ts',
          packPath = '/src/lib/lolly-pack.ts',
          renderPath = '/src/pro/render-export.ts';
        const [
          { createBridge },
          { buildLollyFile },
          { renderRowToBlob },
          { studioCollectionRows },
        ] = await Promise.all([
          import(bridgePath),
          import(packPath),
          import(renderPath),
          import(collectionPath),
        ]);
        const host = await createBridge();
        const file = await buildLollyFile({
          session: { ...values, __toolId: '3d-studio' },
          toolId: '3d-studio',
          userAssets: await host.assets._exportUserAssets(),
        });
        const rows = studioCollectionRows(values);
        const rendered = await renderRowToBlob(
          { toolId: '3d-studio', values: rows[0].values },
          host,
          {
            format: 'png',
            width: 180,
            height: 180,
            watermark: false,
            embedMeta: false,
            c2pa: false,
          }
        );
        return {
          file: Array.from(new Uint8Array(await file.blob.arrayBuffer())),
          image: Array.from(new Uint8Array(await rendered.blob.arrayBuffer())),
        };
      },
      { values: collectionState, collectionPath }
    );
    const collectionReader = await browser.newPage({ serviceWorkers: 'block' });
    await collectionReader.routeWebSocket(/127\.0\.0\.1/, (socket) => socket.close());
    collectionReader.on('pageerror', (e) => errors.push(e.message));
    await collectionReader.goto(`${origin}/`);
    await collectionReader
      .getByRole('button', { name: 'Open a file - import a .lolly, design or image', exact: true })
      .waitFor({ state: 'attached' });
    const restored = await collectionReader.evaluate(
      async ({ bytes, collectionPath }) => {
        const bridgePath = '/src/bridge/index.ts',
          packPath = '/src/lib/lolly-pack.ts',
          renderPath = '/src/pro/render-export.ts';
        const [
          { createBridge },
          { ingestLollyFile },
          { renderRowToBlob },
          { studioCollectionRows },
        ] = await Promise.all([
          import(bridgePath),
          import(packPath),
          import(renderPath),
          import(collectionPath),
        ]);
        const host = await createBridge();
        const restored = await ingestLollyFile(new Uint8Array(bytes), host);
        const rows = studioCollectionRows(restored.session);
        const image = await renderRowToBlob({ toolId: '3d-studio', values: rows[0].values }, host, {
          format: 'png',
          width: 180,
          height: 180,
          watermark: false,
          embedMeta: false,
          c2pa: false,
        });
        return {
          imported: restored.imported,
          count: rows.length,
          angle: rows[2].values.camera.azimuth,
          studio: rows[2].values.studio,
          image: Array.from(new Uint8Array(await image.blob.arrayBuffer())),
        };
      },
      { bytes: collectionPack.file, collectionPath }
    );
    assert.equal(restored.imported, 1);
    assert.equal(restored.count, 3);
    assert.equal(restored.angle, 45);
    assert.equal(restored.studio, 'warm');
    assert.deepEqual(restored.image, collectionPack.image);
    await collectionReader.close();
    step('studio: portable collection reopened with framing and a byte-identical model image');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
