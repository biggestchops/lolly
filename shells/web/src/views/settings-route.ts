// SPDX-License-Identifier: MPL-2.0
import { DASH_SECTIONS } from '../lib/dashboard-registry.ts';

/** Keep both existing renderers behind the same Settings destination. */
export function settingsRoute(params = ''): { name: 'profile' | 'dashboard'; params: string } {
  const query = new URLSearchParams(params);
  const dashboard = !query.get('focus') && DASH_SECTIONS.some(section =>
    section.flag
      ? [section.id, ...section.flag.split(' ')].some(flag => query.has(flag))
      : section.tab === query.get('tab'),
  );
  return { name: dashboard ? 'dashboard' : 'profile', params };
}
