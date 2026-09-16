// SPDX-License-Identifier: MPL-2.0
/** Render a reviewed portable tool through the ordinary browser shell and strict worker. */
import { readFile, writeFile } from 'node:fs/promises';
import { readLollyFile, bundledToolFiles } from '@lolly-tools/node-shell/lolly-file';
import { renderToolPackageViaWebShell, closeWebShell } from '@lolly-tools/node-shell/webshell-render';
import { closeBrowser } from '@lolly-tools/node-shell/browsers';
import { loadTool, parseUrlState } from '@lolly/engine';
import { assertDesignValues, designExportSize } from '../../../engine/src/design-tool/policy.ts';
import { writeOut } from './output.ts';
import { usageError } from './exit-codes.ts';

export async function runDesignToolPackage(path: string, flags: Record<string,string>): Promise<void> {
  const bytes = new Uint8Array(await readFile(path));
  const contents = readLollyFile(bytes, {allowTool:true});
  if (contents.manifest.kind !== 'tool') throw usageError('Choose a reusable tool .lolly file.', 'BAD_INPUT');
  const files = bundledToolFiles(contents)!; const id = contents.manifest.tool.id;
  const tool = await loadTool(id, async file => {
    const bytes = files.get(file.slice(id.length + 1)); if (!bytes) throw new Error(`Missing tool file: ${file}`); return new TextDecoder().decode(bytes);
  }, {trustClass:'sideloaded-consented'});
  if (!tool.manifest.designTool) throw usageError('This command supports tools made with Share with rules.', 'BAD_INPUT');
  if (!['1','true','on'].includes(flags['trust-tool'] || '')) throw usageError(`Review ${tool.manifest.name} ${tool.manifest.version}, then add --trust-tool to run its packaged hooks in the isolated reader.`, 'TRUST_REQUIRED');
  const {output,export:format='png','trust-tool':_trust,quiet:_quiet,verbose:_verbose,strict:_strict,...values} = flags;
  const query = new URLSearchParams(values).toString();
  const parsed = parseUrlState(query,tool.manifest);
  assertDesignValues(tool.manifest.designTool,parsed.values,true);
  designExportSize(tool.manifest.designTool,parsed.values,format);
  for (const key of Object.keys(values)) if (!tool.manifest.inputs.some(i => i.id === key || i.urlKey === key || i.type === 'vector' && i.fields?.some(f => `${i.id}.${f.id}` === key)) && !['format','width','height','unit','dpi','c2pa','imprint','text','password','bleed','marks'].includes(key)) throw usageError(`Unknown tool input: ${key}`, 'UNKNOWN_FLAG');
  try {
    const rendered = await renderToolPackageViaWebShell(bytes,id,query,format);
    if (output) await writeFile(output,rendered); else await writeOut(Buffer.from(rendered));
  } finally { await closeBrowser(); await closeWebShell(); }
}
