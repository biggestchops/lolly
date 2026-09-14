// SPDX-License-Identifier: MPL-2.0
import type { AssetRef } from '@lolly-tools/core/host-v1';
import type { LearningBlock, LearningLesson, LearningModule } from '@lolly-tools/core/learning-v1';
import {
  learningRenditions,
  type LearningRenderable,
  type LearningRendition,
} from '../../../../engine/src/learning/delivery.ts';
import { newLearningModule, parseLearningModule } from '../../../../engine/src/learning/module.ts';

export interface LearningFolder {
  id: string;
  name: string;
  parentId?: string | null;
  items: Array<{ type: string; ref: string }>;
}
export interface LearningSelection {
  title?: string;
  projectId?: string | null;
  sessionRefs?: string[];
  assetRefs?: string[];
  folderIds?: string[];
  folders?: LearningFolder[];
}
export interface LearningCandidate {
  id: string;
  title: string;
  section: string;
  block?: LearningBlock;
  lessons?: LearningLesson[];
  sections?: LearningModule['sections'];
  moduleSlot?: string;
  renditions?: LearningRendition[];
  problem?: string;
}
export interface LearningReader {
  load(slot: string): Promise<Record<string, unknown> | null>;
  asset(id: string): Promise<AssetRef>;
  tool(id: string): Promise<LearningRenderable & { version?: string; name?: string }>;
}
export function learningAssetBlock(asset: AssetRef): LearningBlock {
  const kind =
    asset.type === 'video'
      ? 'video'
      : asset.type === 'audio'
        ? 'audio'
        : ['raster', 'vector'].includes(asset.type)
          ? 'image'
          : ['pdf', 'txt'].includes(asset.format)
            ? 'resource'
            : null;
  if (!kind || asset.source === 'remote')
    throw new Error(
      'Import or export this item as an image, video, audio, PDF or text file first.'
    );
  if (['gif', 'apng'].includes(asset.format) || asset.meta?.animated)
    throw new Error('Export this animation as a video before adding it to the course.');
  return {
    id: crypto.randomUUID(),
    kind,
    description: String(asset.meta?.name || ''),
    source: { kind: 'asset', asset: structuredClone(asset), capturedAt: new Date().toISOString() },
  };
}
export async function learningSessionCandidate(
  reader: LearningReader,
  slot: string,
  data: Record<string, unknown>,
  section = ''
): Promise<LearningCandidate> {
  const title = String(data.__label || data.__export_filename || data.__toolId || slot);
  if (data.__learningModule) {
    const module = parseLearningModule(data.__learningModule);
    return {
      id: slot,
      title: module.title,
      section,
      lessons: module.lessons,
      sections: module.sections,
      moduleSlot: slot,
    };
  }
  if (typeof data.__toolId !== 'string') throw new Error('This item has no saved tool source.');
  const tool = await reader.tool(data.__toolId);
  const renditions = learningRenditions(tool);
  if (!renditions.length)
    throw new Error(
      'This tool cannot provide a saved course rendition. Export its finished file and add that file instead.'
    );
  const values = Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith('__')));
  const boxes = Array.isArray(values.boxes) ? values.boxes : [];
  const moving =
    ['mp4', 'webm', 'gif', 'apng'].includes(String(data.__export_format)) ||
    boxes.some(
      (b) =>
        b &&
        typeof b === 'object' &&
        (b.lane === 'seq' ||
          typeof b.start === 'number' ||
          ['enter', 'exit', 'kf'].some((k) => b[k] && b[k] !== 'none'))
    );
  if (moving && !renditions.some((r) => r.kind === 'video'))
    throw new Error(
      'This animation needs a video rendition that is unavailable on this device. Export a finished video and add it to the course.'
    );
  const chosen = (moving && renditions.find((r) => r.kind === 'video')) || renditions[0]!;
  return {
    id: slot,
    title,
    section,
    renditions,
    block: {
      id: crypto.randomUUID(),
      kind: chosen.kind,
      description: title,
      source: {
        kind: 'session',
        slot: slot.includes('#row-') ? undefined : slot,
        toolId: data.__toolId,
        toolVersion: typeof data.__toolVersion === 'string' ? data.__toolVersion : tool.version,
        values: structuredClone(values),
        capturedAt: new Date().toISOString(),
        motion: chosen.kind === 'video',
      },
    },
  };
}
/** Folder traversal accounts for every item, including errors, and preserves explicit order. */
export async function collectLearningSelection(
  selection: LearningSelection,
  reader: LearningReader
): Promise<LearningCandidate[]> {
  const result: LearningCandidate[] = [],
    seen = new Set<string>(),
    visited = new Set<string>();
  const add = async (type: string, ref: string, section: string) => {
    const key = `${type}:${ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 5000) throw new Error('Select fewer than 5000 project items for one course.');
    try {
      if (type === 'image') {
        const asset = await reader.asset(ref);
        result.push({
          id: key,
          title: String(asset.meta?.name || ref),
          section,
          block: learningAssetBlock(asset),
        });
      } else if (type === 'session') {
        const data = await reader.load(ref);
        if (!data) throw new Error('This saved item is unavailable.');
        if (data.__batch) {
          const rows = Array.isArray(data.rows) ? data.rows : [];
          if (!rows.length) throw new Error('This batch contains no rows.');
          if (rows.length + result.length > 5000)
            throw new Error('Select fewer than 5000 batch rows for one course.');
          for (const [i, row] of rows.entries()) {
            const id = `${ref}#row-${i}`;
            try {
              result.push(
                await learningSessionCandidate(
                  reader,
                  id,
                  {
                    ...row.values,
                    __toolId: row.toolId,
                    __label: row.filename || `Row ${i + 1}`,
                    __export_format: row.format || data.format,
                  },
                  [section, String(data.__label || 'Batch')].filter(Boolean).join(' / ')
                )
              );
            } catch (e) {
              result.push({
                id,
                title: `Row ${i + 1}`,
                section,
                problem: String(e instanceof Error ? e.message : e),
              });
            }
          }
        } else result.push(await learningSessionCandidate(reader, ref, data, section));
      } else throw new Error('This project item type cannot be included in a course.');
    } catch (e) {
      result.push({
        id: key,
        title: ref,
        section,
        problem: String(e instanceof Error ? e.message : e),
      });
    }
  };
  const walk = async (id: string, ancestors: Set<string>) => {
    if (ancestors.has(id)) throw new Error('The project contains a circular folder relationship.');
    if (visited.has(id)) return;
    visited.add(id);
    const folder = selection.folders?.find((f) => f.id === id);
    if (!folder) {
      result.push({ id, title: id, section: '', problem: 'This folder is unavailable.' });
      return;
    }
    for (const item of folder.items) await add(item.type, item.ref, folder.name);
    for (const child of selection.folders?.filter((f) => f.parentId === id) || [])
      await walk(child.id, new Set([...ancestors, id]));
  };
  for (const id of selection.folderIds || []) await walk(id, new Set());
  for (const ref of selection.sessionRefs || []) await add('session', ref, '');
  for (const ref of selection.assetRefs || []) await add('image', ref, '');
  return result;
}
export function moduleFromLearningCandidates(
  title: string,
  candidates: LearningCandidate[],
  projectId: string | null = null
): LearningModule {
  if (!candidates.length || candidates.some((c) => c.problem))
    throw new Error('Choose available content. Unselect or replace each unavailable item.');
  const module = newLearningModule(crypto.randomUUID(), title.trim() || 'Learning module');
  module.projectId = projectId;
  const sectionFor = (title: string) => {
    if (!title) return undefined;
    let section = module.sections.find((s) => s.title === title);
    if (!section) {
      section = { id: crypto.randomUUID(), title };
      module.sections.push(section);
    }
    return section.id;
  };
  for (const candidate of candidates) {
    const lessons = candidate.lessons || [
      {
        id: '',
        title: candidate.title,
        required: true,
        blocks: candidate.block ? [candidate.block] : [],
      },
    ];
    for (const lesson of lessons) {
      const section =
        candidate.sections?.find((s) => s.id === lesson.sectionId)?.title || candidate.section;
      module.lessons.push({
        ...structuredClone(lesson),
        id: crypto.randomUUID(),
        sectionId: sectionFor(section),
        blocks: lesson.blocks.map((b) => ({ ...structuredClone(b), id: crypto.randomUUID() })),
      });
    }
  }
  return parseLearningModule(module);
}
