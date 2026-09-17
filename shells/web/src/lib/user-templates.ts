// SPDX-License-Identifier: MPL-2.0
/**
 * User templates - a creative saves the current tool doc as a reusable STARTING POINT for
 * that tool, so it joins the shipped per-tool templates in the "New from template" chooser,
 * the Projects add-picker and the Projects Templates collection (plans/226).
 *
 * A user template is a saved `values` seed under a tool id - the same shape a shipped
 * `tools/<id>/templates/<tid>.json` carries, minus the file - plus a name, an optional one-
 * line description and two display-only stamps (the design system it was made with, and
 * the ref it was copied from). What goes into `values` is decided once, in
 * views/tool-session-snapshot.ts `templateValuesFromSnapshot`, so the editor save and the
 * Projects "Save as a template..." write identical records.
 *
 * Storage mirrors folders.ts: the records ride the single profile record
 * (`profile.userTemplates`, declared on the core Profile type) through the host's Profile
 * get/set, so they persist, back up and restore like everything else on the profile, and a
 * read-modify-write over the WHOLE profile never clobbers sibling fields. No thumbnails are
 * stored - the chooser live-renders a template from its values through the shared
 * `template:<toolId>:<tid>` cache, and the user-templates test keeps a size gauge on the
 * profile so this stays the right home.
 *
 * The 2026-08 "variation" concept (`variationOf`) is legacy: older records may carry it,
 * the chooser may group by it, nothing writes it from now on.
 *
 * A record may also be SCOPED (plan 265 step 2). A `scope: 'look'` record is a saved
 * studio: half a document's values, not a starting point, so `list()` leaves it out and
 * only `listLooks()` returns it. It carries `lookVersion`, an integer that counts up on
 * every save over the same record, which is what lets a document name the version of a
 * studio it took its look from and notice when a newer one exists. Nothing else about a
 * scoped record differs: it rides the same profile field and the same get/set.
 */

import type { StudioLookScopeV1 } from '@lolly-tools/core/studio3d-v1';
import type { UserTemplateRecord } from '@lolly-tools/core/host-v1';

/**
 * A saved user template. The two optional fields are additive: a record without them is
 * the full-document template every earlier save wrote, and reads exactly as before.
 */
export interface UserTemplate extends UserTemplateRecord {
  /** 'look' marks a saved studio; absent marks a starting point for a new document. */
  scope?: StudioLookScopeV1['scope'];
  /** Present on a scoped record: 1 on the first save, one more on each save after. */
  lookVersion?: number;
}

interface UserTemplateProfile {
  userTemplates?: UserTemplate[];
  /** Shared with the host's Profile type so it satisfies this weak slice (mirrors folders). */
  custom?: Record<string, string>;
}

/**
 * The slice of the host bridge the store reads/writes - the profile get/set pair. `set` is
 * optional in the TYPE so a plain HostV1 (whose ProfileAPI declares only get/subscribe)
 * passes without a cast; the web host has it at runtime, and a mutation on a host without
 * it throws a clear error instead of silently doing nothing.
 */
export interface UserTemplateHost {
  profile: {
    get(): Promise<UserTemplateProfile>;
    set?(profile: UserTemplateProfile): Promise<unknown>;
  };
}

/** The Save dialog's name field limit; the store trims and refuses an empty name. */
export const MAX_TEMPLATE_NAME = 80;

function uuid(): string {
  if ((globalThis.crypto as { randomUUID?: unknown } | undefined)?.randomUUID) return crypto.randomUUID();
  return 'ut-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
const now = (): string => new Date().toISOString();

function cleanName(name: unknown): string {
  const label = String(name ?? '').trim().slice(0, MAX_TEMPLATE_NAME);
  if (!label) throw new Error('A template name is required.');
  return label;
}

function cleanDescription(text: unknown): string | undefined {
  const line = String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  return line || undefined;
}

/**
 * Can this tool carry a template at all? A `file` input's value is bytes in memory, not
 * a seed, so a tool whose only inputs are files (a pure on-device transform) has nothing
 * to save; a tool with no inputs (a self-contained live timer) likewise. One non-file
 * input is enough - "my compression settings" is a real template.
 */
export function canSaveTemplate(inputs: ReadonlyArray<{ type?: string }> | undefined): boolean {
  return (inputs ?? []).some((i) => i.type !== 'file');
}

export interface SaveTemplateInput {
  toolId: string;
  name: string;
  values: Record<string, unknown>;
  description?: string;
  designSystem?: { id: string; label: string };
  from?: string;
  /** Legacy: the 2026-08 variation card still passes it; kept on the record when given. */
  variationOf?: string;
  /** 'look' saves a studio instead of a starting point: `values` holds half a document. */
  scope?: UserTemplate['scope'];
}

export function createUserTemplateStore(host: UserTemplateHost) {
  // Read-modify-write over the whole profile object, so sibling fields survive (folders.ts).
  async function mutate<T>(fn: (list: UserTemplate[]) => T): Promise<T> {
    if (!host.profile.set) throw new Error('This host cannot save templates (no profile.set).');
    const profile = await host.profile.get();
    const list = (profile.userTemplates ?? []).map(t => ({ ...t }));
    const result = fn(list);
    await host.profile.set({ ...profile, userTemplates: list });
    return result;
  }

  function stamp(t: UserTemplate): void { t.updatedAt = now(); }

  const store = {
    /**
     * Every starting-point template, or just this tool's when `toolId` is given (newest
     * first). Saved studios are left out: they carry half a document, so a chooser that
     * starts a new one must never offer them. Use `listLooks` for those.
     */
    async list(toolId?: string): Promise<UserTemplate[]> {
      const profile = await host.profile.get();
      const all = (profile.userTemplates ?? []).slice().filter(t => !t.scope);
      const scoped = toolId ? all.filter(t => t.toolId === toolId) : all;
      return scoped.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    },

    /** Saved studios (`scope: 'look'`), for this tool when `toolId` is given, newest first. */
    async listLooks(toolId?: string): Promise<UserTemplate[]> {
      const profile = await host.profile.get();
      const all = (profile.userTemplates ?? []).filter(t => t.scope === 'look');
      const scoped = toolId ? all.filter(t => t.toolId === toolId) : all;
      return scoped.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    },

    /** One template by id, or null. */
    async get(id: string): Promise<UserTemplate | null> {
      const profile = await host.profile.get();
      return (profile.userTemplates ?? []).find(t => t.id === id) ?? null;
    },

    async save(input: SaveTemplateInput): Promise<UserTemplate> {
      const name = cleanName(input.name);
      if (!input.toolId) throw new Error('A tool id is required.');
      const description = cleanDescription(input.description);
      const tpl: UserTemplate = {
        id: uuid(),
        toolId: input.toolId,
        name,
        ...(description ? { description } : {}),
        values: input.values ?? {},
        ...(input.designSystem ? { designSystem: { ...input.designSystem } } : {}),
        ...(input.from ? { from: input.from } : {}),
        ...(input.variationOf ? { variationOf: input.variationOf } : {}),
        ...(input.scope === 'look' ? { scope: 'look' as const, lookVersion: 1 } : {}),
        createdAt: now(),
        updatedAt: now(),
      };
      await mutate(list => list.push(tpl));
      return tpl;
    },

    /**
     * "Save this look again": swap a saved studio's values and count its version up, so
     * a document that names the old version can tell there is a newer one. Returns the
     * updated record, or null when the id is gone or names a starting point rather than
     * a studio.
     */
    async updateLook(id: string, values: Record<string, unknown>): Promise<UserTemplate | null> {
      return mutate(list => {
        const t = list.find(x => x.id === id);
        if (t?.scope !== 'look') return null;
        t.values = values ?? {};
        t.lookVersion = Math.max(1, Math.trunc(Number(t.lookVersion) || 1)) + 1;
        stamp(t);
        return { ...t };
      });
    },

    /** "Update from this document": swap the seed, keep identity, name and stamps. */
    async replace(id: string, values: Record<string, unknown>): Promise<boolean> {
      return mutate(list => {
        const t = list.find(x => x.id === id);
        if (!t) return false;
        t.values = values ?? {};
        stamp(t);
        return true;
      });
    },

    async rename(id: string, name: string): Promise<void> {
      const label = cleanName(name);
      await mutate(list => {
        const t = list.find(x => x.id === id);
        if (t) { t.name = label; stamp(t); }
      });
    },

    /** Set or clear (empty string) the one-line description. */
    async describe(id: string, description: string): Promise<void> {
      const line = cleanDescription(description);
      await mutate(list => {
        const t = list.find(x => x.id === id);
        if (!t) return;
        if (line) t.description = line; else delete t.description;
        stamp(t);
      });
    },

    /** A new record with the same seed; `name` defaults to "<name> copy". */
    async duplicate(id: string, name?: string): Promise<UserTemplate | null> {
      const src = await store.get(id);
      if (!src) return null;
      return store.save({
        toolId: src.toolId,
        name: name ?? `${src.name} copy`,
        values: JSON.parse(JSON.stringify(src.values)) as Record<string, unknown>,
        description: src.description,
        designSystem: src.designSystem,
        from: `user:${src.id}`,
      });
    },

    async remove(id: string): Promise<void> {
      await mutate(list => {
        const i = list.findIndex(x => x.id === id);
        if (i >= 0) list.splice(i, 1);
      });
    },
  };
  return store;
}

export type UserTemplateStore = ReturnType<typeof createUserTemplateStore>;
