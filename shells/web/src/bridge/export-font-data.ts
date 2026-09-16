// SPDX-License-Identifier: MPL-2.0
// Module-level cache: font URL → base64 string. Survives across export calls
// within a session so the TTF files are fetched at most once.
const _fontBase64Cache = new Map<string, string>();
let fontBase64Bytes = 0;

export async function loadFontBase64(url: string): Promise<string> {
  const cached = _fontBase64Cache.get(url);
  if (cached) { _fontBase64Cache.delete(url); _fontBase64Cache.set(url, cached); return cached; }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Font fetch failed: ${url}`);
  const buf = await resp.arrayBuffer();
  // FileReader is the safest way to base64-encode arbitrary binary in a browser.
  // btoa(String.fromCharCode(...uint8)) blows the stack on large font files.
  const b64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]!);
    reader.onerror = reject;
    reader.readAsDataURL(new Blob([buf]));
  });
  const cost = (url.length + b64.length) * 2;
  if (cost <= 8 * 1024 * 1024) {
    const previous = _fontBase64Cache.get(url);
    if (previous) { fontBase64Bytes -= (url.length + previous.length) * 2; _fontBase64Cache.delete(url); }
    while (_fontBase64Cache.size && (_fontBase64Cache.size >= 32 || fontBase64Bytes + cost > 8 * 1024 * 1024)) {
      const oldest = _fontBase64Cache.keys().next().value!;
      fontBase64Bytes -= (oldest.length + _fontBase64Cache.get(oldest)!.length) * 2;
      _fontBase64Cache.delete(oldest);
    }
    _fontBase64Cache.set(url, b64); fontBase64Bytes += cost;
  }
  return b64;
}

interface FontDocument {
  addFileToVFS(file: string, base64: string): void;
  addFont(file: string, name: string, style: string): void;
}

// Registers a resolved sfnt once per PDF. pdfFontEmbed checks embedding flags
// and requires variable fonts to render at their default instance.
export async function embedResolvedFont(pdf: FontDocument, registeredFonts: Set<unknown>, url: string): Promise<string | null> {
  const name = `uf_${url}`;
  if (!registeredFonts.has(name)) {
    try {
      const b64 = await loadFontBase64(url); // blob: URLs are fetchable
      const file = `${name}.ttf`;
      pdf.addFileToVFS(file, b64);
      pdf.addFont(file, name, 'normal'); // slant is baked into the embedded file
      registeredFonts.add(name);
    } catch {
      return null;
    }
  }
  return name;
}
