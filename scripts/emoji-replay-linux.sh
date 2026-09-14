#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
# Replay the three pinned emoji line specimens on Linux and compare them with the
# goldens in tests/fixtures/emoji/line.golden.json. This is the second-OS gate for
# plan 252: the repository is mounted READ-ONLY into a Node 24 container, the
# masters are compiled from the pinned engine, font and HarfBuzz bytes, then
# rasterised with a Linux build of the pinned resvg version installed into the
# container's /tmp (never into the repository).
#
#   scripts/emoji-replay-linux.sh              # linux/arm64 (native on Apple silicon)
#   scripts/emoji-replay-linux.sh linux/amd64  # x86_64 under emulation, slower
#
# Needs podman or docker with a running Linux VM/daemon and network access for the
# image pull and the resvg install. Exit status is 0 only when every SVG checksum
# and every decoded RGBA digest equals the golden.
set -u
PLATFORM="${1:-linux/arm64}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/emoji-replay.XXXXXX")"
RUNTIME="$(command -v podman || command -v docker)" || { echo "podman or docker is required"; exit 2; }

cat > "$OUT/compile.ts" <<'EOF'
import { mkdir, writeFile } from 'node:fs/promises';
import { compileEmojiLine } from '/repo/engine/src/emoji-line.ts';
import { emojiLineFixture } from '/repo/tests/helpers/emoji-render.ts';
import { fixtureLocks } from '/repo/tests/helpers/emoji-fixtures.ts';
await mkdir('/out/masters', { recursive: true });
const specimens: Record<string, { svg: string }> = {};
for (const lock of fixtureLocks) {
  const input = await emojiLineFixture(lock.directory);
  const result = await compileEmojiLine(input.options, [input.pack], input.host);
  if (!result.ok) throw new Error(`${lock.directory}: ${result.code} ${result.message}`);
  await writeFile(`/out/masters/${lock.directory}.svg`, result.master.svg);
  specimens[lock.directory] = { svg: result.master.checksum };
}
await writeFile('/out/compile.json', JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, specimens }) + '\n');
EOF

cat > "$OUT/raster.mjs" <<'EOF'
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Resvg } from '/tmp/raster/node_modules/@resvg/resvg-js/index.js';
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const compile = JSON.parse(await readFile('/out/compile.json', 'utf8'));
const resvg = JSON.parse(await readFile('/tmp/raster/node_modules/@resvg/resvg-js/package.json', 'utf8')).version;
const specimens = {};
for (const name of Object.keys(compile.specimens)) {
  const rendered = new Resvg(await readFile(`/out/masters/${name}.svg`, 'utf8'), { font: { loadSystemFonts: false } }).render();
  specimens[name] = { svg: compile.specimens[name].svg, rgba: digest(rendered.pixels), width: rendered.width, height: rendered.height };
}
await writeFile('/out/replay.json', JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, resvg, specimens }, null, 2) + '\n');
EOF

RESVG_VERSION="$(node -e "console.log(require('$REPO/tests/fixtures/emoji/render.lock.json').referenceRaster.version)")"
"$RUNTIME" run --rm --platform "$PLATFORM" -v "$REPO":/repo:ro -v "$OUT":/out docker.io/library/node:24-bookworm-slim bash -lc "
set -e
node /out/compile.ts
mkdir -p /tmp/raster && cd /tmp/raster && npm init -y >/dev/null 2>&1 && npm install --no-audit --no-fund --loglevel=error @resvg/resvg-js@$RESVG_VERSION >/dev/null 2>&1
node /out/raster.mjs
" || { echo "replay failed inside the container"; exit 1; }

node - "$REPO" "$OUT" <<'EOF'
const [repo, out] = process.argv.slice(2);
const fs = require('node:fs');
const golden = JSON.parse(fs.readFileSync(`${repo}/tests/fixtures/emoji/line.golden.json`, 'utf8'));
const replay = JSON.parse(fs.readFileSync(`${out}/replay.json`, 'utf8'));
let failed = 0;
for (const [name, expected] of Object.entries(golden)) {
  const actual = replay.specimens[name];
  const same = actual && ['svg', 'rgba', 'width', 'height'].every((key) => actual[key] === expected[key]);
  console.log(`${same ? 'MATCH' : 'DIFF '} ${name} svg=${actual?.svg} rgba=${actual?.rgba}`);
  if (!same) failed++;
}
console.log(`${replay.platform}/${replay.arch} node ${replay.node} resvg ${replay.resvg}: ${failed ? `${failed} specimen(s) differ` : 'all specimens match the goldens'}`);
console.log(`report: ${out}/replay.json`);
process.exit(failed ? 1 : 0);
EOF
