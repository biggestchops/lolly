// SPDX-License-Identifier: MPL-2.0
import { JSDOM } from 'jsdom';

const dom = new JSDOM('');
export const parseEmojiXml = (source: string): Document => new dom.window.DOMParser().parseFromString(source, 'image/svg+xml');
