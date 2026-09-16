// SPDX-License-Identifier: MPL-2.0
/**
 * A batch export owns the offscreen render stage across view navigation.
 * Cancellation stops subsequent rows, but the current render and delivery must
 * settle before another heavy job can use that stage. The global toast shows
 * cancellation immediately; resourceJobs() retains the reservation until cleanup.
 * Completed files are delivered according to the runner's existing policy.
 *
 * Keep this wrapper light so views can load the batch renderer on demand.
 */
import { startJob, resourceJobs, type JobHandle } from './jobs.ts';
import { tRaw } from '../i18n.ts';

/** Batch reservations, including cancelled runs that still own resources. */
const batchJobIds = new Set<string>();

/** True while a batch run owns the offscreen stage (queued counts - its turn is booked). */
export function isBatchRunActive(): boolean {
  if (batchJobIds.size === 0) return false;
  return resourceJobs().some(j => batchJobIds.has(j.id));
}

/**
 * Start (and register) the job that owns one batch run. The caller drives it:
 * await `started`, poll `cancelled`, report `progress`, then finish/fail. Prefer
 * {@link startBatchExport}, which does that dance; this is for the runner's own
 * un-wrapped path (pro/run-overlay.ts's Retry).
 */
export function startBatchJob(title: string): JobHandle {
  const job = startJob({ title, retainSlotOnCancel: true, cancel: () => { /* cooperative - the runner polls job.cancelled */ } });
  batchJobIds.add(job.id);
  return job;
}

/** Drop a settled job from the batch registry. Safe to call more than once. */
export function releaseBatchJob(job: JobHandle): void {
  job.settle();
  batchJobIds.delete(job.id);
}

/** What a finished export hands back, read only to name the package out loud. */
export interface BatchExportOutcome {
  /** The delivered zip's filename, when the run packaged one. */
  zipName?: string;
  /** A single bare file's name (the one-session render path). */
  name?: string;
}

/**
 * Run a whole batch export as one background job.
 *
 * `run` gets the job handle to thread into the runner. It may do the slow row
 * assembly and preflight too - anything it throws fails the JOB, which is the
 * only failure surface that survives the initiating view.
 *
 * Returns the handle immediately; the work continues in the background. Two
 * exports started in a row do not race: jobs are heavy, so the second waits its
 * turn in the process-wide serial queue instead of sharing the offscreen stage.
 */
export function startBatchExport(
  title: string,
  run: (job: JobHandle) => Promise<unknown>,
): JobHandle {
  const job = startBatchJob(title);
  void (async (): Promise<void> => {
    try {
      await job.started;
      if (job.cancelled) return;
      const out = await run(job) as BatchExportOutcome | null | undefined;
      if (job.cancelled) return;
      job.finish(out ?? undefined);
      announceDelivered(out);
    } catch (err) {
      // A cancel is not a failure: cancelJob() already put the job in its terminal
      // state, and the runner's abandoned work can surface as anything.
      if (job.cancelled) return;
      job.fail(err);
    } finally {
      releaseBatchJob(job);
    }
  })();
  return job;
}

/**
 * Name the finished package out loud. By the time a big run lands, the view that
 * started it may be gone - the toast carries the "Done" state, and this carries
 * the FILE NAME through the shared body-level live region (a11y.ts), which no
 * view teardown can take away. The bytes themselves reach the user either way:
 * delivery is a browser download (pro/zip.ts saveBlob), which is view-independent.
 *
 * a11y.ts is reached lazily on purpose: /pro imports this module (through
 * pro/run-overlay.ts) and is deliberately kept out of the app shell's graph, so the
 * shared live region is pulled in only when a package is actually delivered.
 */
function announceDelivered(out: BatchExportOutcome | null | undefined): void {
  const name = out?.zipName || out?.name;
  if (!name) return;
  void import('../a11y.ts')
    .then(({ announce }) => { announce(tRaw('{name} ready.', { name })); })
    .catch(() => { /* an announcement must never fail a finished run */ });
}
