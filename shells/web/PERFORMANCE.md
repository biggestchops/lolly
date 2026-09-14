# Performance UI checks

Performance UI (`perf-ui`) is opt-in. Its first CSS cascade layer contains only important policy declarations: important layer order is reversed, so later vendor/view styles cannot restore expensive chrome effects. Focus indicators (including pseudo-elements) and tool/export roots and descendants are excluded. Put the prefixed backdrop declaration before the standard one: the production minifier can otherwise retain only the prefix. The source and emitted stylesheets are exercised in Chromium by `tests/performance-ui.browser.test.ts`; source scans alone cannot prove the cascade or minifier output.

## Repeatable interaction measurements

Build the web shell, serve the production output, then run from the repository root:

```sh
pnpm --dir shells/web exec vite build
pnpm --dir shells/web exec vite preview --host 127.0.0.1 --port 5188 --strictPort
# In another terminal:
pnpm check:ui-performance http://127.0.0.1:5188 --runs=3 --cpu=4 --json=/tmp/lolly-ui-performance.json
```

This complements `check:bundle` and `check:first-load`; it does not replace the cold-load Lighthouse check. It rejects a Vite development build. Playwright's Chromium must be installed (`pnpm exec playwright install chromium`). A preview deployment can also be the target.

Each mode gets a fresh, disposable browser context. The app creates its own IndexedDB schema; setup saves the feature flags into that context's profile and reloads before measurement. Jelly and wobble preferences are enabled in both modes to exercise suppression. Welcome prompts are dismissed, locale is English, reduced motion is off, the viewport is 1200 × 800 at DPR 1, and service workers are blocked. Shared boot assets are warm; tool assets and background downloads are allowed to behave normally. Network speed is unthrottled. No existing browser profile or user work is changed.

The runner alternates OFF/ON order between repetitions and verifies each action completed:

- Scroll down and back through the real gallery.
- Type `qr`, wait for filtering, then clear and wait for restoration.
- Open the QR Code tool through “+ New”, choose blank, and wait for its SVG and editable field. This includes the chooser and opens the same document in both modes; clicking a card title instead would open its currently displayed example.
- Type into the URL field and wait for a changed SVG.
- Measure two-second gallery, tool and profile idle windows.
- Start the real Jelly switch's physics, click Performance UI, and verify the switch changes to a native control while the saved Jelly preference stays enabled.

JSON retains every sample, the environment, median summaries and target misses. A failed scenario exits nonzero and writes a screenshot beside the report. Measurements run sequentially; avoid builds, other browser tests and heavy applications while collecting a baseline.

## Reading the report

`interactionMs` is the worst observed Event Timing duration within a phase, grouped by interaction ID, then median across repetitions. It includes input delay, handling and the next paint. Chromium reports entries of at least 16 ms here; `null` means no qualifying entry, not zero latency. Scrolling is not an Event Timing interaction. This short lab sample is **not field INP**.

`readyMs` measures the scripted action through its readiness assertion and two animation frames, excluding a 200 ms observer-delivery allowance. It includes typing/scroll pacing and Playwright overhead, so compare identical scenarios. `longTaskMs` totals tasks of at least 50 ms; `longTaskBlockingMs` totals only their time beyond 50 ms within the phase, not page-load TBT. Raw tasks/events stay in the browser; the report retains their per-phase aggregates.

`mainThreadPercent` uses Chromium's `TaskDuration` delta divided by the same CDP snapshots' elapsed time. Idle windows include scheduled background work and rendering. This is main-thread occupancy under synthetic CPU slowdown, not whole-device CPU, GPU load, battery use or an emulation of a particular phone.

Performance UI ON has initial lab targets of 200 ms for the median worst interaction, 200 ms for the median longest task, and 10% main-thread occupancy in idle windows. All misses are printed. Add `--enforce` to exit nonzero on misses after establishing the same runner/browser/build conditions in CI. Functional scenario failures always fail. Targets are recorded in the report; do not loosen them to hide a regression. Examine raw per-run samples as well as medians.

### Local reference run, 2026-09-13

Chromium 153.0.8010.12 on macOS / Apple M4, 4× CPU slowdown, three repetitions of the production build, with Jelly and wobble preferences saved on in both modes. These are medians of the lab measurements described above.

| Measurement | Performance UI OFF | Performance UI ON |
|---|---:|---:|
| Search interaction | 272 ms | 24 ms |
| Open tool interaction (including chooser) | 336 ms | 96 ms |
| Edit interaction | 200 ms | 56 ms |
| Gallery idle-window main-thread occupancy | 97.0% | 11.3% |
| Tool idle-window main-thread occupancy | 98.5% | 12.3% |

All scenarios completed. ON met the interaction and longest-task targets; `--enforce` exited 1 because both idle windows exceeded 10%. Those remaining background-work costs are recorded rather than waived. This comparison exercises explicitly enabled decorative preferences, not the default profile with Jelly off.

Before release, repeat the scenarios on a real lower-powered phone or laptop using the same build and saved preferences. Record browser, device and power state; compare scrolling, typing, tool response and idle activity with the flag in both states. Synthetic throttling is a repeatable regression aid, and cannot certify actual device performance.

API semantics: [CSS layer priority](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@layer), [Event Timing](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming), [Chrome DevTools Performance domain](https://chromedevtools.github.io/devtools-protocol/tot/Performance/).

## Behaviour regressions

Against a local Vite development server:

```sh
LOLLY_GALLERY_TEST_URL=http://127.0.0.1:5187 node --test tests/performance-ui.browser.test.ts
LOLLY_PERF_BUILD_URL=http://127.0.0.1:5188 node --test --test-name-pattern='minified production' tests/performance-ui.browser.test.ts
node --test tests/ui-performance-metrics.test.ts tests/ui-performance-metrics.browser.test.ts
```

The behaviour suite verifies the CSS cascade and exclusions, live Jelly/dock teardown (including late asynchronous mounts), gallery node preservation and explicit template playback. The instrumentation test deliberately blocks a real click, checks that long-task and interaction timing detect it, and verifies the next phase discards that work.
