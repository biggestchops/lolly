// SPDX-License-Identifier: MPL-2.0
import { Editor, Extension, type JSONContent } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Plugin } from '@tiptap/pm/state';
import type { LearningRichNode } from '@lolly-tools/core/learning-v1';
import type { LearningCtx } from './context.ts';
import {
  validLearningRichText,
  learningRichTextPlain,
  learningLinkAllowed,
} from '../../../../../engine/src/learning/authoring.ts';
import { mountModal, type ModalHandle } from '../../components/modal.ts';
import { escape as esc } from '../../utils.ts';

function documentValue(node: JSONContent): LearningRichNode {
  return {
    type: node.type as LearningRichNode['type'],
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(node.type === 'heading' ? { attrs: { level: node.attrs?.level } } : {}),
    ...(node.type === 'orderedList' ? { attrs: { start: node.attrs?.start || 1 } } : {}),
    ...(node.marks
      ? {
          marks: node.marks.map((mark) => ({
            type: mark.type as NonNullable<LearningRichNode['marks']>[number]['type'],
            ...(mark.type === 'link' ? { attrs: { href: String(mark.attrs?.href || '') } } : {}),
          })),
        }
      : {}),
    ...(node.content ? { content: node.content.map(documentValue) } : {}),
  };
}

export function richTextOps(ctx: LearningCtx): LearningCtx['richText'] {
  const editors = new Map<string, Editor>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let dialog: ModalHandle<void> | undefined;
  const flush = () => {
    clearTimeout(timer);
    if (!pending) return;
    pending = false;
    ctx.edit.change();
    ctx.ui.checks();
  };
  const destroy = () => {
    flush();
    dialog?.close();
    for (const editor of editors.values()) editor.destroy();
    editors.clear();
  };
  return {
    flush,
    destroy,
    pending: () => pending,
    editable: () => {
      for (const editor of editors.values())
        if (editor.isEditable === ctx.busy) editor.setEditable(!ctx.busy, false);
    },
    mount: () => {
      for (const block of ctx.module.lessons.find((l) => l.id === ctx.selected)?.blocks || []) {
        if (block.kind !== 'text') continue;
        const holder = ctx.root.querySelector<HTMLElement>(
          `[data-rich-text="${CSS.escape(block.id)}"]`
        );
        if (!holder) continue;
        const toolbar = holder.previousElementSibling as HTMLElement;
        const constraints = Extension.create({
          name: 'learningDocumentLimits',
          addProseMirrorPlugins: () => [
            new Plugin({
              filterTransaction: (tr) => {
                if (!tr.docChanged || validLearningRichText(documentValue(tr.doc.toJSON())))
                  return true;
                ctx.ui.status(
                  'This text is too large or too deeply nested. Add it in smaller sections.'
                );
                return false;
              },
            }),
          ],
        });
        const editor = new Editor({
          element: holder,
          extensions: [
            StarterKit.configure({
              heading: { levels: [2, 3] },
              strike: false,
              codeBlock: false,
              horizontalRule: false,
              link: { openOnClick: false, autolink: false, isAllowedUri: learningLinkAllowed },
            }),
            Placeholder.configure({
              placeholder: 'Write your explanation. Select text to format it.',
            }),
            constraints,
          ],
          content: block.richText || {
            type: 'doc',
            content: (block.text || '').split('\n').map((text) => ({
              type: 'paragraph',
              ...(text ? { content: [{ type: 'text', text }] } : {}),
            })),
          },
          editorProps: {
            attributes: {
              'aria-label': 'Lesson text',
              'aria-multiline': 'true',
              'data-block-field': 'text',
              role: 'textbox',
            },
            handleKeyDown: (_view, event) => {
              if (event.altKey && event.key === 'F10') {
                toolbar.querySelector<HTMLElement>('select,button')?.focus();
                return true;
              }
              return false;
            },
          },
          onUpdate: ({ editor: active }) => {
            block.richText = documentValue(active.getJSON());
            block.text = learningRichTextPlain(block.richText);
            ctx.module.schemaVersion = 2;
            pending = true;
            ctx.ui.status('Saving changes...');
            clearTimeout(timer);
            timer = setTimeout(flush, 500);
          },
        });
        editors.set(block.id, editor);
        const updateToolbar = () => {
          for (const control of toolbar.querySelectorAll<HTMLButtonElement>('[data-format]'))
            control.setAttribute('aria-pressed', String(editor.isActive(control.dataset.format!)));
          const select = toolbar.querySelector<HTMLSelectElement>('select')!;
          select.value = editor.isActive('heading', { level: 2 })
            ? '2'
            : editor.isActive('heading', { level: 3 })
              ? '3'
              : 'paragraph';
        };
        editor.on('selectionUpdate', updateToolbar);
        editor.on('transaction', updateToolbar);
        updateToolbar();
        toolbar.addEventListener('mousedown', (event) => {
          if ((event.target as Element).closest('button')) event.preventDefault();
        });
        toolbar.querySelector('select')!.addEventListener('change', (event) => {
          const value = (event.target as HTMLSelectElement).value;
          if (value === 'paragraph') editor.chain().focus().setParagraph().run();
          else
            editor
              .chain()
              .focus()
              .setHeading({ level: Number(value) as 2 | 3 })
              .run();
        });
        toolbar.addEventListener('click', (event) => {
          const control = (event.target as Element).closest<HTMLButtonElement>('[data-format]');
          if (!control || ctx.busy) return;
          const chain = editor.chain().focus();
          switch (control.dataset.format) {
            case 'bold':
              chain.toggleBold().run();
              break;
            case 'italic':
              chain.toggleItalic().run();
              break;
            case 'underline':
              chain.toggleUnderline().run();
              break;
            case 'bulletList':
              chain.toggleBulletList().run();
              break;
            case 'orderedList':
              chain.toggleOrderedList().run();
              break;
            case 'blockquote':
              chain.toggleBlockquote().run();
              break;
            case 'link': {
              const href = editor.getAttributes('link').href || '';
              dialog = mountModal(
                `<form class="learning-link-form"><h2>${href ? 'Edit link' : 'Add link'}</h2><label>Link address<input class="field-input" name="href" value="${esc(href)}" placeholder="https://example.com" required></label><p class="learning-hint">Use a website or email address. Links open in a new tab.</p><p data-link-error role="status"></p><div class="learning-toolbar"><button class="btn btn--ghost" type="button" data-link-cancel>Cancel</button>${href ? '<button class="btn btn--ghost" type="button" data-link-remove>Remove link</button>' : ''}<button class="btn btn--primary" type="submit">Save link</button></div></form>`,
                {
                  className: 'learning-ui learning-small-modal',
                  ariaLabel: 'Text link',
                  initialFocus: (el) => el.querySelector('input'),
                }
              );
              const current = dialog;
              current.el.querySelector('input')!.addEventListener('input', () => {
                current.el.querySelector('[data-link-error]')!.textContent = '';
              });
              current.el
                .querySelector('[data-link-cancel]')!
                .addEventListener('click', () => current.close());
              current.el.querySelector('[data-link-remove]')?.addEventListener('click', () => {
                current.close();
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
              });
              current.el.querySelector('form')!.addEventListener('submit', (e) => {
                e.preventDefault();
                const value = current.el.querySelector('input')!.value.trim();
                if (!learningLinkAllowed(value)) {
                  current.el.querySelector('[data-link-error]')!.textContent =
                    'Enter a full https://, http:// or mailto: address.';
                  return;
                }
                current.close();
                editor.chain().focus().extendMarkRange('link').setLink({ href: value }).run();
              });
              break;
            }
          }
        });
      }
    },
  };
}
