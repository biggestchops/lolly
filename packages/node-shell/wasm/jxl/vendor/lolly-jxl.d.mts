import type { JxlModule } from '../../src/jxl-codec.ts';
export default function create(options: { wasmBinary: Uint8Array; printErr?: (message: string) => void }): Promise<JxlModule>;
