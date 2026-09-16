// SPDX-License-Identifier: MPL-2.0
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { availableParallelism, freemem, loadavg } from 'node:os';
const execute = promisify(execFile);

/** RSS includes shared mappings; CPU is accumulated across sampled process lifetimes. */
export function sampleProcessTrees(roots: Record<string, number>) {
  const samples: { at: number; host: { cpus: number; loadavg: number[]; freeBytes: number }; groups: Record<string, { rss: number; cpuSeconds: number; processes: number }> }[] = [];
  const previous = new Map<number, number>(), cpu = new Map<string, number>();
  const failures: unknown[] = [];
  let running = false;
  async function sample() {
    if (running) return;
    running = true;
    try {
      const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,rss=,time='], { maxBuffer: 4 * 1024 * 1024 });
      const rows = stdout.trim().split('\n').map(line => {
        const [pid, ppid, rss, time] = line.trim().split(/\s+/);
        const parts = time!.split(':').map(Number);
        return { pid: Number(pid), ppid: Number(ppid), rss: Number(rss) * 1024, cpu: parts.reduce((sum, value) => sum * 60 + value, 0) };
      });
      const parents = new Map(rows.map(row => [row.pid, row.ppid]));
      const groups: Record<string, { rss: number; cpuSeconds: number; processes: number }> = {};
      for (const name of Object.keys(roots)) groups[name] = { rss: 0, cpuSeconds: cpu.get(name) ?? 0, processes: 0 };
      for (const row of rows) {
        let parent = row.pid, name: string | undefined;
        for (let depth = 0; parent > 1 && depth < 30; depth++) {
          name = Object.keys(roots).find(name => roots[name] === parent);
          if (name) break;
          parent = parents.get(parent) ?? 0;
        }
        if (!name) continue;
        const group = groups[name]!;
        group.rss += row.rss; group.processes++;
        const delta = Math.max(0, row.cpu - (previous.get(row.pid) ?? row.cpu));
        previous.set(row.pid, row.cpu); cpu.set(name, (cpu.get(name) ?? 0) + delta);
        group.cpuSeconds = cpu.get(name)!;
      }
      samples.push({ at: Date.now(), host: { cpus: availableParallelism(), loadavg: loadavg(), freeBytes: freemem() }, groups });
    } finally { running = false; }
  }
  const timer = setInterval(() => { void sample().catch(error => { failures.push(error); }); }, 500);
  return { sample, async stop() {
    clearInterval(timer);
    while (running) await new Promise(resolve => setTimeout(resolve, 10));
    await sample();
    if (failures.length) throw new AggregateError(failures, 'process sampling failed');
    return samples;
  } };
}
