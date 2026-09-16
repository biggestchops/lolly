// SPDX-License-Identifier: MPL-2.0

async function compute(model) {
  const values = {};
  for (let i = 0; i < model.length; i++) values[model[i].id] = model[i].value;
  const flag = (value) => value === true || value === 'true' || value === 1;
  // Collection items and arrangement objects both carry an asset per row plus booleans
  // that URL mode may deliver as strings; normalize once and write back only on change.
  const lists = {
    subjects: ['ownFraming', 'ownFocus'],
    objects: ['grounded', 'visible'],
  };
  const patch = {};
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
  const blank = (value) => value === undefined || value === null || value === '';
  for (const [key, flags] of Object.entries(lists)) {
    if (!Array.isArray(values[key])) continue;
    const rows = values[key].map((row) => {
      const next = { ...row };
      for (const name of flags)
        next[name] = row[name] === undefined ? name !== 'ownFraming' && name !== 'ownFocus' : flag(row[name]);
      return next;
    });
    // Objects dropped onto the list or chosen from the library arrive at the centre.
    // A newcomer that would sit on top of, or inside, an object already placed takes
    // the next free place along the stage instead. Every source is normalised to
    // about 3.25 studio units across, so widths follow the scale.
    if (key === 'objects') {
      const placed = [];
      const width = (row) => 3.25 * (Number(row.scale) || 0.6);
      const crowded = (x, z, w) =>
        placed.some((p) => Math.abs(p.x - x) < (w + p.w) / 2 && Math.abs(p.z - z) < (w + p.w) / 2);
      rows.forEach((row) => {
        if (blank(row.x) && blank(row.z)) row.x = row.z = 0;
        const x = Number(row.x) || 0,
          z = Number(row.z) || 0,
          w = width(row);
        const newcomer = x === 0 && z === 0;
        const duplicate = placed.some((p) => p.x === x && p.z === z);
        if ((newcomer && crowded(x, z, w)) || duplicate) {
          const step = w + 0.35;
          for (let slot = 1; slot < 64; slot++) {
            const candidate = Math.round((slot % 2 ? 1 : -1) * Math.ceil(slot / 2) * step * 100) / 100;
            if (!crowded(candidate, 0, w)) {
              row.x = candidate;
              row.z = 0;
              break;
            }
          }
        }
        placed.push({ x: Number(row.x) || 0, z: Number(row.z) || 0, w });
      });
    }
    let normalizeRows = values[key].some(
      (row, i) =>
        flags.some((name) => row[name] !== rows[i][name]) ||
        row.x !== rows[i].x ||
        row.z !== rows[i].z ||
        (typeof row.asset === 'string' && row.asset)
    );
    values[key] = await Promise.all(
      rows.map(async (row, index) => {
        let value = row.asset;
        if (typeof value === 'string' && value) value = await host.assets.get(value);
        // The file decides the kind, so a dropped model is never read as artwork, and a
        // blank name takes the file name.
        const patched = { ...row };
        if (value && typeof value === 'object') {
          const kind = value.type === 'model' ? 'model' : value.type === 'vector' ? 'artwork' : null;
          if (kind && row.kind !== kind && row.kind !== 'primitive') patched.kind = kind;
          if (blank(row.name)) {
            const label = String(value.meta?.name || value.name || value.id || '');
            patched.name = label.replace(/^.*\//, '').replace(/^[0-9a-f-]{36}-/i, '').replace(/\.[a-z0-9]+$/i, '').slice(0, 120);
          }
          if (patched.kind !== row.kind || patched.name !== row.name) normalizeRows = true;
        }
        if (blank(patched.name) && row.kind === 'text' && !blank(row.text)) {
          patched.name = String(row.text).split('\n')[0].trim().slice(0, 40);
          normalizeRows = true;
        }
        rows[index] = { ...patched, asset: value };
        row = patched;
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
    if (normalizeRows) patch[key] = rows;
  }
  return {
    ...patch,
    _studioState: JSON.stringify({ version: 1, values: values }),
    _expert: values.controls === 'expert' || values.materialMode === 'custom',
    _collection: values.source === 'collection',
    _arrangement: values.source === 'arrangement',
    _cameraKeys: Array.isArray(values.cameraKeys) ? values.cameraKeys.length : 0,
    _cameraPlays:
      values.cameraMotion === 'keys' &&
      Array.isArray(values.cameraKeys) &&
      values.cameraKeys.length >= 2,
    _clipMs:
      values.motion === 'turntable' ||
      (values.lightMotion && values.lightMotion !== 'still') ||
      (values.cameraMotion === 'keys' &&
        Array.isArray(values.cameraKeys) &&
        values.cameraKeys.length >= 2)
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
