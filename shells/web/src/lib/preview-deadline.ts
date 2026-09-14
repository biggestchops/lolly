// SPDX-License-Identifier: MPL-2.0
/** Stop waiting for an unavailable preview; callers ignore any late result. */
export async function previewDeadline<T>(work: Promise<T>, timeoutMs = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Preview render timed out')), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
