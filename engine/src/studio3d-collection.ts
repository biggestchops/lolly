// SPDX-License-Identifier: MPL-2.0
/** One studio shared by a bounded collection, with explicit per-item overrides. */
export type StudioValues = Record<string, unknown>;
export interface StudioCollectionRow {
  index: number;
  name: string;
  filename: string;
  ownFraming: boolean;
  values: StudioValues;
}
export const STUDIO_COLLECTION_LIMIT = 24;

function record(value: unknown): StudioValues {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as StudioValues) : {};
}
const enabled = (value: unknown): boolean => value === true || value === 'true' || value === 1;

function items(values: StudioValues): StudioValues[] {
  if (!Array.isArray(values.subjects) || !values.subjects.length)
    throw new Error('Add at least one item to the collection.');
  if (values.subjects.length > STUDIO_COLLECTION_LIMIT)
    throw new Error(`Use up to ${STUDIO_COLLECTION_LIMIT} items in one collection.`);
  return values.subjects.map(record);
}

export function studioActiveIndex(values: StudioValues): number {
  const rows = items(values);
  const n = Number(values.activeSubject);
  return Math.max(0, Math.min(rows.length - 1, Number.isFinite(n) ? Math.trunc(n) - 1 : 0));
}

function itemValues(values: StudioValues, item: StudioValues): StudioValues {
  const kind =
    item.kind === 'model' ? 'model' : item.kind === 'primitive' ? 'primitive' : 'artwork';
  const camera = record(values.camera);
  const framing: StudioValues = { ...camera };
  if (enabled(item.ownFraming))
    for (const key of ['azimuth', 'elevation', 'fov', 'zoom', 'panX', 'panY', 'panZ']) {
      if (item[key] !== undefined && item[key] !== '') framing[key] = item[key];
    }
  return {
    ...values,
    source: kind,
    subjects: [],
    activeSubject: 1,
    upload: undefined,
    primitive: item.primitive || 'badge',
    artwork: kind === 'artwork' ? item.asset : undefined,
    modelAsset: kind === 'model' ? item.asset : undefined,
    modelFormat: item.modelFormat || 'auto',
    camera: framing,
    focusDistance: enabled(item.ownFocus) ? item.focusDistance : values.focusDistance,
    materialSlotA: item.roleA || '',
    materialSlotB: item.roleB || '',
  };
}

/** Evaluates the selected item without changing the saved shared values. */
export function studioActiveValues(values: StudioValues): StudioValues {
  if (values.source !== 'collection') return values;
  return itemValues(values, items(values)[studioActiveIndex(values)]!);
}

/** Ordered, collision-free filenames and standalone rows for the normal batch renderer. */
export function studioCollectionRows(values: StudioValues): StudioCollectionRow[] {
  return items(values).map((item, index) => {
    const name =
      String(item.name || `Item ${index + 1}`)
        .trim()
        .slice(0, 120) || `Item ${index + 1}`;
    const slug =
      name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 70) || 'item';
    return {
      index,
      name,
      filename: `${String(index + 1).padStart(2, '0')}-${slug}.png`,
      ownFraming: enabled(item.ownFraming),
      values: itemValues(values, item),
    };
  });
}

/** A gesture changes this item's framing; shared camera controls stay shared. */
export function studioCameraEdit(
  values: StudioValues,
  camera: StudioValues
): { id: string; value: unknown } {
  if (values.source !== 'collection') return { id: 'camera', value: camera };
  const index = studioActiveIndex(values);
  return {
    id: 'subjects',
    value: items(values).map((item, i) =>
      i === index
        ? {
            ...item,
            ownFraming: true,
            azimuth: camera.azimuth,
            elevation: camera.elevation,
            fov: camera.fov,
            zoom: camera.zoom,
            panX: camera.panX ?? 0,
            panY: camera.panY ?? 0,
            panZ: camera.panZ ?? 0,
          }
        : item
    ),
  };
}

/** Focus picking affects only the active collection item. Zero returns to automatic focus. */
export function studioFocusEdit(
  values: StudioValues,
  distance: number
): { id: string; value: unknown } {
  if (values.source !== 'collection') return { id: 'focusDistance', value: distance };
  const index = studioActiveIndex(values);
  return {
    id: 'subjects',
    value: items(values).map((item, i) =>
      i === index ? { ...item, ownFocus: true, focusDistance: distance } : item
    ),
  };
}

export function studioCollectionSize(values: StudioValues): { width: number; height: number } {
  const size = record(values.collectionSize);
  const edge = (value: unknown): number => {
    const n = Number(value);
    return Math.max(64, Math.min(4096, Number.isFinite(n) && n > 0 ? Math.round(n) : 1024));
  };
  const width = edge(size.width),
    height = edge(size.height);
  if (width * height > 12_000_000) throw new Error('Keep each image below 12 million pixels.');
  return { width, height };
}
