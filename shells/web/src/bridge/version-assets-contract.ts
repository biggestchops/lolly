// SPDX-License-Identifier: MPL-2.0
/** Where preserved bytes live. Machine-owned: hidden from the user's library
 *  listing (bridge/assets.ts) but counted in their storage total. */
export const FROZEN_PREFIX = 'user/frozen/';

/** One stored user asset, as much of it as a faithful frozen copy needs. */
interface PreservableRecord {
  id: string;
  type: string;
  format: string;
  blob?: Blob;
  version?: string;
  meta?: Record<string, unknown>;
}

/** The slice of the assembled web host this preserver drives. Everything is
 *  optional-shaped at the call sites it can't rely on, so a partial test host
 *  (or a bridge built before versions existed) degrades to doing nothing. */
export interface PinPreserverHost {
  assets: {
    _getUserRecord(id: string): Promise<PreservableRecord | null>;
    _getBlob(id: string): Promise<Blob | null>;
    _uploadUserAsset(record: {
      id: string; type: string; format: string; blob: Blob;
      version?: string; meta?: Record<string, unknown>;
    }, opts?: { skipQuota?: boolean }): Promise<void>;
  };
  tokens?: { raw?(): Promise<unknown>; bust?(): void; isLocked?(): Promise<boolean> };
  log?(level: string, message: string, ctx?: unknown): void;
}
