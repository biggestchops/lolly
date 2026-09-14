// SPDX-License-Identifier: MPL-2.0
// jsdom ships no type declarations (no @types/jsdom); same ambient-shim pattern as
// shells/{cli,web,tui}/src/jsdom.d.ts and scripts/jsdom.d.ts, narrowed to what this
// package uses - emoji.ts builds one window for its DOMParser and nothing else.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string);
    readonly window: Window & typeof globalThis;
  }
}
