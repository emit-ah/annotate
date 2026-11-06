//! The check of a picture before the service keeps it (ADR-0001): a PNG whose header promises no more pixels than the
//! service takes, read without its pixels and within a small budget of memory.

/// The most pixels a picture has on either side.
pub(crate) const MAX_PICTURE_SIDE: u32 = 16_384;
/// The most pixels a picture has: a window of 8K at twice its pixel ratio would have about 33 million.
pub(crate) const MAX_PICTURE_PIXELS: u64 = 40_000_000;
/// The most bytes the check of a picture's header holds in memory, far below the service's limit.
const PNG_CHECK_BYTES: usize = 1 << 20;

/// Whether `bytes` begin as a PNG with sides of at most [`MAX_PICTURE_SIDE`] pixels and at most
/// [`MAX_PICTURE_PIXELS`] in all; why not. Only its header is read, within [`PNG_CHECK_BYTES`], past its colour profile
/// and texts, so no picture can make the check take the service's memory.
pub(crate) fn check_png(bytes: &[u8]) -> Result<(), String> {
    let mut decoder = png::Decoder::new_with_limits(
        std::io::Cursor::new(bytes),
        png::Limits {
            bytes: PNG_CHECK_BYTES,
        },
    );
    decoder.set_ignore_iccp_chunk(true);
    decoder.set_ignore_text_chunk(true);
    let reader = decoder.read_info().map_err(|_| "is no PNG".to_owned())?;
    let info = reader.info();
    if info.width > MAX_PICTURE_SIDE || info.height > MAX_PICTURE_SIDE {
        return Err(format!(
            "is larger than {MAX_PICTURE_SIDE} pixels on a side"
        ));
    }
    if u64::from(info.width) * u64::from(info.height) > MAX_PICTURE_PIXELS {
        return Err(format!("has more than {MAX_PICTURE_PIXELS} pixels"));
    }
    Ok(())
}
