# Build the CLI and TUI

Run the terminal shells from source or package the CLI binary.

Part of [Build Guide](/info/build-guide.html).

## CLI

### Development use (no build needed)

The CLI shell runs directly from the repo with Node.js:

```bash
# List available tools
pnpm run cli

# Show inputs for a tool
pnpm run cli qr-code

# Run a tool and write output
pnpm run cli qr-code --url=https://suse.com --color=#0c322c --output=./qr.svg

# Explicit format
pnpm run cli quotes --quote="Open source wins." --name="Andy" --export=png --output=./quote.png
```

The CLI supports **SVG, EMF, EPS, HTML and the text/data formats** (JSON, CSV, ICS, VCF, MD, TXT) natively - hydrated by the engine with no browser engine needed (SVG/EMF only for tools with an `<svg>`-based template, since the lean CLI has no layout engine). **PNG** from an `<svg>`-based tool is also browser-free: resvg rasterises the engine's own SVG (Tier A). The remaining raster formats - **JPG, WebP, PDF and video (GIF, WebM, MP4)**, plus HTML-layout PNG - render through the CLI's own scoped headless Chromium (Tier B): install it once with `lolly install-browser`, then they export straight from the CLI. (ZIP is the one format the lean CLI leaves out - no zip dependency - so its batch writes a folder instead.)

### Standalone binary

To distribute the CLI without requiring Node.js installed:

**1. Bundle to a single CJS file:**

```bash
cd shells/cli
pnpm exec esbuild bin/lolly.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=cjs \
  --outfile=dist/lolly.cjs
```

**2. Package with `@yao-pkg/pkg` (includes a Node runtime):**

```bash
npx @yao-pkg/pkg dist/lolly.cjs \
  --targets node20-macos-arm64,node20-macos-x64,node20-linux-x64,node20-win-x64 \
  --output dist/lolly
```

Output binaries land in `shells/cli/dist/` - one per platform target.

> The `tools/` and `catalog/` directories must ship alongside the binary. The CLI resolves them relative to the binary location, so the expected layout is:
> ```
> lolly          ← binary
> tools/              ← tool definitions
> catalog/            ← asset + tool catalogs
> ```

---

## TUI

### Development use (no build needed)

The interactive terminal shell runs straight from the repo - it needs a real TTY, so run it in your terminal rather than a captured pipe:

```bash
pnpm run tui
```

It's the CLI's engine and render path under an interactive, keyboard-first UI (built on Ink, run through `tsx`). The DOM-free formats - **SVG, EMF, EPS, HTML and the text/data formats** - render with nothing extra. State (saved sessions, project folders, profile) persists on disk in the directory all three local shells share - `$LOLLY_STATE_DIR`, else the desktop app's data directory when the app is installed here, else `~/.lolly`; exports default to `~/Desktop`. See the [TUI guide](/info/tui.html) for the full key map and views.

### Browser render tier (raster / PDF / video / URL capture)

Unlike the bare CLI, the TUI can produce browser-bound formats via a scoped headless Chromium - the same one the MCP server uses. Set it up once:

```bash
pnpm run install:browser   # Chromium → services/mcp/.browsers (shared with services/mcp)
pnpm run build:web         # a built web shell the TUI drives for pixel-identical raster/pdf/video
```

With those present, raster (PNG/JPG), PDF, video and the `url-shot` live-URL capture all export from the terminal; without them, those formats fail with a clear setup message and the TUI writes HTML instead. The browser is lazy - it launches only on the first such export, never at startup. Override the browser with `LOLLY_BROWSER_CHANNEL` / `LOLLY_BROWSER_PATH`, or point at a running/prebuilt web shell with `LOLLY_WEB_BASE` / `LOLLY_WEB_DIST`.

> No standalone-binary recipe yet - the TUI ships as a repo/dev surface today. Package it like the CLI (esbuild + `@yao-pkg/pkg`) once a target calls for it.

---

[Back to Build Guide](/info/build-guide.html).
