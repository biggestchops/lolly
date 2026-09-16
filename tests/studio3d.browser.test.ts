// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { build } from 'esbuild';
import { type Browser, chromium, type Page } from 'playwright';
import { loadTool } from '../engine/src/loader.ts';
import { createRuntime } from '../engine/src/runtime.ts';
import { baseHost } from './helpers/host.ts';

const root = resolve(import.meta.dirname, '..');
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path fill="#30ba78" d="M20 1a19 19 0 1 1 0 38a19 19 0 1 1 0-38M20 6a14 14 0 1 0 0 28a14 14 0 1 0 0-28"/><path fill="#0c322c" d="M21 8L11 24h7v9l12-17h-9z"/></svg>';
const skip =
  !existsSync(chromium.executablePath()) && 'Install Playwright Chromium for 3D Studio coverage';
let browser: Browser, server: Server, origin: string, bundle: string, template: string;
const errors: string[] = [];
const facets = [
  [
    [0, 0, 0],
    [0, 1, 0],
    [1, 0, 0],
  ],
  [
    [0, 0, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
  [
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 0],
  ],
  [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
];
const stl =
  'solid tetra\n' +
  facets
    .map(
      (f) =>
        'facet normal 0 0 0\nouter loop\n' +
        f.map((v) => 'vertex ' + v.join(' ')).join('\n') +
        '\nendloop\nendfacet'
    )
    .join('\n') +
  '\nendsolid tetra';
const binaryStl = new Uint8Array(84 + facets.length * 50);
const stlView = new DataView(binaryStl.buffer);
stlView.setUint32(80, facets.length, true);
for (const [i, f] of facets.entries())
  for (const [j, n] of f.flat().entries()) stlView.setFloat32(84 + i * 50 + 12 + j * 4, n, true);

async function open(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 360, height: 360 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(origin + '/');
  await page.waitForFunction(() => Boolean((window as any).studioTest));
  return page;
}

async function render(
  page: Page,
  values: Record<string, unknown>
): Promise<{
  png: string;
  pixels: number[];
  width: number;
  height: number;
  info: string;
  state: string;
  reads: number;
  reused: boolean;
}> {
  return page.evaluate(async (values) => (window as any).studioTest.render(values), values);
}

describe('3D Studio actual renderer', { skip }, () => {
  before(async () => {
    const result = await build({
      stdin: {
        resolveDir: root,
        loader: 'ts',
        contents: `
      import {mountToolStudio,prepareToolStudio,destroyToolStudio} from './shells/web/src/lib/studio3d/mount.ts';
      const container=document.querySelector('#content');let reads=0;
      const read=async(url,signal)=>{reads++;const res=await fetch(url,{signal});if(!res.ok)throw new Error('Fixture missing');return new Uint8Array(await res.arrayBuffer())};
      window.studioTest={
        async render(values){
          const previous=container.querySelector('canvas');if(previous)previous.__lollyFrameDriven=true;
          container.innerHTML=window.fixtureTemplate;
          const marker=container.querySelector('[data-lolly-studio]');
          marker.dataset.lollyStudio=JSON.stringify({version:1,values:{colorA:'#30ba78',colorB:'#0c322c',background:'#0c322c',background2:'#30ba78',samples:8,...values}});
          await mountToolStudio(container,{read});prepareToolStudio(container);
          const canvas=container.querySelector('canvas');const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;const ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0);
          return {png:canvas.toDataURL(),pixels:Array.from(ctx.getImageData(0,0,copy.width,copy.height).data),width:canvas.width,height:canvas.height,info:marker.querySelector('[data-studio-info]')?.textContent||'',state:marker.dataset.studioState,reads,reused:!previous||previous===canvas};
        },
        prepare(){prepareToolStudio(container)},destroy(){destroyToolStudio(container)},
        sample(time){const canvas=container.querySelector('canvas');canvas.__lollyFrameDriven=true;canvas.__lollyFrameRender(time,5);return canvas.toDataURL()},
        async race(){
          container.innerHTML=window.fixtureTemplate;const marker=container.querySelector('[data-lolly-studio]');
          marker.dataset.lollyStudio=JSON.stringify({version:1,values:{source:'artwork',artwork:{url:'/slow.svg'},samples:8}});
          let release;const delayed=new Promise(resolve=>release=resolve);const slow=mountToolStudio(container,{read:async(url,signal)=>{await delayed;signal.throwIfAborted();return read('/fixture.svg',signal)}});
          marker.dataset.lollyStudio=JSON.stringify({version:1,values:{source:'primitive',primitive:'sphere',samples:8}});
          await mountToolStudio(container,{read});release();await slow;prepareToolStudio(container);return marker.dataset.studioState;
        }
      };`,
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      logLevel: 'silent',
    });
    bundle = result.outputFiles[0]!.text;
    const tool = await loadTool('3d-studio', (p) => readFile(join(root, 'community', p), 'utf8'));
    const runtime = await createRuntime(tool, baseHost(), { controls: 'expert' });
    template = runtime.getHydrated();
    runtime.destroy();
    server = createServer(async (req, res) => {
      try {
        if (req.url === '/bundle.js') {
          res.setHeader('Content-Type', 'text/javascript');
          res.end(bundle);
        } else if (req.url === '/fixture.svg') {
          res.setHeader('Content-Type', 'image/svg+xml');
          res.end(svg);
        } else if (req.url === '/duck.glb')
          res.end(await readFile(join(root, 'community/3d/assets/duck.glb')));
        else if (req.url === '/bad.glb') res.end('not a model');
        else if (req.url === '/tetra.stl') res.end(stl);
        else if (req.url === '/binary.stl') res.end(binaryStl);
        else if (req.url === '/favicon.ico') res.writeHead(204).end();
        else if (req.url?.startsWith('/geeko/') && process.env.STUDIO_SUSE)
          res.end(
            await readFile(
              join(root, 'brands/suse/catalog/assets/suse/models', req.url.slice(7) + '.glb')
            )
          );
        else if (req.url?.startsWith('/suse/') && process.env.STUDIO_SUSE)
          res.end(
            await readFile(
              join(
                root,
                'brands/suse/catalog/assets/suse/icons',
                'icon-' + req.url.slice(6) + '.svg'
              )
            )
          );
        else
          res.end(
            `<html><style>html,body{margin:0}#content{width:360px;height:360px}${tool.styles}</style><div id="content"></div><script>window.fixtureTemplate=${JSON.stringify(template).replace(/</g, '\\u003c')}</script><script src="/bundle.js"></script></html>`
          );
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await chromium.launch({
      headless: true,
      ...(process.env.STUDIO_NATIVE
        ? { executablePath: chromium.executablePath(), args: ['--use-angle=metal'] }
        : {}),
    });
  });
  after(async () => {
    await browser?.close();
    if (server) await new Promise<void>((done) => server.close(() => done()));
  });

  it('renders real geometry, reuses its canvas and source, and keeps alpha shadows bounded', async () => {
    const page = await open();
    try {
      const source = { source: 'artwork', artwork: { url: '/fixture.svg' }, shadowOpacity: 0.4 };
      const object = await render(page, { ...source, outputMode: 'object' });
      const shadow = await render(page, { ...source, outputMode: 'object-shadow' });
      assert.equal(object.width, 360);
      assert.equal(shadow.state, 'ready');
      assert.equal(shadow.reads, 1);
      assert.equal(shadow.reused, true);
      let solid = 0,
        clear = 0,
        shadowPixels = 0,
        maxShadow = 0;
      for (let i = 0; i < shadow.pixels.length; i += 4) {
        if (object.pixels[i + 3] === 255) solid++;
        if (shadow.pixels[i + 3] === 0) clear++;
        if (object.pixels[i + 3] === 0 && shadow.pixels[i + 3]! > 2) {
          shadowPixels++;
          maxShadow = Math.max(maxShadow, shadow.pixels[i + 3]!);
        }
      }
      assert.ok(
        solid > 1000 && clear > 1000 && shadowPixels > 100,
        JSON.stringify({ solid, clear, shadowPixels })
      );
      assert.ok(maxShadow <= 104, `Shadow alpha ${maxShadow} exceeds its 40% opacity`);
      const surfaced = await render(page, {
        ...source,
        outputMode: 'object-shadow',
        surfaceFinishes: true,
        faceFinishA: 'matte',
        bevelFinishA: 'metal',
        sideFinishA: 'metal',
        faceFinishB: 'enamel',
      });
      assert.notEqual(surfaced.png, shadow.png);
      assert.equal(surfaced.reads, 1);
      const again = await render(page, { ...source, outputMode: 'object-shadow' });
      assert.equal(again.png, shadow.png);
      const different = await render(page, {
        ...source,
        outputMode: 'object-shadow',
        studio: 'warm',
      });
      assert.notEqual(different.png, shadow.png);
      assert.equal(different.reads, 1);
      if (process.env.STUDIO_SHOTS) {
        await mkdir(process.env.STUDIO_SHOTS, { recursive: true });
        await writeFile(
          join(process.env.STUDIO_SHOTS, 'alpha.png'),
          Buffer.from(shadow.png.split(',')[1]!, 'base64')
        );
      }
    } finally {
      await page.close();
    }
  });

  it('renders a textured GLB and changes actual depth of field and material pixels', async () => {
    const page = await open();
    try {
      const model = await render(page, {
        source: 'model',
        upload: { url: '/duck.glb', name: 'duck.glb' },
      });
      assert.equal(model.state, 'ready');
      const sharp = await render(page, {
        source: 'primitive',
        atmosphere: true,
        materialMode: 'pair',
        colorB: '#90ebcd',
      });
      const depth = await render(page, {
        source: 'primitive',
        atmosphere: true,
        depthOfField: true,
        aperture: 0.18,
        materialMode: 'pair',
        colorB: '#90ebcd',
      });
      assert.notEqual(sharp.png, depth.png);
      assert.notEqual(depth.png, model.png);
      const plain = await render(page, { source: 'primitive', floor: 'cove' });
      assert.equal(plain.state, 'ready');
      if (process.env.STUDIO_SHOTS) {
        await mkdir(process.env.STUDIO_SHOTS, { recursive: true });
        for (const [name, frame] of [
          ['model', model],
          ['depth', depth],
          ['cove', plain],
        ] as const)
          await writeFile(
            join(process.env.STUDIO_SHOTS, name + '.png'),
            Buffer.from(frame.png.split(',')[1]!, 'base64')
          );
      }
    } finally {
      await page.close();
    }
  });

  it('rejects broken sources and stale loads without exporting a placeholder', async () => {
    const page = await open();
    try {
      await assert.rejects(
        render(page, { source: 'model', upload: { url: '/bad.glb', name: 'bad.glb' } }),
        /incomplete|self-contained/
      );
      await assert.rejects(
        page.evaluate(() => (window as any).studioTest.prepare()),
        /incomplete|self-contained/
      );
      assert.equal(await page.evaluate(() => (window as any).studioTest.race()), 'ready');
      await page.evaluate(() => (window as any).studioTest.destroy());
      assert.equal(await page.locator('canvas').count(), 0);
    } finally {
      await page.close();
    }
  });

  it('renders ASCII and binary STL consistently and samples turntable frames reproducibly', async () => {
    const page = await open();
    try {
      const ascii = await render(page, {
        source: 'model',
        modelAsset: { url: '/tetra.stl', name: 'tetra.stl' },
      });
      const binary = await render(page, {
        source: 'model',
        modelAsset: { url: '/binary.stl', name: 'binary.stl' },
      });
      assert.equal(ascii.png, binary.png);
      assert.match(binary.info, /print dimensions are not inferred/);
      await render(page, { source: 'primitive', motion: 'turntable', duration: 5 });
      const at = (t: number) => page.evaluate((t) => (window as any).studioTest.sample(t), t);
      const first = await at(0.25),
        next = await at(0.5),
        repeated = await at(0.25);
      assert.notEqual(first, next);
      assert.equal(first, repeated);
      for (const lightMotion of ['orbit', 'breathe']) {
        await render(page, {
          source: 'primitive',
          motion: 'still',
          lightMotion,
          lightMotionAmount: 0.6,
          duration: 5,
        });
        const start = await at(0),
          moving = await at(0.25),
          again = await at(0.25),
          end = await at(1);
        assert.notEqual(moving, start, `${lightMotion} must change the actual lighting`);
        assert.equal(moving, again, `${lightMotion} must reproduce the same frame`);
        assert.equal(start, end, `${lightMotion} must close the loop`);
      }
    } finally {
      await page.close();
    }
  });

  it('renders the private SUSE fixtures when explicitly requested', {
    skip: !process.env.STUDIO_SUSE && 'STUDIO_SUSE is not set; private SUSE fixtures are opt-in.',
  }, async () => {
    const page = await open();
    try {
      for (const id of ['geeko', 'geeko-branch', 'geeko-sitting']) {
        const frame = await render(page, {
          source: 'model',
          modelAsset: { url: '/geeko/' + id },
          materialMode: 'source',
          outputMode: 'object-shadow',
        });
        assert.equal(frame.state, 'ready');
        assert.ok(frame.pixels.filter((v, i) => i % 4 === 3 && v === 255).length > 500);
        if (process.env.STUDIO_SHOTS)
          await writeFile(
            join(process.env.STUDIO_SHOTS, id + '.png'),
            Buffer.from(frame.png.split(',')[1]!, 'base64')
          );
      }
      for (const id of ['security', 'database', 'linux', 'brain', 'lightbulb', 'network']) {
        const frame = await render(page, {
          source: 'artwork',
          artwork: { url: '/suse/' + id },
          controls: 'expert',
          surfaceFinishes: true,
          faceFinishA: 'matte',
          bevelFinishA: 'enamel',
          sideFinishA: 'metal',
          faceFinishB: 'enamel',
          outputMode: 'object-shadow',
        });
        assert.equal(frame.state, 'ready');
        assert.match(frame.info, /paint:#30ba78/);
        assert.match(frame.info, /paint:#0c322c/);
        if (process.env.STUDIO_SHOTS)
          await writeFile(
            join(process.env.STUDIO_SHOTS, id + '.png'),
            Buffer.from(frame.png.split(',')[1]!, 'base64')
          );
      }
    } finally {
      await page.close();
    }
  });

  it('has no browser or shader errors', () => assert.deepEqual(errors, []));
});
