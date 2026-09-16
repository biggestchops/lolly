// SPDX-License-Identifier: MPL-2.0
/** Saved-session sharing leaves persistence and project navigation with Projects. */
import type { HostV1 } from '@lolly-tools/core/host-v1';
import { serializeUrlState } from '@lolly/engine';
import { getTool } from '../bridge/tool-loader.ts';
import { createToolRuntime } from '../lib/mount-runtime.ts';
import { openShareDialog } from '../components/share-dialog.ts';
import { launchRulesCopy } from '../lib/rules-launch.ts';
import { t } from '../i18n.ts';
import type { SessionSaveSource } from './projects-templates.ts';

export async function shareProjectSession(host:HostV1,source:SessionSaveSource,rules:boolean,announce:(message:string)=>void):Promise<void> {
  try {
    const data=await host.state.load(source.slot) as Record<string,unknown>|null;
    if(!data)throw new Error('This saved tool session could not be loaded.');
    if(rules){await launchRulesCopy(source.toolId,data,source.label);return;}
    const tool=await getTool(source.toolId);
    const runtime=await createToolRuntime(tool,host,data as Parameters<typeof createToolRuntime>[2]);
    try {
      const query=serializeUrlState(runtime.getModel());
      const baseParts=query?query.split('&'):[];
      if(data.__export_format)baseParts.push(`format=${encodeURIComponent(String(data.__export_format))}`);
      openShareDialog({toolId:source.toolId,baseParts,manifest:tool.manifest,currentFormat:String(data.__export_format||''),title:t('Share this creation')});
    }finally{runtime.destroy();}
  }catch(error){announce((error as Error).message);}
}
