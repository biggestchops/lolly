// SPDX-License-Identifier: MPL-2.0
import { strToU8, zipSync } from 'fflate';
import type { LearningTarget } from '@lolly-tools/core/learning-v1';
import type { CompiledLearning } from '../../../engine/src/learning/compile.ts';
import { learningPath } from '../../../engine/src/learning/module.ts';
import { learningHandoff } from '../../../engine/src/learning/preflight.ts';
import { scormManifest } from '../../../engine/src/scorm.ts';
import {
  learningPlayerCss,
  learningPlayerHtml,
  learningPlayerJs,
  LEARNING_PLAYER_VERSION,
} from './bundle.ts';

const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!
  );

/** One content snapshot produces separate, explicitly selected LMS artifacts. */
export function buildLearningPackage(
  compiled: CompiledLearning,
  target: LearningTarget
): Uint8Array {
  if (!['static', 'scorm12', 'scorm2004', 'tincan', 'cmi5'].includes(target))
    throw new Error('Unsupported learning package target.');
  const { content } = compiled;
  const files: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(compiled.files)) {
    learningPath(path);
    if (!path.startsWith('media/')) throw new Error('Content files must be inside media/.');
    files[path] = bytes;
  }
  for (const lesson of content.lessons)
    for (const block of lesson.blocks)
      for (const file of [
        ...(block.files || []),
        ...(block.captionFile ? [block.captionFile] : []),
      ]) {
        if (!files[learningPath(file.path)] || files[file.path]!.length !== file.size)
          throw new Error(`Missing or changed package file: ${file.path}`);
      }
  files['index.html'] = strToU8(learningPlayerHtml(content.title, content.language));
  files['player.css'] = strToU8(learningPlayerCss);
  files['player.js'] = strToU8(learningPlayerJs(content, target));
  files['content.json'] = strToU8(JSON.stringify(content));
  files['release.json'] = strToU8(
    JSON.stringify({
      moduleId: content.moduleId,
      releaseId: content.releaseId,
      target,
      playerVersion: LEARNING_PLAYER_VERSION,
    })
  );
  files['HANDOFF.txt'] = strToU8(learningHandoff(target));
  const activity = xml(`urn:lolly:learning:${content.moduleId}`);
  const title = xml(content.title),
    description = xml(content.description),
    lang = xml(content.language);
  if (target === 'static') {
    files['README.txt'] = strToU8(
      'Upload these extracted files to a static HTTP(S) website, keeping their paths together. Open index.html. No Lolly server or learner account is required. Progress is stored per course version in this browser. Clearing site data removes it; shared browser profiles share it. Browser storage restrictions may limit progress to the open page. This is not a verified learning record. The lolly:learning-progress window event is a same-origin observation contract, version 1. It contains moduleId, releaseId, lessonId, acknowledged, completed and persistence. It contains no learner identity and sends nothing to a server. A future integration must supply its own identity, consent, authorization and durable storage.'
    );
  } else if (target === 'scorm12' || target === 'scorm2004') {
    // Schema locations are optional; never advertise absent local schema files.
    files['imsmanifest.xml'] = strToU8(
      scormManifest(target === 'scorm12' ? '1.2' : '2004', {
        title: content.title,
        identifier: `lolly-${content.moduleId}`,
        version: content.releaseId,
        files: Object.keys(files),
      }).replace(/\s+xsi:schemaLocation="[^"]*"/, '')
    );
  } else if (target === 'tincan') {
    files['tincan.xml'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><tincan xmlns="http://projecttincan.com/tincan.xsd"><activities><activity id="${activity}" type="http://adlnet.gov/expapi/activities/course"><name xml:lang="${lang}">${title}</name><description xml:lang="${lang}">${description}</description><launch xml:lang="${lang}">index.html</launch></activity></activities></tincan>`
    );
  } else {
    files['cmi5.xml'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd"><course id="${activity}:course"><title><langstring lang="${lang}">${title}</langstring></title><description><langstring lang="${lang}">${description}</langstring></description></course><au id="${activity}" launchMethod="AnyWindow" moveOn="Completed"><title><langstring lang="${lang}">${title}</langstring></title><description><langstring lang="${lang}">${description}</langstring></description><url>index.html</url></au></courseStructure>`
    );
  }
  return zipSync(
    Object.fromEntries(
      Object.entries(files)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, bytes]) => [path, [bytes, { mtime: new Date('1980-01-01T00:00:00Z') }]])
    ),
    { level: 6 }
  );
}
