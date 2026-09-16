// SPDX-License-Identifier: MPL-2.0
import { licenceProfile, normaliseLicence } from '@lolly/engine';
import { assetLicenceDeclaration, assetRightsNotices, type AssetRightsMeta } from './asset-rights.ts';

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
