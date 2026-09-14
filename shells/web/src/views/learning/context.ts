// SPDX-License-Identifier: MPL-2.0
import type {
  LearningBlock,
  LearningModule,
  LearningRelease,
  LearningTarget,
} from '@lolly-tools/core/learning-v1';
import type { CompiledLearning } from '../../../../../engine/src/learning/compile.ts';
import type { LearningRendition } from '../../../../../engine/src/learning/delivery.ts';
import type { PickerHost } from '../picker.ts';
import type { ModalHandle } from '../../components/modal.ts';

export interface SourceDisplay {
  name: string;
  preview?: string;
  media?: string;
  detail?: string;
  unavailable?: boolean;
}

export interface LearningCtx {
  root: HTMLElement;
  host: PickerHost;
  slot: string;
  module: LearningModule;
  releases: LearningRelease[];
  undo: LearningModule[];
  lastEdit: LearningModule;
  selected: string;
  selectedBlocks: Set<string>;
  flushTyping(): Promise<void>;
  insertAfter?: string;
  richText: { mount(): void; destroy(): void; flush(): void; pending(): boolean; editable(): void };
  quizzes: { change(el: HTMLElement): boolean; action(action: string, id?: string): boolean };
  target: LearningTarget;
  exportSettings: { destination: string; maxMB: number };
  sourceChoices: Record<string, LearningRendition[]>;
  sourceDisplay: Record<string, SourceDisplay>;
  checking: boolean;
  delivery: { open(releaseId?: string): void; close(): void; invalidate(): void };
  busy: boolean;
  disposed: boolean;
  dirty: boolean;
  pendingTyping: boolean;
  savedRevision: number;
  saving: Promise<void>;
  previewUrls: string[];
  preview: CompiledLearning | null;
  previewModal?: ModalHandle<void>;
  ui: { render(focus?: string): void; checks(): void; status(message: string): void };
  edit: {
    insert(block: LearningBlock): void;
    moveBlocks(lessonId: string): void;
    change(): void;
    addLesson(): void;
    action(action: string, id?: string): Promise<void>;
  };
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
    download(id: string, owner?: HTMLElement, surface?: HTMLElement): Promise<void>;
    closePreview(): void;
  };
  persistence: { save(): Promise<void> };
}
