// SPDX-License-Identifier: MPL-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Runtime} from '../../../../engine/src/runtime.ts';
import {setDesignImportReport} from './design-import-report.ts';
import {checkDesignToolSource, DesignSourceReviewError, getDesignToolSource, rememberDesignToolSource, restoreDesignToolSource, setRulesSourcePages} from './design-tool-source.ts';

test('source findings survive the author master and require review after replacement',async()=>{
  const runtime={} as Runtime;const file=new File(['%PDF-1.7\n'], 'source.pdf');
  setRulesSourcePages(file,[2]);setDesignImportReport(file,[{page:2,kind:'review',object:'Title',message:'Check this crop.'}]);
  await rememberDesignToolSource(runtime,file);
  assert.throws(()=>checkDesignToolSource(runtime),DesignSourceReviewError);
  const source=getDesignToolSource(runtime)!;assert.deepEqual(source.pages,[2]);source.reviewed=true;
  const reader={} as Runtime;restoreDesignToolSource(reader,JSON.parse(JSON.stringify(source)));assert.doesNotThrow(()=>checkDesignToolSource(reader));
  await rememberDesignToolSource(runtime,file);assert.throws(()=>checkDesignToolSource(runtime),DesignSourceReviewError);
});
test('preserved fixed artwork is informative and old masters remain readable',()=>{
  const runtime={} as Runtime;
  restoreDesignToolSource(runtime,{name:'source.pdf',data:'data:application/pdf;base64,AA==',findings:[{page:0,kind:'fixed',message:'Clipped image.'}]});
  assert.doesNotThrow(()=>checkDesignToolSource(runtime));
  restoreDesignToolSource(runtime,{name:'old.pdf',data:'data:application/pdf;base64,AA=='});
  assert.doesNotThrow(()=>checkDesignToolSource(runtime));
});

test('large sources keep their findings without embedding their bytes in the master',async()=>{
  const runtime={} as Runtime;const file=new File(['%PDF-1.7\n'], 'large.pdf');
  Object.defineProperty(file,'size',{value:31*1024*1024});
  setDesignImportReport(file,[{page:0,kind:'review',message:'Check colours.'}]);
  await rememberDesignToolSource(runtime,file);
  assert.equal(getDesignToolSource(runtime)!.data,'');assert.throws(()=>checkDesignToolSource(runtime),DesignSourceReviewError);
  const restored={} as Runtime;restoreDesignToolSource(restored,JSON.parse(JSON.stringify(getDesignToolSource(runtime))));
  assert.throws(()=>checkDesignToolSource(restored),DesignSourceReviewError);
});
