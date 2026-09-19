// SPDX-License-Identifier: MPL-2.0
/** Shared canvas-space policy for Design panels and compact actions. */
export function compactDesignViewport(): boolean {
  const width = window.visualViewport?.width ?? window.innerWidth;
  const height = window.visualViewport?.height ?? window.innerHeight;
  const touch = !!window.matchMedia?.('(any-pointer: coarse)').matches;
  return width <= 640 || (touch && (width <= 900 || height <= 500));
}

export function designPanelsFit(width: number, navigator: number, inspector: number): boolean {
  return width - navigator - inspector >= Math.min(480, width * 0.5);
}

export function stageBottomReserve(style: CSSStyleDeclaration): number {
  const px = (name: string): number => Math.max(0, parseFloat(style.getPropertyValue(name)) || 0);
  return Math.max(px('--stage-reserve-bottom'), px('--design-panel-reserve')) + px('--design-actions-h') + px('--design-viewport-inset');
}

export function panelStageHeight(stage: HTMLElement): number {
  const style = getComputedStyle(stage);
  return Math.max(0, stage.getBoundingClientRect().height
    - (parseFloat(style.getPropertyValue('--stage-reserve-top')) || 0)
    - (parseFloat(style.getPropertyValue('--design-actions-h')) || 0)
    - (parseFloat(style.getPropertyValue('--design-viewport-inset')) || 0));
}

export function compactActionsHeight(): number {
  return document.querySelector('.design-compact-actions')?.getBoundingClientRect().height || 60;
}
