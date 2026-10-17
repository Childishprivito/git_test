//! Shrinking a photo before sending it to the AI (smaller = faster and cheaper).

use foodlog_core::estimate::Image;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement, ImageBitmap};

/// Longest side in pixels. Plenty to read a nutrition label.
const MAX_SIDE: f64 = 1568.0;

pub async fn prepare(file: web_sys::File) -> Result<Image, String> {
    fn fail<T>(_: T) -> String {
        "Couldn't read that photo.".to_string()
    }
    let window = web_sys::window().ok_or("no window")?;
    let bitmap: ImageBitmap =
        JsFuture::from(window.create_image_bitmap_with_blob(&file).map_err(fail)?)
            .await
            .map_err(fail)?
            .dyn_into()
            .map_err(fail)?;
    let (w, h) = (bitmap.width() as f64, bitmap.height() as f64);
    let scale = (MAX_SIDE / w.max(h)).min(1.0);
    let (dw, dh) = ((w * scale).round(), (h * scale).round());

    let canvas: HtmlCanvasElement = window
        .document()
        .ok_or("no document")?
        .create_element("canvas")
        .map_err(fail)?
        .dyn_into()
        .map_err(fail)?;
    canvas.set_width(dw as u32);
    canvas.set_height(dh as u32);
    let ctx: CanvasRenderingContext2d = canvas
        .get_context("2d")
        .map_err(fail)?
        .ok_or("no canvas")?
        .dyn_into()
        .map_err(fail)?;
    ctx.draw_image_with_image_bitmap_and_dw_and_dh(&bitmap, 0.0, 0.0, dw, dh)
        .map_err(fail)?;
    bitmap.close();

    let url = canvas
        .to_data_url_with_type_and_encoder_options("image/jpeg", &0.85.into())
        .map_err(fail)?;
    let data = url
        .split_once(',')
        .map(|(_, d)| d.to_string())
        .ok_or("Couldn't read that photo.")?;
    Ok(Image {
        media_type: "image/jpeg".into(),
        data,
    })
}
