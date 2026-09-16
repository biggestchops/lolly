// SPDX-License-Identifier: MPL-2.0
/**
 * pack-project - build a project `.lolly` (a folder of saved sessions) from a JSON spec.
 *
 * The file is the one the Projects view writes with "Download project (.lolly)" and
 * opens back into a folder: same builder (shells/web/src/lib/lolly-pack.ts), same
 * checks. This is the headless way in, for a person or an agent that has produced a
 * set of tool states and wants to hand them over as one remixable folder.
 *
 * Usage:
 *   node scripts/pack-project.ts project.json --output=project.lolly
 *
 * The spec:
 *   {
 *     "name": "gartner-data",
 *     "sessions": [
 *       { "key": "q0001", "toolId": "chart", "label": "q0001 Using AI",
 *         "values": { "chartType": "bar-horizontal", "data": "..." },
 *         "thumb": "thumbs/q0001.png" }
 *     ],
 *     "folders": [ ... ]            // optional
 *   }
 *
 * `values` are the tool's input values by input id, as a saved session holds them;
 * `__`-prefixed markers (`__export_format`, ...) pass through. `thumb` is a PNG, JPEG,
 * WebP or SVG path relative to the spec, or a data URL. Without `folders`, every
 * session is filed, in order, in one folder named after the project. With `folders`,
 * each is `{ id, name, parentId, items: [{ type: "session", ref: <key> }] }`.
 *
 * Tool ids and input ids are checked against the active profile (LOLLY_PROFILE): an
 * unknown tool or input is reported, because a value under a name the tool does not
 * declare is silently ignored when the session opens. Uploaded files are not packed
 * here; a session that needs one should be packed from the app.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_VERSION } from '../engine/src/version.ts';
import { bytesToBin } from '../engine/src/bytes.ts';
import { readToolManifestText } from '../packages/node-shell/src/content-roots.ts';
import {
  buildLollyFile, readLollyFile, projectShapeProblem, LOLLY_PROJECT_TOOL_ID,
  type LollyProjectFolder, type LollyProjectInput,
} from '../shells/web/src/lib/lolly-pack.ts';

export interface ProjectSpecSession {
  key: string;
  toolId: string;
  label?: string;
  values: Record<string, unknown>;
  thumb?: string;
}

export interface ProjectSpec {
  name: string;
  sessions: ProjectSpecSession[];
  folders?: LollyProjectFolder[];
}

const THUMB_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

/** What a tool declares, for the checks: its version and input ids. Null when the
 *  active profile has no such tool. */
export type ToolLookup = (id: string) => { version?: string; inputs: string[] } | null;

export function profileTools(): ToolLookup {
  return (id) => {
    try {
      const manifest = JSON.parse(readToolManifestText(id)) as { version?: string; inputs?: Array<{ id: string }> };
      return { version: manifest.version, inputs: (manifest.inputs ?? []).map(i => i.id) };
    } catch {
      return null;
    }
  };
}

/**
 * The spec as builder input, plus the problems worth telling the author about. Pure:
 * `readThumb` supplies thumbnail bytes and `lookup` the tool manifests, so a test can
 * drive it without a checkout.
 */
export function specToProject(spec: ProjectSpec, lookup: ToolLookup, readThumb: (ref: string) => string | null): { project: LollyProjectInput; warnings: string[] } {
  const warnings: string[] = [];
  if (!spec || !Array.isArray(spec.sessions)) throw new Error('The spec needs a "sessions" array.');
  const sessions = spec.sessions.map((s) => {
    const tool = lookup(s.toolId);
    if (!tool) warnings.push(`${s.key}: the active profile has no tool "${s.toolId}"; the session is packed but opens only where that tool is installed.`);
    const unknown = tool ? Object.keys(s.values ?? {}).filter(k => !k.startsWith('__') && !tool.inputs.includes(k)) : [];
    if (unknown.length) warnings.push(`${s.key}: ${s.toolId} declares no input named ${unknown.map(k => `"${k}"`).join(', ')}; those values would be ignored.`);
    const label = s.label ?? (typeof s.values?.__label === 'string' ? s.values.__label : undefined);
    const thumb = s.thumb ? readThumb(s.thumb) : null;
    if (s.thumb && !thumb) warnings.push(`${s.key}: the thumbnail "${s.thumb}" could not be read; the session is packed without one.`);
    return {
      key: s.key, toolId: s.toolId,
      ...(tool?.version ? { toolVersion: tool.version } : {}),
      ...(label ? { label } : {}),
      data: {
        ...s.values,
        __toolId: s.toolId,
        ...(tool?.version ? { __toolVersion: tool.version } : {}),
        ...(label ? { __label: label } : {}),
      },
      ...(thumb ? { thumb } : {}),
    };
  });
  const folders: LollyProjectFolder[] = spec.folders ?? [{
    id: 'project', name: spec.name, parentId: null,
    items: sessions.map(s => ({ type: 'session' as const, ref: s.key })),
  }];
  const problem = projectShapeProblem(spec.name, folders, sessions);
  if (problem) throw new Error(problem);
  return { project: { name: spec.name, folders, sessions }, warnings };
}

function thumbReader(base: string): (ref: string) => string | null {
  return (ref) => {
    if (ref.startsWith('data:')) return ref;
    const type = THUMB_TYPES[extname(ref).toLowerCase()];
    if (!type) return null;
    try {
      return `data:${type};base64,${btoa(bytesToBin(new Uint8Array(readFileSync(resolve(base, ref)))))}`;
    } catch {
      return null;
    }
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const specPath = args.find(a => !a.startsWith('--'));
  const output = args.find(a => a.startsWith('--output='))?.slice('--output='.length);
  if (!specPath) {
    process.stderr.write('Usage: node scripts/pack-project.ts <project.json> [--output=<file.lolly>]\n');
    process.exit(2);
  }
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as ProjectSpec;
  const { project, warnings } = specToProject(spec, profileTools(), thumbReader(dirname(resolve(specPath))));
  for (const w of warnings) process.stderr.write(`warning: ${w}\n`);
  const built = await buildLollyFile({
    kind: 'project', toolId: LOLLY_PROJECT_TOOL_ID, session: null, name: project.name, project,
    userAssets: [], appVersion: `Lolly ${ENGINE_VERSION}`, engineVersion: ENGINE_VERSION,
    creator: { createdWith: `Lolly ${ENGINE_VERSION}`, createdAt: new Date().toISOString() },
  });
  const bytes = new Uint8Array(await built.blob.arrayBuffer());
  // Read it back through the same reader the app uses before calling it done.
  const read = await readLollyFile(bytes);
  const out = resolve(output ?? built.filename);
  writeFileSync(out, bytes);
  process.stdout.write(`Wrote ${out}: ${read.project!.sessions.length} sessions in ${read.project!.folders.length} folder(s), ${bytes.length} bytes.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    process.stderr.write(`pack-project: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
