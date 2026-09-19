// SPDX-License-Identifier: MPL-2.0
// Synthetic fixtures only. This executable is never shipped to clients.
#include <jxl/encode.h>
#include <jxl/color_encoding.h>
#include <cstdio>
#include <cstring>
#include <vector>
int main(int argc, char** argv) {
  const char* kind = argc > 1 ? argv[1] : "gray";
  const bool gray = !strcmp(kind, "gray"), animation = !strcmp(kind, "animation"), auxiliary = !strcmp(kind, "auxiliary");
  auto* enc = JxlEncoderCreate(nullptr);
  JxlBasicInfo basic; JxlEncoderInitBasicInfo(&basic);
  basic.xsize = !strcmp(kind, "oversized") ? 16385 : 3; basic.ysize = 2;
  basic.bits_per_sample = 8; basic.num_color_channels = gray ? 1 : 3;
  basic.uses_original_profile = JXL_TRUE;
  basic.have_animation = animation;
  if (animation) { basic.animation.tps_numerator = 1000; basic.animation.tps_denominator = 1; }
  if (auxiliary) basic.num_extra_channels = 1;
  if (JxlEncoderSetBasicInfo(enc, &basic) != JXL_ENC_SUCCESS) return 1;
  if (auxiliary) {
    JxlExtraChannelInfo extra; JxlEncoderInitExtraChannelInfo(JXL_CHANNEL_DEPTH, &extra);
    if (JxlEncoderSetExtraChannelInfo(enc, 0, &extra) != JXL_ENC_SUCCESS) return 2;
  }
  JxlColorEncoding color; JxlColorEncodingSetToSRGB(&color, gray);
  if (!strcmp(kind, "p3")) color.primaries = JXL_PRIMARIES_P3;
  if (JxlEncoderSetColorEncoding(enc, &color) != JXL_ENC_SUCCESS) return 3;
  JxlPixelFormat format = {gray ? 1u : 3u, JXL_TYPE_UINT8, JXL_NATIVE_ENDIAN, 0};
  auto* settings = JxlEncoderFrameSettingsCreate(enc, nullptr);
  JxlEncoderSetFrameLossless(settings, JXL_TRUE);
  JxlFrameHeader header; JxlEncoderInitFrameHeader(&header); header.duration = 33;
  if (animation) JxlEncoderSetFrameHeader(settings, &header);
  std::vector<unsigned char> pixels(basic.xsize * basic.ysize * format.num_channels, 127);
  pixels[0] = 255; pixels[1] = 0; pixels[2] = 64;
  for (int i = 0; i < (animation ? 2 : 1); i++) {
    if (JxlEncoderAddImageFrame(settings, &format, pixels.data(), pixels.size()) != JXL_ENC_SUCCESS) return 4;
    if (auxiliary) {
      std::vector<float> depth(basic.xsize * basic.ysize, 0.5f);
      JxlPixelFormat channel = {1, JXL_TYPE_FLOAT, JXL_NATIVE_ENDIAN, 0};
      if (JxlEncoderSetExtraChannelBuffer(settings, &channel, depth.data(), depth.size() * sizeof(float), 0) != JXL_ENC_SUCCESS) return 5;
    }
    pixels[0] = 0;
  }
  JxlEncoderCloseInput(enc);
  std::vector<unsigned char> out(1024 * 1024); unsigned char* next = out.data(); size_t available = out.size();
  if (JxlEncoderProcessOutput(enc, &next, &available) != JXL_ENC_SUCCESS) return 6;
  for (size_t i = 0; i < out.size() - available; i++) printf("%02x", out[i]);
  printf("\n"); fflush(stdout);
  JxlEncoderDestroy(enc);
}
