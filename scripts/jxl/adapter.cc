// SPDX-License-Identifier: MPL-2.0
// Bounded still-image adapter. Every call belongs to one disposable worker.
#include <jxl/decode.h>
#include <jxl/encode.h>
#include <jxl/cms.h>
#include <jxl/color_encoding.h>
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>

namespace {
constexpr size_t LIMIT = 384u * 1024 * 1024;
constexpr size_t OUTPUT_LIMIT = 128u * 1024 * 1024;
size_t live = 0, peak = 0, size = 0;
uint8_t* output = nullptr;
double info[20] = {};
const char* error = "";
void* allocate(void*, size_t n) {
  if (n > LIMIT || live > LIMIT - n) return nullptr;
  auto* p = static_cast<size_t*>(malloc(n + 16));
  if (!p) return nullptr;
  *p = n; live += n; peak = std::max(peak, live);
  return reinterpret_cast<uint8_t*>(p) + 16;
}
void release(void*, void* ptr) {
  if (!ptr) return;
  auto* p = reinterpret_cast<size_t*>(static_cast<uint8_t*>(ptr) - 16);
  live -= *p; free(p);
}
JxlMemoryManager memory = {nullptr, allocate, release};
bool resize(size_t n) {
  if (n > OUTPUT_LIMIT) return false;
  auto* p = static_cast<uint8_t*>(realloc(output, n));
  if (!p) return false;
  output = p; size = n; return true;
}
bool dimensions(uint32_t w, uint32_t h, size_t pixels = 16000000) {
  return w && h && w <= 16384 && h <= 16384 && uint64_t(w) * h <= pixels;
}
int fail(const char* message) { error = message; return 0; }
int finishEncode(JxlEncoder* encoder) {
  JxlEncoderCloseInput(encoder);
  if (!resize(65536)) return fail("JPEG XL output allocation failed.");
  size_t used = 0;
  for (;;) {
    uint8_t* next = output + used; size_t available = size - used;
    auto status = JxlEncoderProcessOutput(encoder, &next, &available);
    used = next - output;
    if (status == JXL_ENC_SUCCESS) { size = used; return 1; }
    if (status != JXL_ENC_NEED_MORE_OUTPUT) return fail("JPEG XL encoding failed or exceeded its memory budget.");
    if (!resize(std::min(size * 2, OUTPUT_LIMIT)) || used == OUTPUT_LIMIT) return fail("JPEG XL output exceeds 128 MiB.");
  }
}
}
extern "C" {
void lj_reset() { free(output); output = nullptr; size = 0; peak = live; error = ""; memset(info, 0, sizeof(info)); }
uint8_t* lj_data() { return output; }
size_t lj_size() { return size; }
double* lj_info() { info[18] = peak; info[19] = live; return info; }
const char* lj_error() { return error; }

// Modes: header, oriented sRGB8, original uint16 samples, linear sRGB float, JPEG.
int lj_decode(const uint8_t* bytes, size_t length, int mode) {
  lj_reset();
  auto* dec = JxlDecoderCreate(&memory);
  if (!dec) return fail("JPEG XL decoder allocation failed.");
  struct Cleanup { JxlDecoder* p; ~Cleanup() { JxlDecoderDestroy(p); } } cleanup{dec};
  JxlDecoderSetCms(dec, *JxlGetDefaultCms());
  JxlDecoderSetKeepOrientation(dec, mode == 0 || mode == 2);
  JxlDecoderSetUnpremultiplyAlpha(dec, mode == 1 || mode == 3);
  if (mode == 1) JxlDecoderSetDesiredIntensityTarget(dec, 255);
  int events = JXL_DEC_BASIC_INFO | JXL_DEC_COLOR_ENCODING | JXL_DEC_FRAME | JXL_DEC_FULL_IMAGE;
  if (mode == 0 || mode == 4) events |= JXL_DEC_JPEG_RECONSTRUCTION;
  JxlDecoderSubscribeEvents(dec, events);
  JxlDecoderSetInput(dec, bytes, length); JxlDecoderCloseInput(dec);
  JxlPixelFormat format = {4, mode == 2 ? JXL_TYPE_UINT16 : mode == 3 ? JXL_TYPE_FLOAT : JXL_TYPE_UINT8, JXL_LITTLE_ENDIAN, 0};
  bool complete = false, jpeg = false; size_t jpegUsed = 0;
  for (;;) {
    const auto status = JxlDecoderProcessInput(dec);
    if (status == JXL_DEC_ERROR || status == JXL_DEC_NEED_MORE_INPUT) return fail("Invalid, truncated or oversized JPEG XL image.");
    if (status == JXL_DEC_BASIC_INFO) {
      JxlBasicInfo basic;
      if (JxlDecoderGetBasicInfo(dec, &basic) != JXL_DEC_SUCCESS) return fail("Invalid JPEG XL header.");
      info[0] = basic.xsize; info[1] = basic.ysize; info[2] = basic.bits_per_sample;
      info[3] = basic.exponent_bits_per_sample; info[4] = basic.alpha_bits; info[5] = basic.orientation;
      info[6] = basic.have_animation; info[7] = basic.num_extra_channels; info[8] = basic.intensity_target;
      info[9] = basic.num_color_channels; info[10] = basic.alpha_premultiplied;
      if (!dimensions(basic.xsize, basic.ysize)) return fail("JPEG XL images are limited to 16 megapixels and 16384 pixels per edge.");
      if (mode && basic.have_animation) return fail("Animated JPEG XL is not supported. The original has not been converted.");
      if (mode && basic.num_extra_channels > (basic.alpha_bits ? 1u : 0u)) return fail("JPEG XL auxiliary channels cannot be edited or converted here.");
    } else if (status == JXL_DEC_COLOR_ENCODING) {
      JxlColorEncoding color;
      if (JxlDecoderGetColorAsEncodedProfile(dec, JXL_COLOR_PROFILE_TARGET_ORIGINAL, &color) == JXL_DEC_SUCCESS) {
        info[11] = color.transfer_function; info[12] = color.primaries; info[13] = color.white_point;
      } else info[14] = 1;
      if (mode == 0) continue;
      if (mode == 1 || mode == 3) {
        if (mode == 3) JxlColorEncodingSetToLinearSRGB(&color, JXL_FALSE);
        else JxlColorEncodingSetToSRGB(&color, JXL_FALSE);
        if (JxlDecoderSetOutputColorProfile(dec, &color, nullptr, 0) != JXL_DEC_SUCCESS) return fail("JPEG XL colour conversion is unavailable for this profile.");
      }
    } else if (status == JXL_DEC_JPEG_RECONSTRUCTION) {
      info[15] = 1; jpeg = true;
      if (mode == 0) return 1;
      if (!resize(65536) || JxlDecoderSetJPEGBuffer(dec, output, size) != JXL_DEC_SUCCESS) return fail("JPEG restoration allocation failed.");
    } else if (status == JXL_DEC_JPEG_NEED_MORE_OUTPUT) {
      jpegUsed = size - JxlDecoderReleaseJPEGBuffer(dec);
      if (!resize(std::min(size * 2, OUTPUT_LIMIT)) || jpegUsed == OUTPUT_LIMIT) return fail("Restored JPEG exceeds 128 MiB.");
      if (JxlDecoderSetJPEGBuffer(dec, output + jpegUsed, size - jpegUsed) != JXL_DEC_SUCCESS) return fail("JPEG restoration failed.");
    } else if (status == JXL_DEC_NEED_IMAGE_OUT_BUFFER) {
      if (mode == 0) return 1;
      if (mode == 4) return fail("This JPEG XL has no original JPEG reconstruction data.");
      size_t required;
      if (JxlDecoderImageOutBufferSize(dec, &format, &required) != JXL_DEC_SUCCESS || !resize(required)) return fail("JPEG XL pixel buffer exceeds its memory budget.");
      if (JxlDecoderSetImageOutBuffer(dec, &format, output, size) != JXL_DEC_SUCCESS) return fail("JPEG XL pixel buffer was refused.");
    } else if (status == JXL_DEC_FULL_IMAGE) complete = true;
    else if (status == JXL_DEC_SUCCESS) {
      if (mode == 0) return info[0] ? 1 : fail("Missing JPEG XL header.");
      if (!complete || (mode == 4 && !jpeg)) return fail("JPEG XL did not contain a complete supported image.");
      if (mode == 4) size -= JxlDecoderReleaseJPEGBuffer(dec);
      return 1;
    }
  }
}

// Sample type: 0=RGBA8, 1=RGBA16, 2=linear float RGBA (fixture/deep foundation).
int lj_encode(const uint8_t* pixels, size_t length, uint32_t width, uint32_t height, int lossless, float quality, int effort, int sample, int orientation) {
  lj_reset();
  const size_t pixelBytes = (sample == 1 || sample == 3) ? 8 : sample == 2 ? 16 : 4;
  if (!dimensions(width, height, 8000000) || uint64_t(width) * height * pixelBytes != length) return fail("JPEG XL encoding requires a valid image up to 8 megapixels.");
  if (quality < 0.1f || quality > 1 || effort < 1 || effort > 7 || sample < 0 || sample > 3 || orientation < 1 || orientation > 8) return fail("Invalid JPEG XL encoding options.");
  auto* enc = JxlEncoderCreate(&memory);
  if (!enc) return fail("JPEG XL encoder allocation failed.");
  struct Cleanup { JxlEncoder* p; ~Cleanup() { JxlEncoderDestroy(p); } } cleanup{enc};
  JxlEncoderSetCms(enc, *JxlGetDefaultCms());
  JxlBasicInfo basic; JxlEncoderInitBasicInfo(&basic);
  basic.xsize = width; basic.ysize = height; basic.bits_per_sample = (sample == 1 || sample == 3) ? 16 : sample == 2 ? 32 : 8;
  basic.exponent_bits_per_sample = sample == 2 ? 8 : 0;
  basic.alpha_bits = basic.bits_per_sample; basic.alpha_exponent_bits = basic.exponent_bits_per_sample;
  basic.num_color_channels = 3; basic.num_extra_channels = 1; basic.uses_original_profile = lossless;
  basic.orientation = static_cast<JxlOrientation>(orientation);
  JxlColorEncoding color;
  if (sample == 2) JxlColorEncodingSetToLinearSRGB(&color, JXL_FALSE); else JxlColorEncodingSetToSRGB(&color, JXL_FALSE);
  if (sample == 3) {
    color.primaries = JXL_PRIMARIES_2100;
    color.transfer_function = JXL_TRANSFER_FUNCTION_PQ;
    basic.intensity_target = 10000;
  }
  if (JxlEncoderSetBasicInfo(enc, &basic) != JXL_ENC_SUCCESS || JxlEncoderSetColorEncoding(enc, &color) != JXL_ENC_SUCCESS) return fail("JPEG XL encoding profile was refused.");
  auto* settings = JxlEncoderFrameSettingsCreate(enc, nullptr);
  JxlEncoderFrameSettingsSetOption(settings, JXL_ENC_FRAME_SETTING_EFFORT, effort);
  JxlEncoderFrameSettingsSetOption(settings, JXL_ENC_FRAME_SETTING_KEEP_INVISIBLE, 1);
  JxlEncoderSetFrameDistance(settings, JxlEncoderDistanceFromQuality(quality * 100));
  JxlEncoderSetFrameLossless(settings, lossless);
  JxlEncoderSetExtraChannelDistance(settings, 0, 0);
  JxlPixelFormat format = {4, (sample == 1 || sample == 3) ? JXL_TYPE_UINT16 : sample == 2 ? JXL_TYPE_FLOAT : JXL_TYPE_UINT8, JXL_LITTLE_ENDIAN, 0};
  if (JxlEncoderAddImageFrame(settings, &format, pixels, length) != JXL_ENC_SUCCESS) return fail("JPEG XL pixels were refused or exceeded the memory budget.");
  return finishEncode(enc);
}
int lj_recompress(const uint8_t* bytes, size_t length, int effort) {
  lj_reset();
  if (length > OUTPUT_LIMIT || effort < 1 || effort > 7) return fail("Invalid JPEG recompression input.");
  auto* enc = JxlEncoderCreate(&memory);
  if (!enc) return fail("JPEG XL encoder allocation failed.");
  struct Cleanup { JxlEncoder* p; ~Cleanup() { JxlEncoderDestroy(p); } } cleanup{enc};
  JxlEncoderUseContainer(enc, JXL_TRUE); JxlEncoderStoreJPEGMetadata(enc, JXL_TRUE);
  auto* settings = JxlEncoderFrameSettingsCreate(enc, nullptr);
  JxlEncoderFrameSettingsSetOption(settings, JXL_ENC_FRAME_SETTING_EFFORT, effort);
  if (JxlEncoderAddJPEGFrame(settings, bytes, length) != JXL_ENC_SUCCESS) return fail("This JPEG cannot be stored with original-byte reconstruction.");
  return finishEncode(enc);
}
}
