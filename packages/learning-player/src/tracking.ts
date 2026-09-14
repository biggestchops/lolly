// SPDX-License-Identifier: MPL-2.0
export interface LearningTracking {
  read(): Promise<string>;
  save(state: string, completed: boolean, location: string): Promise<void>;
  finish(): Promise<void>;
  readOnly: boolean;
  persistence?: 'browser' | 'session';
}

/** This factory is embedded in the package without authoring dependencies. */
export async function createLearningTracking(
  w: Window,
  target: string,
  activity: string,
  releaseId = ''
): Promise<LearningTracking> {
  if (target === 'preview') {
    let state = '';
    return {
      read: async () => state,
      save: async (v) => {
        state = v;
      },
      finish: async () => {},
      readOnly: false,
    };
  }
  if (target === 'static') {
    let memory = '';
    let db: IDBDatabase;
    try {
      db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = w.indexedDB.open('lolly-learning-progress', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('attempts');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Browser progress storage is busy.'));
      });
    } catch {
      return {
        read: async () => memory,
        save: async (v) => {
          memory = v;
        },
        finish: async () => {},
        readOnly: false,
        persistence: 'session',
      };
    }
    const key = JSON.stringify([w.location.pathname, activity, releaseId]);
    let observed: string | undefined;
    const operation = (value?: string) =>
      new Promise<string>((resolve, reject) => {
        const tx = db.transaction('attempts', value === undefined ? 'readonly' : 'readwrite');
        const store = tx.objectStore('attempts');
        const request = store.get(key);
        let result = '';
        let conflict = false;
        request.onsuccess = () => {
          result = typeof request.result === 'string' ? request.result : '';
          if (value !== undefined) {
            if (observed !== undefined && observed !== result) {
              conflict = true;
              tx.abort();
              return;
            }
            store.put(value, key);
            result = value;
          }
        };
        tx.oncomplete = () => {
          observed = result;
          resolve(result);
        };
        tx.onerror = tx.onabort = () =>
          reject(
            new Error(
              conflict
                ? 'Progress changed in another tab. Reload this course before continuing.'
                : 'Progress could not be saved in this browser. Keep this page open and retry.'
            )
          );
      });
    return {
      read: () => operation(),
      save: async (value) => {
        await operation(value);
      },
      finish: async () => {},
      readOnly: false,
      persistence: 'browser',
    };
  }
  if (!['scorm12', 'scorm2004', 'tincan', 'cmi5'].includes(target))
    throw new Error('Unsupported learning destination.');
  const started = Date.now();
  if (target === 'scorm12' || target === 'scorm2004') {
    const v4 = target === 'scorm2004';
    type Api = Record<string, (...args: string[]) => string>;
    let api: Api | undefined;
    const scan = (initial: Window | null) => {
      let current = initial;
      for (let i = 0; current && i < 20; i++) {
        try {
          const candidate = (current as unknown as Record<string, Api>)[v4 ? 'API_1484_11' : 'API'];
          if (candidate) {
            api = candidate;
            return;
          }
          if (current.parent === current) return;
          current = current.parent;
        } catch {
          return;
        }
      }
    };
    scan(w);
    if (!api) {
      try {
        scan(w.opener as Window | null);
      } catch {
        /* No accessible opener. */
      }
    }
    if (!api)
      throw new Error('The LMS connection is unavailable. Launch this package from your LMS.');
    const call = (v12: string, v2004: string, ...args: string[]) => {
      const fn = api?.[v4 ? v2004 : v12];
      if (!fn) throw new Error('The LMS tracking API is incomplete.');
      return fn.apply(api, args);
    };
    const checked = (a: string, b: string, ...args: string[]) => {
      if (String(call(a, b, ...args)) !== 'true') {
        let code = '';
        try {
          code = String(call('LMSGetLastError', 'GetLastError', ''))
            .replace(/[^0-9]/g, '')
            .slice(0, 8);
        } catch {
          /* Keep the original failure. */
        }
        throw new Error(
          `The LMS did not save this operation${code ? ` (code ${code})` : ''}. Please retry.`
        );
      }
    };
    checked('LMSInitialize', 'Initialize', '');
    const get = (a: string, b: string) => {
      const value = call('LMSGetValue', 'GetValue', v4 ? b : a);
      const code = String(call('LMSGetLastError', 'GetLastError', ''));
      if (code !== '0' && !(v4 && code === '403' && a === 'cmi.suspend_data'))
        throw new Error('The LMS could not read the learning record. Relaunch this module.');
      return value;
    };
    const set = (a: string, b: string, value: string) =>
      checked('LMSSetValue', 'SetValue', v4 ? b : a, value);
    const mode = get('cmi.core.lesson_mode', 'cmi.mode');
    const readOnly = mode === 'review' || mode === 'browse';
    const initialStatus = get('cmi.core.lesson_status', 'cmi.completion_status');
    let completed = ['completed', 'passed'].includes(initialStatus);
    let ended = false;
    const commit = () => checked('LMSCommit', 'Commit', '');
    return {
      readOnly,
      read: async () => get('cmi.suspend_data', 'cmi.suspend_data'),
      save: async (state, done, location) => {
        if (ended) throw new Error('This learning session has ended. Relaunch it from your LMS.');
        if (readOnly) return;
        if (state.length > (v4 ? 64000 : 4096))
          throw new Error('The saved progress exceeds this LMS format limit.');
        set('cmi.suspend_data', 'cmi.suspend_data', state);
        set('cmi.core.lesson_location', 'cmi.location', location);
        completed = completed || done;
        set(
          'cmi.core.lesson_status',
          'cmi.completion_status',
          !v4 && initialStatus === 'passed' ? 'passed' : completed ? 'completed' : 'incomplete'
        );
        set('cmi.core.exit', 'cmi.exit', completed ? (v4 ? 'normal' : '') : 'suspend');
        const cs = Math.max(0, Math.round((Date.now() - started) / 10));
        const pad = (n: number, width = 2) => String(n).padStart(width, '0');
        const duration = v4
          ? `PT${(cs / 100).toFixed(2)}S`
          : `${pad(Math.min(9999, Math.floor(cs / 360000)), 4)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
        set('cmi.core.session_time', 'cmi.session_time', duration);
        commit();
      },
      finish: async () => {
        if (!ended) {
          commit();
          checked('LMSFinish', 'Terminate', '');
          ended = true;
        }
      },
    };
  }

  const cmi5 = target === 'cmi5';
  const params = new URLSearchParams(w.location.search);
  const endpoint = params.get('endpoint');
  const registration = params.get('registration');
  const actorRaw = params.get('actor');
  const activityId = params.get(cmi5 ? 'activityId' : 'activity_id') || activity;
  if (
    !endpoint ||
    !actorRaw ||
    !registration ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(registration)
  )
    throw new Error('Launch this package from an LMS that supplies an xAPI registration.');
  const safeUrl = (raw: string) => {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash)
      throw new Error('The LMS supplied an invalid tracking URL.');
    return url;
  };
  const base = safeUrl(endpoint.endsWith('/') ? endpoint : `${endpoint}/`);
  let actor: Record<string, unknown>;
  try {
    actor = JSON.parse(actorRaw) as Record<string, unknown>;
  } catch {
    throw new Error('The LMS supplied an invalid learner identity.');
  }
  if (
    !actor ||
    Array.isArray(actor) ||
    typeof actor !== 'object' ||
    !(actor.account || actor.mbox || actor.mbox_sha1sum || actor.openid)
  )
    throw new Error('The LMS supplied no learner identity.');
  let auth = params.get('auth') || '';
  if (cmi5) {
    const fetchUrl = params.get('fetch');
    if (!fetchUrl) throw new Error('The cmi5 launch is missing its authorization URL.');
    const reply = await w.fetch(safeUrl(fetchUrl), {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!reply.ok)
      throw new Error('The LMS could not authorize this learning session. Relaunch from your LMS.');
    const token = (await reply.json()) as Record<string, unknown>;
    auth = typeof token['auth-token'] === 'string' ? token['auth-token'] : '';
  }
  if (!auth || /[\r\n]/.test(auth))
    throw new Error('The LMS supplied no usable xAPI authorization.');
  const headers = {
    Authorization: auth,
    'X-Experience-API-Version': '1.0.3',
    'Content-Type': 'application/json',
  };
  const query = new URLSearchParams({ activityId, agent: JSON.stringify(actor), registration });
  let etag: string | null = null;
  const stateUrl = (stateId: string) =>
    new URL(`activities/state?${query}&stateId=${encodeURIComponent(stateId)}`, base);
  const request = async (url: URL, init: RequestInit, missing = false): Promise<Response> => {
    let response: Response | undefined;
    for (let retry = 0; retry < 3; retry++) {
      try {
        response = await w.fetch(url, {
          ...init,
          headers: { ...headers, ...init.headers },
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
      } catch {
        response = undefined;
      }
      if (response?.ok || (missing && response?.status === 404)) return response;
      if (response && response.status < 500 && response.status !== 429) break;
      await new Promise((resolve) => w.setTimeout(resolve, 250 * 2 ** retry));
    }
    if (response?.status === 409 || response?.status === 412)
      throw new Error(
        'Progress changed in another session. Relaunch this module before continuing.'
      );
    if (response?.status === 401 || response?.status === 403)
      throw new Error('Your LMS authorization has expired. Relaunch this module.');
    throw new Error('Progress could not be saved to the LMS. Check your connection and retry.');
  };
  let context: Record<string, unknown> = { registration };
  let readOnly = false;
  if (!cmi5 && params.get('grouping'))
    context.contextActivities = { grouping: [{ id: params.get('grouping') }] };
  if (!cmi5 && params.get('activity_platform')) context.platform = params.get('activity_platform');
  if (cmi5) {
    const launch = (await (
      await request(stateUrl('LMS.LaunchData'), { method: 'GET' })
    ).json()) as Record<string, unknown>;
    if (!launch.contextTemplate || typeof launch.contextTemplate !== 'object')
      throw new Error('The LMS supplied no cmi5 launch context.');
    context = { ...launch.contextTemplate };
    if (context.registration && context.registration !== registration)
      throw new Error('The LMS supplied a conflicting registration.');
    context.registration = registration;
    const extensions = context.extensions as Record<string, unknown> | undefined;
    if (!extensions?.['https://w3id.org/xapi/cmi5/context/extensions/sessionid'])
      throw new Error('The LMS supplied no cmi5 session identifier.');
    readOnly = launch.launchMode === 'Browse' || launch.launchMode === 'Review';
    if (!['Normal', 'Browse', 'Review'].includes(String(launch.launchMode)))
      throw new Error('Unsupported cmi5 launch mode.');
    if (!readOnly && launch.moveOn !== 'Completed' && launch.moveOn !== 'NotApplicable')
      throw new Error('This completion-only module requires a Completed move-on setting.');
  }
  let terminated = false;
  let completionSent = false;
  const pending = new Map<string, string>();
  const statement = async (verb: string) => {
    let body = pending.get(verb);
    if (!body) {
      const ctx = structuredClone(context);
      if (cmi5) {
        const activities = (ctx.contextActivities || {}) as Record<string, unknown>;
        const category = Array.isArray(activities.category) ? [...activities.category] : [];
        for (const id of [
          'https://w3id.org/xapi/cmi5/context/categories/cmi5',
          ...(verb === 'completed' ? ['https://w3id.org/xapi/cmi5/context/categories/moveon'] : []),
        ]) {
          if (!category.some((c) => c.id === id)) category.push({ id });
        }
        ctx.contextActivities = { ...activities, category };
      }
      body = JSON.stringify({
        id: w.crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        actor,
        verb: { id: `http://adlnet.gov/expapi/verbs/${verb}` },
        object: { objectType: 'Activity', id: activityId },
        context: ctx,
        ...(['completed', 'terminated'].includes(verb)
          ? {
              result: {
                duration: `PT${((Date.now() - started) / 1000).toFixed(2)}S`,
                ...(verb === 'completed' ? { completion: true } : {}),
              },
            }
          : {}),
      });
      pending.set(verb, body);
    }
    await request(new URL('statements', base), { method: 'POST', body });
    pending.delete(verb);
  };
  await statement('initialized');
  return {
    readOnly,
    read: async () => {
      const r = await request(stateUrl('lolly.progress.v1'), { method: 'GET' }, true);
      etag = r.headers.get('ETag');
      return r.status === 404 ? '' : await r.text();
    },
    save: async (state, completed) => {
      if (terminated) throw new Error('This learning session has ended.');
      if (readOnly) return;
      const r = await request(stateUrl('lolly.progress.v1'), {
        method: 'PUT',
        body: state,
        headers: etag ? { 'If-Match': etag } : { 'If-None-Match': '*' },
      });
      etag = r.headers.get('ETag');
      if (!etag) {
        const check = await request(stateUrl('lolly.progress.v1'), { method: 'GET' });
        etag = check.headers.get('ETag');
      }
      if (completed && !completionSent) {
        await statement('completed');
        completionSent = true;
      }
    },
    finish: async () => {
      if (!terminated) {
        await statement('terminated');
        terminated = true;
      }
    },
  };
}
