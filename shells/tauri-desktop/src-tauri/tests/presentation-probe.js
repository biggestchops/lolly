// SPDX-License-Identifier: MPL-2.0
// Bundled only with the presentation-probe Cargo feature. All camera pixels are generated.
(() => {
  'use strict';
  window.__LOLLY_CLI__ = { stdout: false };
  const checks = [], failures = [], streams = [], opened = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const wait = async (read, name) => {
    for (let i = 0; i < 300; i++) {
      try { const value = read(); if (value) return value; } catch { /* window may be transitioning */ }
      await delay(100);
    }
    throw new Error(`Timed out: ${name}`);
  };
  const button = (doc, name) => [...doc.querySelectorAll('button')].find(el => (el.getAttribute('aria-label') || el.textContent).trim() === name);
  const field = (doc, name, value) => {
    const input = doc.querySelector(`[aria-label="${name}"]`);
    if (!input) throw new Error(`Missing field: ${name}`);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const capabilities = { canvasStream: typeof HTMLCanvasElement.prototype.captureStream === 'function',
    media: !!navigator.mediaDevices, regionCapture: !!window.CropTarget, displayCapture: !!navigator.mediaDevices?.getDisplayMedia };
  const report = data => window.__TAURI_INTERNALS__.invoke('presentation_probe_report', {
    ...data, checks, failures, userAgent: navigator.userAgent, capabilities,
  });
  window.addEventListener('error', event => failures.push(event.message));
  window.addEventListener('unhandledrejection', event => failures.push(String(event.reason)));
  const open = window.open.bind(window);
  window.open = (...args) => { const popup = open(...args); if (popup) opened.push(popup); return popup; };
  let produced = 0, acquired = 0;
  const generatedCamera = async constraints => {
    if (constraints.audio) throw new Error('The presentation probe has no microphone source');
    acquired++;
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d');
    const draw = () => {
      produced++; ctx.fillStyle = '#286459'; ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = '#faf4e5'; ctx.font = 'bold 38px system-ui'; ctx.fillText('LOLLY', 32, 70);
      ctx.font = '24px system-ui'; ctx.fillText('Generated camera', 32, 116);
      ctx.fillStyle = '#d9ed97'; ctx.fillRect(32 + produced % 220, 220, 96, 96);
    };
    draw(); const stream = canvas.captureStream(30), timer = setInterval(draw, 1000 / 30);
    const track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
    track.stop = () => { clearInterval(timer); stop(); };
    streams.push(stream); return stream;
  };
  // Keep a stable facade: WebKit can discard the early mediaDevices wrapper and its expandos.
  // Never fall through to physical capture, including in a newly opened private document.
  const media = new EventTarget();
  Object.defineProperties(media, {
    getUserMedia: { value: generatedCamera },
    getDisplayMedia: { value: async () => { throw new Error('Native display capture is outside this probe'); } },
    enumerateDevices: { value: async () => [] },
  });
  Object.defineProperty(navigator, 'mediaDevices', { value: media });
  const startCamera = doc => {
    check(navigator.mediaDevices === media && navigator.mediaDevices.getUserMedia === generatedCamera,
      'generated camera facade is installed');
    button(doc, 'Start camera').click();
  };

  const run = async () => {
    await wait(() => document.body, 'document');
    location.hash = '#/tool/countdown-timer';
    await wait(() => button(document, 'Present with camera'), 'Countdown source');
    const start = async () => {
      button(document, 'Present with camera').click();
      const popup = await wait(() => opened.at(-1), 'private window');
      await wait(() => popup.document.querySelector('.pr-production-controls'), 'private controls');
      return popup;
    };
    let popup = await start();
    check(!!popup.document.body && popup.opener === window, 'same-origin opener and private document');
    popup.focus(); await delay(100);
    check(!popup.closed && !!popup.document.querySelector('.pr-production-controls'), 'native focus preserves private document');
    check(!document.querySelector('.pr-program button,.pr-program input,.pr-program .pr-sp-notes'), 'audience contains no private controls');
    field(popup.document, 'Countdown duration', '0:30');
    button(popup.document, 'Start timer').click();
    await wait(() => document.querySelector('.pr-countdown-time')?.textContent === '0:29', 'live Countdown');
    check(true, 'Countdown runs through private controls');
    startCamera(popup.document);
    const preview = await wait(() => {
      const video = popup.document.querySelector('.pr-prepared-camera video');
      return video?.readyState >= 2 && video.videoWidth ? video : null;
    }, 'borrowed camera preview');
    check(acquired === 1 && preview.srcObject === document.querySelector('.pr-program-camera video').srcObject,
      'one camera stream shared with private preview');
    const framing = popup.document.querySelector('[aria-label="Move camera"]');
    framing.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
    check(popup.document.querySelector('[aria-label="Camera left"]').value === '910'
      && document.querySelector('.pr-program-camera').style.left === '920px', 'private keyboard framing leaves audience unchanged');
    field(popup.document, 'Camera corner radius', '24');
    field(popup.document, 'Camera border width', '3');
    field(popup.document, 'Scene name', 'Opening');
    button(popup.document, 'Save scene').click();
    field(popup.document, 'Prepared scene', 'camera');
    field(popup.document, 'Saved scene', 'scene-1');
    check(popup.document.querySelector('[aria-label="Prepared scene"]').value === 'inset', 'saved scene restores private settings');
    field(popup.document, 'Lower-third name', 'Alex Presenter');
    field(popup.document, 'Lower-third detail', 'Lolly desktop presentation');
    button(popup.document, 'Apply prepared scene').click();
    await wait(() => [...popup.document.querySelectorAll('[role="status"]')].some(el => el.textContent === 'Scene applied.'), 'Apply');
    check(document.querySelector('.pr-program-camera').style.left === '910px'
      && document.querySelector('.pr-program-camera').style.borderRadius === '24px', 'Apply takes framing and appearance to native audience');
    button(popup.document, 'Show lower third').click();
    check(!!document.querySelector('.pr-program-lower-on'), 'lower third reaches clean audience');
    const before = produced; await delay(1100);
    check(produced - before >= 20, 'generated camera advances with private controls open');
    check(window.open('about:blank', 'additional-private-probe', 'popup=yes') == null, 'second private window refused');
    check(popup.open('about:blank', 'nested-private-probe') == null, 'nested popup refused');
    let denied = false;
    try { await popup.__TAURI_INTERNALS__.invoke('desktop_poll_events'); } catch { denied = true; }
    check(denied, 'child application commands refused');
    denied = false;
    try { await popup.__TAURI_INTERNALS__.invoke('plugin:fs|read_text_file', { path: '/nonexistent-presentation-probe' }); }
    catch (error) { denied = /not allowed|forbidden|denied/i.test(String(error)); }
    check(denied, 'child filesystem permission refused');
    popup.location.href = 'https://example.invalid/presentation-probe'; await delay(300);
    check(!!popup.document.querySelector('.pr-production-controls'), 'external child navigation refused');
    popup.close();
    await wait(() => popup.closed, 'native private close');
    await wait(() => !document.querySelector('.pr-program-holding')?.hidden, 'holding on controls loss');
    check(streams[0].getVideoTracks()[0].readyState === 'ended', 'closing controls releases camera');
    check(document.querySelector('.ct-root')?.getAttribute('data-state') === 'paused', 'closing controls pauses Countdown');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', bubbles: true }));
    popup = await wait(() => opened.at(-1)?.closed === false ? opened.at(-1) : null, 'reopened controls');
    await wait(() => button(popup.document, 'Start camera'), 'stopped camera on reopen');
    check(acquired === 1, 'reopen never auto-acquires camera');
    check(popup.document.querySelectorAll('[aria-label="Saved scene"] option').length === 2, 'saved scene survives native controls reopen');
    button(popup.document, 'End presentation').click();
    await wait(() => !document.querySelector('.pr-program') && popup.closed, 'end presentation teardown');
    check(true, 'End presentation closes native controls and output');
    // Leave the final composition open for a native screenshot and manual focus/close checks.
    popup = await start();
    startCamera(popup.document);
    await wait(() => popup.document.querySelector('.pr-prepared-camera video')?.readyState >= 2, 'final camera preview');
    await report({ phase: 'complete', ok: true, acquired, produced, output: {
      width: document.querySelector('.pr-program').offsetWidth, height: document.querySelector('.pr-program').offsetHeight },
      focus: { audience: document.hasFocus(), controls: popup.document.hasFocus() } });
  };
  void run().catch(async error => {
    for (const stream of streams) stream.getTracks().forEach(track => track.stop());
    for (const popup of opened) { if (!popup.closed) button(popup.document, 'Stop camera')?.click(); }
    await report({ phase: 'failed', ok: false, error: String(error), acquired, produced, href: location.href });
  });
})();
