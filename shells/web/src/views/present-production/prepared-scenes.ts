// SPDX-License-Identifier: MPL-2.0
import { t } from '../../i18n.ts';
import { MAX_PREPARED_SCENES, readScene, readSceneSettings, type PresentationScene, type PreparedScene } from './scene.ts';

/** Saving a recipe does not take it to the audience or open any media source. */
export function mountPreparedScenes(doc: Document, host: HTMLElement, api: {
  read(): PresentationScene;
  ready(): boolean;
  prepare(scene: PresentationScene): void;
  save(scenes: PreparedScene[]): void;
  status(message: string): void;
}) {
  const root = doc.createElement('details'); root.className = 'pr-production-section';
  const summary = doc.createElement('summary'); summary.textContent = t('Saved scenes');
  const body = doc.createElement('div'); body.className = 'pr-production-fields'; root.append(summary, body);
  const choice = doc.createElement('select'); choice.setAttribute('aria-label', t('Saved scene'));
  const name = doc.createElement('input'); name.type = 'text'; name.maxLength = 40; name.setAttribute('aria-label', t('Scene name'));
  for (const [title, input] of [[t('Scene'), choice], [t('Scene name'), name]] as const) {
    const label = doc.createElement('label'); label.textContent = title; label.append(input); body.append(label);
  }
  const save = doc.createElement('button'); save.type = 'button'; save.className = 'btn btn--ghost'; save.textContent = t('Save scene');
  const remove = doc.createElement('button'); remove.type = 'button'; remove.className = 'btn btn--ghost'; remove.textContent = t('Delete scene');
  body.append(save, remove); host.append(root);
  function refresh(selected = ''): void {
    choice.replaceChildren();
    const empty = doc.createElement('option'); empty.value = ''; empty.textContent = t('New scene'); choice.append(empty);
    for (const item of api.read().prepared) {
      const option = doc.createElement('option'); option.value = item.id; option.textContent = item.name; choice.append(option);
    }
    choice.value = selected; remove.disabled = !selected;
  }
  choice.addEventListener('change', () => {
    const current = api.read(), item = current.prepared.find(scene => scene.id === choice.value);
    name.value = item?.name ?? ''; remove.disabled = !item;
    if (item) { api.prepare(readScene({ ...item.scene, prepared: current.prepared })); api.status(t('Scene prepared. Apply to show it.')); }
  });
  save.addEventListener('click', () => {
    if (!api.ready()) { api.status(t('Wait for the logo to finish loading.')); return; }
    const current = api.read(), title = name.value.trim();
    if (!title) { name.focus(); api.status(t('Give this scene a name.')); return; }
    if (!choice.value && current.prepared.length >= MAX_PREPARED_SCENES) { api.status(t('You can save up to eight scenes. Delete one to add another.')); return; }
    let ordinal = 1; while (current.prepared.some(item => item.id === `scene-${ordinal}`)) ordinal++;
    const id = choice.value || `scene-${ordinal}`, saved = { id, name: title, scene: readSceneSettings(current) };
    const items = current.prepared.some(item => item.id === id)
      ? current.prepared.map(item => item.id === id ? saved : item) : [...current.prepared, saved];
    api.save(items); api.prepare(readScene({ ...current, prepared: items })); refresh(id);
    api.status(t('Scene saved. Apply to show it.'));
  });
  remove.addEventListener('click', () => {
    const current = api.read(), items = current.prepared.filter(item => item.id !== choice.value);
    api.save(items); api.prepare(readScene({ ...current, prepared: items })); name.value = ''; refresh();
    api.status(t('Saved scene deleted. The audience is unchanged.'));
  });
  refresh();
  return () => root.remove();
}
