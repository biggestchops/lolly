"""Generate the synthetic open-GOP fixture. Requires FFmpeg with libx265."""
import subprocess
from pathlib import Path

width, height, fps = 160, 120, 24
command = [
    'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo',
    '-pixel_format', 'rgb24', '-video_size', f'{width}x{height}', '-framerate', str(fps),
    '-i', 'pipe:0', '-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-x265-params', 'keyint=24:min-keyint=24:scenecut=0:open-gop=1:bframes=4:pools=1:log-level=error',
    '-an', str(Path(__file__).with_name('open-gop-hevc.mp4')),
]
with subprocess.Popen(command, stdin=subprocess.PIPE) as encoder:
    for frame in range(72):
        pixels = bytearray(width * height * 3)
        for y in range(height):
            for x in range(width):
                value = 255 if (frame >> (x // 16)) & 1 else 0
                if y >= 20:
                    value = 255 if abs(x - (frame * 2) % width) < 8 else 0
                offset = (y * width + x) * 3
                pixels[offset:offset + 3] = bytes([value] * 3)
        encoder.stdin.write(pixels)
    encoder.stdin.close()
    if encoder.wait():
        raise RuntimeError('FFmpeg could not encode the fixture')
