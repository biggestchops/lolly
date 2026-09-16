// SPDX-License-Identifier: MPL-2.0
/** Synthetic 260 feasibility probe. It does not measure camera, call or native-sink latency. */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(async () => {
    const source = document.createElement('canvas'); source.width = 1280; source.height = 720;
    const paint = source.getContext('2d')!; paint.fillStyle = '#508030'; paint.fillRect(0, 0, 1280, 720);
    let sourceFrame = 0;
    const sourceTimer = setInterval(() => { paint.fillStyle = `rgb(80,${128 + (++sourceFrame % 2)},48)`; paint.fillRect(0, 0, 1280, 720); }, 1000 / 30);
    const stream = source.captureStream(30), video = document.createElement('video'); video.muted = true; video.srcObject = stream; await video.play();
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })!;
    if (!gl) throw new Error('WebGL2 unavailable');
    const shader = (type: number, code: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, code); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'Shader failed');
      return s;
    };
    const vertex = shader(gl.VERTEX_SHADER, `#version 300 es
      out vec2 uv; void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); uv=p; gl_Position=vec4(p*2.0-1.0,0,1); }`);
    const fragment = shader(gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float; uniform sampler2D camera; in vec2 uv; out vec4 color;
      void main(){ color=vec4(texture(camera,uv).rgb*vec3(0.9,1.0,1.1),1.0); }`);
    const program = gl.createProgram()!; gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Link failed');
    gl.useProgram(program);
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const gpu = () => {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.drawArrays(gl.TRIANGLES, 0, 3); gl.finish();
    };
    const cpuCanvas = document.createElement('canvas'); cpuCanvas.width = 1280; cpuCanvas.height = 720;
    const cpu = cpuCanvas.getContext('2d', { willReadFrequently: true })!;
    const rgba = () => {
      cpu.drawImage(video, 0, 0); const image = cpu.getImageData(0, 0, 1280, 720);
      for (let i = 0; i < image.data.length; i += 4) { image.data[i] = image.data[i]! * 0.9; image.data[i + 2] = image.data[i + 2]! * 1.1; }
      cpu.putImageData(image, 0, 0);
    };
    const frame = () => new Promise<void>(resolve => { video.requestVideoFrameCallback(() => resolve()); });
    const measure = async (run: () => void) => {
      for (let i = 0; i < 20; i++) { await frame(); run(); }
      const times = [];
      for (let i = 0; i < 120; i++) { await frame(); const start = performance.now(); run(); times.push(performance.now() - start); }
      times.sort((a, b) => a - b);
      return { samples: times.length, p50Ms: times[60], p95Ms: times[114], maxMs: times.at(-1) };
    };
    const textureTransform = await measure(gpu), rgbaTransform = await measure(rgba);
    const pixel = new Uint8Array(4); gl.readPixels(100, 100, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    if ([72, 128, 53].some((channel, i) => Math.abs(channel - pixel[i]!) > 6)) throw new Error(`Unexpected GPU output: ${pixel}`);
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    clearInterval(sourceTimer); stream.getTracks().forEach(track => { track.stop(); }); video.srcObject = null;
    gl.deleteTexture(texture); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    return { dimensions: '1280x720', renderer, pixel: [...pixel], textureTransform, rgbaTransform,
      method: 'Changing synthetic 30fps canvas stream decoded as video; each sample awaits a new video frame, after 20 warmup frames. GPU API upload/draw includes gl.finish; CPU includes draw/read/matrix/write. Browser wall clock, not GPU timer queries. No native transport or physical camera.' };
  });
  const report = JSON.stringify({ at: new Date().toISOString(), browser: browser.version(), ...result }, null, 2);
  if (process.argv[2]) await writeFile(process.argv[2], report + '\n');
  console.log(report);
} finally { await browser.close(); }
