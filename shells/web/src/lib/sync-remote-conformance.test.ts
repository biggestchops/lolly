// SPDX-License-Identifier: MPL-2.0
/**
 * lib/sync-remote.ts `MemoryRemote` against the shared SyncRemote conformance
 * suite (plans/138 Tier D, WP-S6). MemoryRemote is the reference the real
 * adapters are measured against, so it has to pass the same cases they do.
 * The live-settings readers of the suite are checked here too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryRemote } from './sync-remote.ts';
import {
  runSyncRemoteConformance, liveS3Settings, liveWebdavSettings, liveRunId, patternBytes,
} from './sync-remote-conformance.ts';

// One MemoryRemote per path, all in one map, so the suite's paths share a store.
let stores = new Map<string, MemoryRemote>();

runSyncRemoteConformance('MemoryRemote conformance', (path = '') => {
  let remote = stores.get(path);
  if (!remote) { remote = new MemoryRemote(); stores.set(path, remote); }
  return remote;
}, {
  preconditions: 'store',
  setup: () => { stores = new Map(); },
});

test('live S3 settings: every missing variable is named in the skip reason', () => {
  const none = liveS3Settings({});
  assert.equal(none.config, undefined);
  assert.match(none.skip ?? '', /LOLLY_SYNC_LIVE_S3_ENDPOINT, LOLLY_SYNC_LIVE_S3_BUCKET, LOLLY_SYNC_LIVE_S3_KEY_ID, LOLLY_SYNC_LIVE_S3_SECRET/);

  const partial = liveS3Settings({ LOLLY_SYNC_LIVE_S3_ENDPOINT: 'https://s3.example.com', LOLLY_SYNC_LIVE_S3_BUCKET: 'b' });
  assert.match(partial.skip ?? '', /set LOLLY_SYNC_LIVE_S3_KEY_ID, LOLLY_SYNC_LIVE_S3_SECRET to run it/);
});

test('live S3 settings: a full set gives a config with defaults and a normalised prefix', () => {
  const full = liveS3Settings({
    LOLLY_SYNC_LIVE_S3_ENDPOINT: 'https://s3.example.com',
    LOLLY_SYNC_LIVE_S3_BUCKET: 'b',
    LOLLY_SYNC_LIVE_S3_KEY_ID: 'id',
    LOLLY_SYNC_LIVE_S3_SECRET: 'secret',
    LOLLY_SYNC_LIVE_S3_PREFIX: 'tests//',
  });
  assert.equal(full.skip, undefined);
  assert.equal(full.preconditions, 'store');
  assert.deepEqual(full.config, {
    endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'b',
    accessKeyId: 'id', secretAccessKey: 'secret', prefix: 'tests/',
  });

  const loose = liveS3Settings({
    LOLLY_SYNC_LIVE_S3_ENDPOINT: 'e', LOLLY_SYNC_LIVE_S3_BUCKET: 'b', LOLLY_SYNC_LIVE_S3_KEY_ID: 'i', LOLLY_SYNC_LIVE_S3_SECRET: 's',
    LOLLY_SYNC_LIVE_S3_PRECONDITIONS: 'none',
  });
  assert.equal(loose.preconditions, 'none');

  const wrong = liveS3Settings({
    LOLLY_SYNC_LIVE_S3_ENDPOINT: 'e', LOLLY_SYNC_LIVE_S3_BUCKET: 'b', LOLLY_SYNC_LIVE_S3_KEY_ID: 'i', LOLLY_SYNC_LIVE_S3_SECRET: 's',
    LOLLY_SYNC_LIVE_S3_PRECONDITIONS: 'sometimes',
  });
  assert.match(wrong.skip ?? '', /must be "store" or "none"/);
});

test('live WebDAV settings: missing variables skip, a full set trims the folder', () => {
  assert.match(liveWebdavSettings({}).skip ?? '',
    /LOLLY_SYNC_LIVE_WEBDAV_URL, LOLLY_SYNC_LIVE_WEBDAV_USER, LOLLY_SYNC_LIVE_WEBDAV_APP_PASSWORD/);
  const full = liveWebdavSettings({
    LOLLY_SYNC_LIVE_WEBDAV_URL: 'https://cloud.example.org',
    LOLLY_SYNC_LIVE_WEBDAV_USER: 'ada',
    LOLLY_SYNC_LIVE_WEBDAV_APP_PASSWORD: 'pw',
    LOLLY_SYNC_LIVE_WEBDAV_FOLDER: '/Tests/Lolly/',
  });
  assert.deepEqual(full.config, { baseUrl: 'https://cloud.example.org', username: 'ada', appPassword: 'pw', folder: 'Tests/Lolly' });
});

test('live run ids differ, and pattern bytes are repeatable per seed', () => {
  assert.notEqual(liveRunId(), liveRunId());
  assert.match(liveRunId(), /^lolly-conformance-\d{8}T\d{6}-[0-9a-z]+$/);
  assert.deepEqual(patternBytes(64, 3), patternBytes(64, 3));
  assert.notDeepEqual(patternBytes(64, 3), patternBytes(64, 4));
});
