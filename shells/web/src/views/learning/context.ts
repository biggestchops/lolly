// SPDX-License-Identifier: MPL-2.0
import type {
  LearningModule,
  LearningRelease,
  LearningTarget,
} from '@lolly-tools/core/learning-v1';
import type { CompiledLearning } from '../../../../../engine/src/learning/compile.ts';
import type { LearningRendition } from '../../../../../engine/src/learning/delivery.ts';
import type { PickerHost } from '../picker.ts';

export interface LearningCtx {
  root: HTMLElement;
  host: PickerHost;
  slot: string;
  module: LearningModule;
  releases: LearningRelease[];
  undo: LearningModule[];
  lastEdit: LearningModule;
  selected: string;
  target: LearningTarget;
  exportSettings: { destination: string; maxMB: number };
  sourceChoices: Record<string, LearningRendition[]>;
  checking: boolean;
  delivery: { open(releaseId?: string): void; close(): void; invalidate(): void };
  busy: boolean;
  disposed: boolean;
  dirty: boolean;
  savedRevision: number;
  saving: Promise<void>;
  previewUrls: string[];
  preview: CompiledLearning | null;
  ui: { render(): void; checks(): void; status(message: string): void };
  edit: { change(): void; addLesson(): void; action(action: string, id?: string): Promise<void> };
  sources: {
    pick(): Promise<void>;
    inspect(): Promise<void>;
    refresh(blockId: string): Promise<void>;
    edit(blockId: string): Promise<void>;
  };
  publishing: {
    preview(): Promise<void>;
    build(): Promise<void>;
    variant(id: string): Promise<void>;
    download(id: string): Promise<void>;
    closePreview(): void;
  };
  persistence: { save(): Promise<void> };
}
