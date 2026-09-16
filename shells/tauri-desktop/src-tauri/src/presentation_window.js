// SPDX-License-Identifier: MPL-2.0
// WKWebView requires its supplied popup configuration, including immutable URL scheme
// handlers. Its inherited ipc:// handler belongs to the opener. Let Tauri fall back
// to the child's own WKScriptMessageHandler so native commands carry the child label.
// This is transport routing, not an isolation boundary: the trusted UI shares an opener.
(() => {
  const fetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'object' && input !== null && 'url' in input ? input.url : String(input);
    if (/^ipc:/i.test(url.trimStart())) return Promise.reject(new TypeError('Private controls use message IPC'));
    return fetch(input, init);
  };
})();
