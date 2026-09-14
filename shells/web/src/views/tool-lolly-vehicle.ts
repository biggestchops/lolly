// SPDX-License-Identifier: MPL-2.0
/** Shared editable-file vehicle for the Share dialog and export panel. */
import { buildLollyFile, creatorFromProfile, LOLLY_MIME, LOLLY_EXT, type LollyLibraryAsset, type LollyToolTrust } from '../lib/lolly-pack.ts';
import type { BeamAssetRecord } from '../lib/beam-pack.ts';
import { ENGINE_VERSION, decodeAssetVersion, licenceProfile, normaliseLicence } from '@lolly/engine';
import { assetLicenceDeclaration, assetRightsNotices, type AssetRightsMeta } from '../lib/asset-rights.ts';
import { resolveToolBundle } from '../lib/tool-bundle.ts';
import { getToolIntegrity } from '../catalog/integrity.ts';
import type { AssetRef } from '@lolly-tools/core/host-v1';
import type { ToolManifest } from '../../../../engine/src/loader.ts';
import type { ShareDialogLolly } from '../components/share-dialog.ts';
import type { WebToolHost } from './tool.ts';

interface LollyAssetsSlice {
  get(id: string, opts?: { format?: string; version?: string }): Promise<AssetRef>;
  _getUserRecord?(id: string, version?: string): Promise<BeamAssetRecord | null>;
  _getBlob(id: string, opts?: { format?: string; version?: string }): Promise<Blob | null>;
  _exportUserAssets(): Promise<readonly BeamAssetRecord[]>;
}

/** Whether a catalog asset's own bytes may travel inside a `.lolly`, and why not. */
export interface Redistribution {
  travels: boolean;
  /** Why the bytes were held back, in plain words. Empty when they travel. */
  reason: string;
  /**
   * Which KIND of rule held them back. A deployment's own catalog lock and a
   * licence condition are different things, and a credits file that printed
   * both in one column would read a brand policy as an extra copyright term on
   * open material (plan 253 section 11). `unknown` is the third answer: nothing
   * was recorded, which is neither.
   */
  kind: 'policy' | 'licence' | 'unknown';
  /** The canonical licence name, or '' when nothing was recorded. */
  licence: string;
  /** Notice texts the licence asks to travel with the bytes. */
  notices: string[];
}

/**
 * May these bytes be passed on? Answered from the reviewed licence profiles
 * (plan 253), not from a regular expression over the label.
 *
 * BEHAVIOUR CHANGE: unmarked catalog bytes no longer travel by default. The old
 * test matched `proprietary|all-rights-reserved|licenseref|premiumbeat` and let
 * everything else through, so an asset with NO licence recorded was treated as
 * freely redistributable. Missing licence information is not evidence of free
 * redistribution, so an unrecorded or not-yet-interpreted licence is now held
 * back with its reason. A `LicenseRef-*` is no longer proprietary by spelling
 * either; it is an identifier these rules do not carry, which is a different
 * sentence with the same outcome. `includeLicensed` still carries held-back
 * bytes when the sender says so, and the pack's credits file lists the choice.
 */
export function redistribution(meta: Record<string, unknown>): Redistribution {
  // One reader for the licence, shared with the catalog details sheet, so an
  // asset that records its licence only in the structured record cannot be held
  // back here as unrecorded while its own sheet shows it.
  const declared = assetLicenceDeclaration(meta as AssetRightsMeta);
  const normalised = declared ? normaliseLicence(declared) : null;
  const profile = normalised?.id ? licenceProfile(normalised.id) : null;
  const licence = profile?.name ?? normalised?.id ?? '';
  const notices = assetRightsNotices(meta.rights);
  if (meta.brandLock === true) {
    return { travels: false, kind: 'policy', reason: 'this brand pack is authoritative on this device', licence, notices };
  }
  if (!declared) return { travels: false, kind: 'unknown', reason: 'licence not recorded', licence, notices };
  if (!profile?.reviewed) {
    return {
      travels: false,
      kind: 'unknown',
      reason: normalised?.id ? `${normalised.id} is recorded and not yet interpreted` : `${declared} was not recognised`,
      licence,
      notices,
    };
  }
  if (profile.redistributeSource !== 'permitted-with-notices') {
    return { travels: false, kind: 'licence', reason: `${profile.name} does not record permission to pass on the source file`, licence, notices };
  }
  return { travels: true, kind: 'licence', reason: '', licence, notices };
}

/**
 * Build the `.lolly` download vehicle for the Share dialog, or undefined when the tool
 * has no saveable session (a pure render-only utility). Reuses the catalog + user-asset
 * bridge to resolve the session's closure, gates proprietary/brand-locked catalog bytes,
 * and assembles the creator block from the profile (identity gated on `useDetails`).
 */
// Tool files fetched as TEXT (the loader-critical set + svg); everything else as bytes.

/**
 * A cheap trust class for the "include the tool" default, without fetching every file:
 * a tool the deployment's signed catalog lists is `signed-catalog`; anything else
 * (unsigned build, a tool absent from the envelope, a sideloaded tool) is `custom`.
 */
async function coarseToolTrust(toolId: string): Promise<LollyToolTrust> {
  const integ = await getToolIntegrity().catch(() => null);
  const signed = integ?.envelope?.files;
  return signed && Object.hasOwn(signed, `${toolId}/tool.json`) ? 'signed-catalog' : 'custom';
}


export function makeLollyVehicle(
  host: WebToolHost,
  toolId: string,
  manifest: ToolManifest,
  sessionState: (() => unknown) | undefined,
  canvasEl?: Element | null
): ShareDialogLolly | undefined {
  if (typeof sessionState !== 'function') return undefined;
  const assets = host.assets as unknown as LollyAssetsSlice;
  const appVersion = `Lolly ${ENGINE_VERSION}`;

  const resolveLibrary = async (id: string): Promise<LollyLibraryAsset | null> => {
    try {
      const dep = decodeAssetVersion(id);
      const blob = await assets._getBlob(dep.id, dep.pin);
      if (!blob) return null;
      const ref = await assets.get(dep.id, dep.pin).catch(() => null);
      const meta = (ref?.meta ?? {}) as Record<string, unknown>;
      const permission = redistribution(meta);
      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mime: blob.type || '',
        type: ref?.type ?? 'raster',
        format: ref?.format ?? '',
        label: typeof meta.name === 'string' ? meta.name : id,
        licensed: !permission.travels,
        ...(permission.reason ? { holdReason: permission.reason, holdKind: permission.kind } : {}),
        ...(permission.licence ? { licence: permission.licence } : {}),
        ...(permission.notices.length ? { notices: permission.notices } : {}),
        ...(typeof meta.attribution === 'string' && meta.attribution.trim() ? { credit: meta.attribution.trim() } : {}),
      };
    } catch {
      return null;
    }
  };

  const build = async ({
    includeLicensed = false,
    includeTool = false,
  }: {
    includeLicensed?: boolean;
    includeTool?: boolean;
  } = {}) => {
    const session = sessionState() ?? null;
    const profile = await host.profile.get().catch(() => null);
    const userAssets = await assets._exportUserAssets();
    const creator = creatorFromProfile(profile, { appVersion });
    // Carry the tool's own files only on request - resolving them fetches every file.
    // A resolve failure (missing core files) degrades to a tool-less .lolly, never an error.
    const tool = includeTool ? await resolveToolBundle(toolId, manifest).catch(() => null) : null;
    // A raster thumbnail rides in the manifest so an importer - and the desktop
    // file managers' thumbnailer (plans/174 #3) - has a tile without rendering.
    // This closure has no canvas access, so the tile is the newest SAVED slot's
    // thumb for this tool (the same dataURL projects.ts ships) - best-effort,
    // and an unsaved-only session simply ships thumb-less, exactly as before.
    const thumb = session
      ? await host.state
          .list()
          .then((rows) => {
            const mine = (
              rows as unknown as { toolId: string; thumb: string | null; updatedAt?: string }[]
            )
              .filter((r) => r.toolId === toolId && typeof r.thumb === 'string')
              .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
            return mine[0]?.thumb ?? null;
          })
          .catch(() => null)
      : null;
    // Which font faces this render depended on, by identity (lib/session-fonts.ts) - the
    // font half of the reproducibility receipt. Strictly best-effort: no font bytes travel,
    // and a walk that fails costs the receipt its font list, never the share.
    const fonts = await import('../lib/session-fonts.ts')
      .then((m) => m.collectSessionFonts(canvasEl))
      .catch(() => []);
    // The design system this session wore, so the receiving studio's "Add from a
    // file" can install the same look (bridge/tokens.ts readUserDesignSystem).
    const designSystem = await import('../bridge/tokens.ts')
      .then((m) =>
        m.readUserDesignSystem(host as unknown as Parameters<typeof m.readUserDesignSystem>[0])
      )
      .catch(() => null);
    const { blob, filename, summary } = await buildLollyFile({
      session,
      toolId,
      ...(designSystem ? { designSystem } : {}),
      ...(fonts.length ? { fonts } : {}),
      ...(typeof thumb === 'string' && thumb.startsWith('data:image/') ? { thumb } : {}),
      toolVersion: manifest.version != null ? String(manifest.version) : undefined,
      name: String((manifest as { name?: unknown }).name ?? toolId),
      userAssets,
      resolveUser: assets._getUserRecord?.bind(assets),
      resolveLibrary,
      includeLicensed,
      creator,
      ...(tool ? { tool } : {}),
      appVersion,
      engineVersion: ENGINE_VERSION,
    });
    return { blob, filename, summary };
  };

  // The "include the tool" offer: resolved lazily by the dialog after it opens (a coarse
  // trust read, no file fetches), so a `custom` tool - one the deployment can't vouch for,
  // e.g. a fork or a private-brand tool a recipient likely lacks - defaults the toggle ON.
  const toolOffer = async () => {
    const trust = await coarseToolTrust(toolId).catch(() => 'custom' as LollyToolTrust);
    return { trust, suggested: trust === 'custom' };
  };

  // "Send to…" is offered ONLY where a real OS share will happen - host.export.canShare
  // probes the shell (web: navigator.canShare for the .lolly type, which Chromium's fixed
  // safelist rejects → hidden there; Tauri mobile: the native ACTION_SEND bridge present).
  // So the button never silently degrades to a download while claiming a share.
  const canOsShare =
    typeof host.export.canShare === 'function' &&
    host.export.canShare({ mime: LOLLY_MIME, filename: `share${LOLLY_EXT}` });
  const share = canOsShare
    ? (blob: Blob, filename: string) =>
        host.export.share!(blob, { filename, mime: LOLLY_MIME, title: filename })
    : undefined;
  return {
    build,
    toolOffer,
    save: (blob: Blob, filename: string) => host.export.file(blob, { filename }),
    share,
  };
}
