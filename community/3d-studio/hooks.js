// SPDX-License-Identifier: MPL-2.0

async function compute(model) {
  const values = {};
  for (let i = 0; i < model.length; i++) values[model[i].id] = model[i].value;
  const rows = Array.isArray(values.subjects)
    ? values.subjects.map((row) => ({
        ...row,
        ownFraming: row.ownFraming === true || row.ownFraming === 'true' || row.ownFraming === 1,
        ownFocus: row.ownFocus === true || row.ownFocus === 'true' || row.ownFocus === 1,
      }))
    : [];
  const normalizeRows =
    Array.isArray(values.subjects) &&
    values.subjects.some(
      (row, i) =>
        row.ownFraming !== rows[i].ownFraming ||
        row.ownFocus !== rows[i].ownFocus ||
        (typeof row.asset === 'string' && row.asset)
    );
  if (Array.isArray(values.subjects)) values.subjects = rows;
  for (const key of ['artwork', 'modelAsset', 'backdropImage']) {
    let value = values[key];
    if (typeof value === 'string' && value) value = await host.assets.get(value);
    if (value && typeof value === 'object')
      values[key] = {
        id: value.id || '',
        url: value.url || '',
        name: value.name || value.meta?.name || value.id || '',
      };
  }
  if (Array.isArray(values.subjects))
    values.subjects = await Promise.all(
      values.subjects.map(async (row, index) => {
        let value = row.asset;
        if (typeof value === 'string' && value) value = await host.assets.get(value);
        rows[index] = { ...row, asset: value };
        return {
          ...row,
          asset:
            value && typeof value === 'object'
              ? {
                  id: value.id || '',
                  url: value.url || '',
                  name: value.name || value.meta?.name || value.id || '',
                }
              : value,
        };
      })
    );
  return {
    ...(normalizeRows ? { subjects: rows } : {}),
    _studioState: JSON.stringify({ version: 1, values: values }),
    _expert: values.controls === 'expert' || values.materialMode === 'custom',
    _collection: values.source === 'collection',
    _clipMs:
      values.motion === 'turntable' || (values.lightMotion && values.lightMotion !== 'still')
        ? Math.max(1, Math.min(30, Number(values.duration) || 5)) * 1000
        : 0,
  };
}

// biome-ignore lint/correctness/noUnusedVariables: The runtime calls this hook.
function onInit(ctx) {
  return compute(ctx.model);
}
// biome-ignore lint/correctness/noUnusedVariables: The runtime calls this hook.
function onInput(ctx) {
  return compute(ctx.model);
}
