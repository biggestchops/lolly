// SPDX-License-Identifier: MPL-2.0
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { LearningTarget } from '@lolly-tools/core/learning-v1';
import { parseLearningModule, checkLearningModule } from '../../../engine/src/learning/module.ts';
import { compileLearningModule } from '../../../engine/src/learning/compile.ts';
import { buildLearningPackage } from '../../../packages/learning-player/src/package.ts';
import { emitResult } from './envelope.ts';
import { usageError } from './exit-codes.ts';
import { note, writeOut } from './output.ts';

const mimes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  txt: 'text/plain',
};
/** Local file packaging uses the same compiler and player as the web shell. */
export async function learningCli(
  args: string[],
  flags: Record<string, string>,
  json: boolean
): Promise<void> {
  const [action, input] = args;
  if (!input || !['check', 'build'].includes(action || ''))
    throw usageError(
      'Usage: lolly learning check module.json | lolly learning build module.json --format=scorm12 --output=course.zip'
    );
  const module = parseLearningModule(JSON.parse(await readFile(input, 'utf8')));
  const findings = checkLearningModule(module);
  if (action === 'check') {
    if (json)
      await emitResult(
        { moduleId: module.id, findings },
        findings.some((f) => f.severity === 'error') ? 2 : 0
      );
    else
      await writeOut(
        findings.map((f) => `${f.severity}: ${f.message}`).join('\n') +
          (findings.length ? '\n' : 'Module structure is ready.\n')
      );
    if (findings.some((f) => f.severity === 'error')) process.exitCode = 2;
    return;
  }
  const target = flags.format || 'scorm12';
  if (!['static', 'scorm12', 'scorm2004', 'tincan', 'cmi5'].includes(target) || !flags.output)
    throw usageError(
      'Choose --format=static|scorm12|scorm2004|tincan|cmi5 and --output=course.zip.'
    );
  const root = await realpath(dirname(resolve(input)));
  const compiled = await compileLearningModule(
    module,
    randomUUID(),
    async (block) => {
      const asset = block.source?.asset;
      if (block.source?.kind !== 'asset' || !asset)
        throw usageError(
          'For a CLI build, export saved tool sources as local media first and reference their relative file paths in source.asset.url.'
        );
      if (!asset.url || isAbsolute(asset.url) || /^[a-z]+:/i.test(asset.url))
        throw usageError(
          'Learning assets must use relative local paths beside the module document.'
        );
      const path = await realpath(resolve(root, asset.url));
      const inside = relative(root, path);
      if (inside.startsWith('..') || isAbsolute(inside))
        throw usageError('A learning asset resolves outside the module directory.');
      const mime = mimes[asset.format];
      if (!mime) throw usageError(`Unsupported learning asset format: ${asset.format}`);
      return [{ bytes: await readFile(path), mime }];
    },
    async (bytes) => createHash('sha256').update(bytes).digest('hex'),
    note
  );
  const bytes = buildLearningPackage(compiled, target as LearningTarget);
  await writeFile(flags.output, bytes, { flag: 'wx' });
  const result = {
    output: flags.output,
    releaseId: compiled.content.releaseId,
    target,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  if (json) await emitResult(result);
  else
    await writeOut(
      `Created ${result.output} (${result.bytes} bytes). ${target === 'static' ? 'Upload the extracted files to your website and test the course.' : 'Test this version in your LMS before assigning learners.'}\n`
    );
}
