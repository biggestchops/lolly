// SPDX-License-Identifier: MPL-2.0
import type { ExportOpts } from './export.ts';

/** A declared tool presentation owns layout and restores it after an export. */
export interface PresentationController {
  prepare(format: string, opts: ExportOpts): (() => void) | Promise<() => void>;
  readable(opts: ExportOpts): () => void;
  dispose(): void;
  readonly duration: number;
  readonly mode: 'editable' | 'animated';
  readonly title: string;
  readonly animate?: boolean;
  readonly notes: string;
  kit?(): { variants: Array<{ name: string; markup: string; static?: boolean }>; video: boolean; readme: string; calendar?: string };
  poster?(): () => void;
  freeze?(): () => void;
}
export function presentationOf(node: Element): PresentationController | null {
  const root = node.matches('[data-presentation]') ? node : node.querySelector('[data-presentation]');
  return (root as (Element & { __lollyPresentation?: PresentationController }) | null)?.__lollyPresentation ?? null;
}
