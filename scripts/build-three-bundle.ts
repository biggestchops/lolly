// SPDX-License-Identifier: MPL-2.0
/**
 * Build the vendored three.js bundles the two legacy 3D tools carry -
 * `tools/3d/lib/three.min.js` and `tools/flythrough/lib/three.min.js`.
 *
 * Two bundles, because the tools need different renderers:
 *
 *  - `3d` gets three's WebGPU build plus the addons it uses (GLTFLoader,
 *    RoomEnvironment, OrbitControls). That build is also its WebGL 2 fallback:
 *    `new WebGPURenderer({ forceWebGL: true })` paints through WebGL 2 with the same
 *    API, so the tool needs no second renderer and the bundle carries no
 *    `WebGLRenderer` at all. The addons import the bare `three` specifier, which
 *    normally resolves to the WebGL build; the resolve plugin below points it at the
 *    WebGPU build so the bundle holds exactly one copy of the library.
 *  - `flythrough` gets the ordinary WebGL build. It names core classes only (Scene,
 *    PerspectiveCamera, ExtrudeGeometry, ShapePath and the rest), but the bundle also
 *    carries the same three addons, because `booth-studio` borrows this very file and
 *    lights its stand with RoomEnvironment.
 *
 * Each publishes itself under its OWN global - `LollyThreeGpu` and `LollyThreeGl` -
 * because they used to share `LollyThree`, and the second 3D tool opened in one page
 * session then took the first one's library and reported "3D library failed to load."
 * (plan 265 milestone 2, E3). `LollyThree` is still assigned, first writer winning, for
 * `booth-studio`, which borrows the flythrough bundle and reads that name.
 *
 * Written to community/<tool>/lib/ and, when the private pack is mounted, to
 * brands/suse/tools/3d/lib/ - the SUSE override ships its own copy of the `3d` tool
 * directory, so both must carry the same bytes.
 *
 *   pnpm run build:three          (node scripts/build-three-bundle.ts)
 *
 * `three` is a root devDependency pinned to an exact version; bump it there and
 * re-run. Each template checks for the class it needs on load, so a bundle built from
 * the wrong three build is refused, not silently used.
 */
import { build } from 'esbuild';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const threeVersion = (JSON.parse(readFileSync(resolve(repoRoot, 'node_modules/three/package.json'), 'utf8')) as { version: string }).version;
const threeWebgpu = fileURLToPath(import.meta.resolve('three/webgpu'));

interface Bundle {
  /** The global this bundle publishes itself under, and that its template looks for. */
  globalName: string;
  /** The module it is built from. */
  entry: string;
  /** Resolve the bare `three` specifier to this build, so one copy is bundled. */
  threeBuild: string;
  /** What the banner calls this build. */
  label: string;
  /** Names that must appear in the output. */
  needs: string[];
  /** A shape that must NOT appear. */
  refuses?: RegExp;
  /** Where the bytes go; a path whose directory is absent is skipped. */
  targets: string[];
}

const BUNDLES: Bundle[] = [
  {
    globalName: 'LollyThreeGpu',
    entry: `
export * from 'three/webgpu';
export { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
export { OrbitControls } from 'three/addons/controls/OrbitControls.js';
`,
    threeBuild: threeWebgpu,
    label: 'WebGPU build + GLTFLoader/RoomEnvironment/OrbitControls',
    needs: ['WebGPURenderer', 'GLTFLoader', 'RoomEnvironment', 'PMREMGenerator'],
    refuses: /class \w+ extends \w+\{[^}]*isWebGLRenderer/,
    targets: ['community/3d/lib/three.min.js', 'brands/suse/tools/3d/lib/three.min.js'],
  },
  {
    globalName: 'LollyThreeGl',
    entry: `
export * from 'three';
export { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
export { OrbitControls } from 'three/addons/controls/OrbitControls.js';
`,
    threeBuild: fileURLToPath(import.meta.resolve('three')),
    label: 'WebGL build + GLTFLoader/RoomEnvironment/OrbitControls',
    needs: ['WebGLRenderer', 'ExtrudeGeometry', 'ShapePath', 'OrthographicCamera', 'RoomEnvironment', 'PMREMGenerator'],
    targets: ['community/flythrough/lib/three.min.js'],
  },
];

const kb = (n: number): string => `${(n / 1024).toFixed(0)} KB`;

for (const bundle of BUNDLES) {
  const result = await build({
    stdin: { contents: bundle.entry, resolveDir: repoRoot, loader: 'js' },
    bundle: true,
    write: false,
    minify: true,
    format: 'iife',
    globalName: bundle.globalName,
    target: 'es2020',
    charset: 'utf8',
    legalComments: 'none',
    banner: { js: `/*! three.js r${threeVersion.split('.')[1]} (${threeVersion}) - MIT - https://threejs.org - ${bundle.label}, bundled by scripts/build-three-bundle.ts */` },
    // `booth-studio` borrows the flythrough bundle and still reads the old shared name,
    // so keep it pointing at whichever bundle loaded first, exactly as it always did.
    footer: { js: `window.LollyThree=window.LollyThree||${bundle.globalName};` },
    plugins: [{
      name: 'three-build',
      setup(b) {
        b.onResolve({ filter: /^three$/ }, () => ({ path: bundle.threeBuild }));
      },
    }],
  });

  const text = result.outputFiles[0]!.text;
  // The refusals each template relies on, checked at build time too.
  for (const needle of bundle.needs) {
    if (!text.includes(needle)) throw new Error(`the ${bundle.globalName} bundle is missing ${needle}`);
  }
  if (bundle.refuses?.test(text)) throw new Error(`the ${bundle.globalName} bundle carries the WebGL renderer - the resolve plugin did not take`);

  for (const target of bundle.targets.map((p) => resolve(repoRoot, p)).filter((p) => existsSync(dirname(p)))) {
    writeFileSync(target, text);
    console.log(`wrote ${target}`);
  }
  console.log(`three ${threeVersion} ${bundle.globalName}: ${kb(Buffer.byteLength(text))} min, ${kb(gzipSync(text).length)} gz`);
}
