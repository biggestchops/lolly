// SPDX-License-Identifier: MPL-2.0
/** Rebuild the pinned, browser-compatible Skera adapter; requires the Rust WASM target. */
import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../packages/node-shell/wasm/skera/', import.meta.url));
execFileSync('cargo', ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown'], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, RUSTFLAGS: '-C link-arg=--max-memory=134217728 -C link-arg=-zstack-size=1048576' },
});
copyFileSync(join(root, 'target/wasm32-unknown-unknown/release/lolly_font_subset.wasm'), join(root, 'skera.wasm'));
