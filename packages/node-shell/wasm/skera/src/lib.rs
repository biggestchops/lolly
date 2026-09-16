// SPDX-License-Identifier: MPL-2.0
//! Small byte ABI around the unmodified Skera library. The caller owns buffers.
use skera::{subset_font, Plan, SubsetFlags};
use write_fonts::read::{collections::IntSet, types::{GlyphId, NameId, Tag}, FontRef};

const MAX_BYTES: usize = 32 * 1024 * 1024;

#[no_mangle]
pub extern "C" fn lolly_subset_alloc(len: usize) -> *mut u8 {
    if len > MAX_BYTES { return std::ptr::null_mut(); }
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}

/// Buffers and lengths must be the values returned by alloc or subset.
#[no_mangle]
pub unsafe extern "C" fn lolly_subset_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() { drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len))); }
}

/// Returns pointer in the high 32 bits, length in the low 32 bits; zero on failure.
/// Glyph ids remain unchanged because PDF Identity-H content addresses them directly.
#[no_mangle]
pub unsafe extern "C" fn lolly_subset_font(ptr: *const u8, len: usize, gids_ptr: *const u8, count: usize) -> u64 {
    if len > MAX_BYTES || count > 65536 || ptr.is_null() || gids_ptr.is_null() { return 0; }
    let bytes = std::slice::from_raw_parts(ptr, len);
    let Ok(font) = FontRef::new(bytes) else { return 0; };
    let gids_bytes = std::slice::from_raw_parts(gids_ptr, count * 4);
    let gids: IntSet<GlyphId> = gids_bytes.chunks_exact(4)
        .map(|b| GlyphId::new(u32::from_le_bytes(b.try_into().unwrap())))
        .collect();
    let flags = SubsetFlags::SUBSET_FLAGS_RETAIN_GIDS | SubsetFlags::SUBSET_FLAGS_NOTDEF_OUTLINE;
    let plan = Plan::new(&gids, &IntSet::empty(), &font, flags,
        &IntSet::<Tag>::empty(), &IntSet::<Tag>::all(), &IntSet::<Tag>::all(),
        &IntSet::<NameId>::all(), &IntSet::<u16>::all());
    let Ok(output) = subset_font(&font, &plan) else { return 0; };
    if output.len() > MAX_BYTES { return 0; }
    let len = output.len();
    let ptr = Box::into_raw(output.into_boxed_slice()) as *mut u8;
    ((ptr as u64) << 32) | len as u64
}
