// SPDX-License-Identifier: MPL-2.0
/** Temporary OPFS spill for decoded spans. A clock owns one directory; an old
 * directory is an orphan, never a reusable answer for a mutable source URL. */
export function createPcmStore(budget: number) {
  const entries = new Map<string, { name: string; bytes: number }>();
  let held = 0;
  let serial = 0;
  let dead = false;
  let pending: Promise<unknown> = Promise.resolve();
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let root: FileSystemDirectoryHandle | null = null;
  let opened: Promise<FileSystemDirectoryHandle | null> | null = null;
  const directory = (): Promise<FileSystemDirectoryHandle | null> => opened ??= (async () => {
    try {
      if (!globalThis.navigator?.storage?.getDirectory || dead) return null;
      root = await (await navigator.storage.getDirectory()).getDirectoryHandle('lolly-preview-pcm-v1', { create: true });
      const iterable = root as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> };
      if (iterable.keys) for await (const key of iterable.keys()) {
        const stamp = Number(key.split('-')[0]);
        if (!Number.isFinite(stamp) || Date.now() - stamp > 86_400_000) {
          await root.removeEntry(key, { recursive: true }).catch(() => {});
        }
      }
      return dead ? null : await root.getDirectoryHandle(name, { create: true });
    } catch { return null; }
  })();
  return {
    async get(key: string): Promise<AudioBuffer | null> {
      await pending;
      const entry = entries.get(key);
      if (!entry || dead) return null;
      try {
        const dir = await directory(); if (!dir || dead) return null;
        const bytes = await (await (await dir.getFileHandle(entry.name)).getFile()).arrayBuffer();
        const head = new Uint32Array(bytes, 0, 3);
        const [rate, channels, length] = head;
        if (!rate || !channels || channels > 32 || !length || bytes.byteLength !== 12 + channels * length * 4) return null;
        const buffer = new AudioBuffer({ sampleRate: rate, numberOfChannels: channels, length });
        for (let c = 0; c < channels; c++) buffer.copyToChannel(new Float32Array(bytes, 12 + c * length * 4, length), c);
        entries.delete(key); entries.set(key, entry);
        return dead ? null : buffer;
      } catch { return null; }
    },
    put(key: string, buffer: AudioBuffer): Promise<void> {
      const run = async (): Promise<void> => {
        const size = 12 + buffer.length * buffer.numberOfChannels * 4;
        if (dead || size > budget || entries.has(key)) return;
        const dir = await directory(); if (!dir || dead) return;
        while (held + size > budget && entries.size) {
          const [oldKey, old] = entries.entries().next().value!;
          await dir.removeEntry(old.name).catch(() => {}); entries.delete(oldKey); held -= old.bytes;
        }
        const file = `${++serial}.pcm`;
        try {
          const writer = await (await dir.getFileHandle(file, { create: true })).createWritable();
          try {
            await writer.write(new Uint32Array([buffer.sampleRate, buffer.numberOfChannels, buffer.length]));
            for (let c = 0; c < buffer.numberOfChannels; c++) await writer.write(buffer.getChannelData(c) as Float32Array<ArrayBuffer>);
            await writer.close();
          } catch (error) { await writer.abort().catch(() => {}); throw error; }
          if (!dead) { entries.set(key, { name: file, bytes: size }); held += size; }
        } catch { await dir.removeEntry(file).catch(() => {}); }
      };
      const job = pending.then(run, run); pending = job; return job;
    },
    destroy(): void {
      dead = true; entries.clear();
      void pending.finally(async () => { await opened; await root?.removeEntry(name, { recursive: true }).catch(() => {}); });
    },
  };
}
