// SPDX-License-Identifier: MPL-2.0
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/** Probe the deployment itself; never follow a redirect to a sign-in service. */
export async function deploymentLive(url: string, bypass?: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (bypass?.trim()) headers['x-vercel-protection-bypass'] = bypass.trim();
    const response = await fetch(url, { method: 'HEAD', redirect: 'manual', headers, signal: AbortSignal.timeout(30_000) });
    return response.ok;
  } catch { return false; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await deploymentLive(process.argv[2] || '', process.env.VERCEL_AUTOMATION_BYPASS_SECRET) ? 0 : 1;
}
