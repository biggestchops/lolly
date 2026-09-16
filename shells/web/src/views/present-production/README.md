# Presentation composition

The shared shell renders the audience picture. Desktop uses the same modules and supplies a private-window adapter. The user guide is [Presenting with camera](../../../../../docs/presenting.md).

## Ownership and data

- `scene.ts` defines version-1 settings and eight bounded named scenes. `readScene` whitelists persisted data and strips runtime handles and nested scene collections. Stable layer IDs are `camera`, `logo` and `lower`. Logo references retain an explicit asset `pin` as well as source, format and version. Normal document sharing carries each scene's exact logo bytes and rebases the pin to the receiver's stored version; resolved version metadata alone cannot do that.
- `../present-production.ts` owns one local session: applied settings, camera, output, recording and private controls. `tool/presentation.ts` connects saved settings to the document's existing `__presentation` snapshot and dirty-state path. This metadata does not add inputs to tool manifests.
- `source.ts` describes the live content attachment. Existing Design presentation navigation owns slide changes; `countdown.ts` supplies the second live source and its private controls. Arbitrary DOM tools require their own lifecycle contract before being added.
- `camera.ts` acquires one video-only stream in the audience document. Device selection is local and optional. A generation counter rejects late acquisitions; stop, interruption and disposal release tracks. Self-preview and framing consumers borrow the same stream without opening a device.
- `output.ts` owns the fixed 1280 × 720 audience DOM, live video, logo and lower-third animation. Crop is independent of placement; only camera pixels are mirrored. The renderer does not copy HTML into a canvas on each frame.
- `controls.ts` edits a private draft. `prepared-scenes.ts` saves and loads recipes without taking them to the audience. Apply resolves/decode-checks the logo before changing output. Loading a scene invalidates pending uploads; library saves survive an in-flight Apply. Camera, slide and lower-third cues are deliberate immediate actions.
- `framing.ts` maps pointer and keyboard edits into output coordinates. It borrows the camera stream and owns its own observers. Disposing it detaches consumers, never the source.

Camera IDs, permissions, tracks, blob URLs, preview mirror and active cues are absent from saved state. Opening a document or selecting a saved scene never starts a source. P2P document sharing and optional Work services retain their existing roles; this feature introduces no frame or audio traffic on their channels.

## Lifecycle

Closing private controls produces black output, stops the camera, pauses live content and finishes recording. Reopening provides stopped controls. Holding stops live camera exposure and pauses content; Apply clears the hold, while source restart stays explicit. End closes the output and releases its consumers. A denied popup has no in-page private-note fallback.

Apply, logo upload, camera start and recording preparation each guard stale completions. Holding or losing controls cancels a pending Apply so a late logo cannot reveal the audience again. UI work runs in the private document. The audience surface contains no pickers, notes, collaboration cursors or error messages.

## Recording boundary

`recording.ts` requests this audience tab with fresh browser consent, crops to the audience element, then samples the browser-composed video into the existing recorder. This adds a browser capture/composition copy; it is not a native zero-copy path. Silent video is the default, with a separate opt-in microphone. Tool and call audio are not mixed or monitored.

The recorder owns a bounded encoded-byte sink: temporary local storage where available, or a byte-limited fallback. A session has explicit stop, cancel and completion. The first of 30 minutes or 512 MiB stops the take. The final provenance/download path still materializes a Blob; failed downloads retain it for retry only while the session remains open. File-backed finalization is future work.

Region capture is capability-gated. The tested macOS WKWebView does not expose `CropTarget`, so its recording button explains the limitation. DOM audience presentation still works there. Neither capture API presence nor local playback proves conferencing delivery.

## Native boundary and API decision

`shells/tauri-desktop/src-tauri/src/presentation_windows.rs` implements one owned, same-origin private window. The child is trusted shell UI with opener access, not a sandbox. Its own IPC identity has no filesystem/plugin grants; application commands require the main window. The native adapter does not transport frames.

Keep this session contract shell-private for M1. The existing synchronous `host.media` contract is unchanged. Define an additive portable media-session capability after native source/sink experiments establish ownership, backpressure and finalization. Native handles and per-frame pixels must stay behind the platform bridge; document sharing carries recipes, not those handles.

Next output investigation: capture a dedicated audience window with ScreenCaptureKit, feed a bounded sample queue into a macOS camera-extension sink, and measure actual delivery. Installation, signing, activation and other operating systems are separate work. This is a proposed route, not M1 virtual-camera support.

## Verification and limits

Run feature unit tests with:

```sh
node --test shells/web/src/views/present-production/*.test.ts shells/web/src/views/present-mode.test.ts
```

With the web shell served locally, run browser integration tests:

```sh
LOLLY_PRESENT_TEST_URL=http://127.0.0.1:5184 node --test --test-concurrency=1 tests/present-production.browser.test.ts tests/present-prepared-scenes.browser.test.ts tests/recorder-reliability.browser.test.ts
```

Browser tests use generated media. Run capture fixtures serially: concurrent capture/browser builds on the same desktop produced intermittent picker and history-save timeouts in the development run. The opt-in `presentation-probe` Cargo feature similarly uses an immutable generated-camera facade in an installed development bundle. Never substitute physical capture implicitly when extending these probes. Ordinary release builds exclude the probe.

`scripts/probe-presentation-soak.ts` records and reads back a sustained take with bounded-storage and process telemetry. `scripts/probe-presentation-sync.ts` schedules generated flashes and tones against one AudioContext clock, then decodes their leading edges with FFmpeg. Its analysis excludes detector interval closures at EOF. These measure the recording path; they do not establish physical microphone/camera or receiver latency.

The regression cases cover draft/apply separation, named-scene persistence, device-switch cancellation, source borrowing, crop/mirror, live Countdown, popup failure/closure, lower thirds, responsive controls, file readback, storage/encoder failures and save retry. Physical camera permissions, device removal, sleep/occlusion, real-call reception, OBS output, A/V latency/drift and release-signed runtime acceptance remain separate measurements. Windows, Linux and mobile have no runtime support claim from these tests.
