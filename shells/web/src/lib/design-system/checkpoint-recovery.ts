// SPDX-License-Identifier: MPL-2.0
import { mountModal, type ModalHandle } from '../../components/modal.ts';
import { tRaw } from '../../i18n.ts';
import type { StudioState } from './studio-state.ts';

/** Recover token settings through the studio's existing checkpoint store. */
export function mountCheckpointRecovery(studio: StudioState, refresh: () => Promise<void>): ModalHandle<void> {
  const title = tRaw('Restore brand settings');
  const modal = mountModal('', { className: 'modal', ariaLabel: title });
  const heading = document.createElement('h2');
  heading.className = 'modal-title';
  heading.textContent = title;
  const description = document.createElement('p');
  description.className = 'modal-msg';
  description.textContent = tRaw('Choose a checkpoint to restore your colours, type settings and other brand tokens. Your current settings are saved first. Font and image files are kept as they are.');
  const label = document.createElement('label');
  label.textContent = tRaw('Checkpoint');
  const select = document.createElement('select');
  select.className = 'be-input';
  label.append(select);
  const status = document.createElement('p');
  status.className = 'modal-msg';
  status.setAttribute('role', 'status');
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn';
  retry.textContent = tRaw('Try again');
  retry.hidden = true;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = tRaw('Close');
  const restore = document.createElement('button');
  restore.type = 'button';
  restore.className = 'btn modal-primary';
  restore.textContent = tRaw('Restore');
  restore.disabled = true;
  actions.append(retry, cancel, restore);
  modal.el.append(heading, description, label, status, actions);
  cancel.focus();
  let busy = false;

  async function load(): Promise<void> {
    retry.hidden = true;
    restore.disabled = true;
    select.disabled = true;
    status.textContent = tRaw('Loading…');
    try {
      const checkpoints = await studio.listCheckpoints();
      if (!modal.el.isConnected) return;
      select.replaceChildren(...checkpoints.reverse().map(checkpoint => {
        const option = document.createElement('option');
        option.value = checkpoint.id;
        const date = new Date(checkpoint.date);
        option.textContent = `${checkpoint.label} · ${Number.isNaN(date.getTime()) ? checkpoint.date : date.toLocaleString()}`;
        return option;
      }));
      select.disabled = restore.disabled = !checkpoints.length;
      status.textContent = checkpoints.length ? '' : tRaw('No checkpoints yet. Lolly saves one before an import or a change that replaces brand settings.');
    } catch {
      if (!modal.el.isConnected) return;
      status.textContent = tRaw('Could not load checkpoints. Try again.');
      retry.hidden = false;
    }
  }

  restore.addEventListener('click', async () => {
    if (busy || !select.value) return;
    busy = true;
    restore.disabled = select.disabled = true;
    const id = select.value;
    status.textContent = tRaw('Restoring…');
    try {
      await studio.load();
      if (!await studio.restoreCheckpoint(id, tRaw('Before restore'))) throw new Error('Checkpoint unavailable');
      try { await refresh(); }
      catch {
        if (modal.el.isConnected) status.textContent = tRaw('Brand settings restored. Reopen Make it yours to refresh the view.');
        return;
      }
      if (!modal.el.isConnected) return;
      await load();
      status.textContent = tRaw('Brand settings restored. To reverse this, restore “Before restore”.');
    } catch {
      if (modal.el.isConnected) status.textContent = tRaw('Could not restore this checkpoint. Your saved checkpoints are kept. Try again.');
    } finally {
      busy = false;
      select.disabled = restore.disabled = !select.options.length;
    }
  });
  retry.addEventListener('click', () => { void load(); });
  cancel.addEventListener('click', () => modal.close());
  void load();
  return modal;
}
