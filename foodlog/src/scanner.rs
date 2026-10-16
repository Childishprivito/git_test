//! Camera barcode scanner. The camera feed is read in the browser, and the
//! barcode is decoded in Rust with `rxing` (works on iPhone, unlike the
//! browser's own BarcodeDetector).

use std::{cell::RefCell, collections::HashSet, rc::Rc};

use leptos::{prelude::*, task::spawn_local};
use rxing::{BarcodeFormat, DecodeHints};
use send_wrapper::SendWrapper;
use wasm_bindgen::{JsCast, prelude::*};
use wasm_bindgen_futures::JsFuture;
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement, HtmlVideoElement, MediaStream};

/// Convert RGBA pixels to greyscale (one byte per pixel).
pub fn rgba_to_luma(rgba: &[u8]) -> Vec<u8> {
    rgba.chunks_exact(4)
        .map(|p| ((p[0] as u32 * 77 + p[1] as u32 * 150 + p[2] as u32 * 29) >> 8) as u8)
        .collect()
}

/// Try to read a grocery barcode (EAN/UPC) from a greyscale image.
pub fn decode_luma(luma: Vec<u8>, width: u32, height: u32) -> Option<String> {
    let mut hints = DecodeHints::default();
    hints.PossibleFormats = Some(HashSet::from([
        BarcodeFormat::EAN_13,
        BarcodeFormat::EAN_8,
        BarcodeFormat::UPC_A,
        BarcodeFormat::UPC_E,
    ]));
    rxing::helpers::detect_in_luma_with_hints(luma, width, height, None, &mut hints)
        .ok()
        .map(|r| r.getText().to_string())
}

#[derive(Default)]
struct ScanState {
    stream: Option<MediaStream>,
    interval: Option<i32>,
    tick: Option<Closure<dyn FnMut()>>,
    last_read: Option<String>,
    stopped: bool,
}

fn stop(state: &RefCell<ScanState>) {
    let mut s = state.borrow_mut();
    s.stopped = true;
    if let (Some(id), Some(w)) = (s.interval.take(), web_sys::window()) {
        w.clear_interval_with_handle(id);
    }
    if let Some(stream) = s.stream.take() {
        for t in stream.get_tracks().iter() {
            t.unchecked_into::<web_sys::MediaStreamTrack>().stop();
        }
    }
}

#[component]
pub fn Scanner(on_detect: Callback<String>, on_close: Callback<()>) -> impl IntoView {
    let video_ref = NodeRef::<leptos::html::Video>::new();
    let error = RwSignal::new(None::<String>);
    let state = Rc::new(RefCell::new(ScanState::default()));

    // Turn the camera off when the scanner closes.
    let for_cleanup = SendWrapper::new(state.clone());
    on_cleanup(move || stop(&for_cleanup));

    Effect::new(move |_| {
        if let Some(video) = video_ref.get() {
            let state = state.clone();
            spawn_local(async move {
                if let Err(e) = start(video, state, on_detect).await {
                    let msg = e.as_string().unwrap_or_else(|| {
                        js_sys::Reflect::get(&e, &"name".into())
                            .ok()
                            .and_then(|n| n.as_string())
                            .unwrap_or_default()
                    });
                    error.set(Some(if msg.contains("NotAllowed") {
                        "Camera access was blocked. Allow it in Settings › Safari › Camera (or for this app), then try again.".into()
                    } else {
                        format!("Couldn't start the camera ({msg}). You can type the barcode number instead.")
                    }));
                }
            });
        }
    });

    view! {
        <div class="scanner" role="dialog" aria-modal="true" aria-label="Barcode scanner">
            <video node_ref=video_ref autoplay muted playsinline aria-hidden="true"></video>
            <div class="scan-window" aria-hidden="true"></div>
            <p class="scan-hint" role="status">
                {move || error.get().unwrap_or_else(|| "Line the barcode up inside the box".into())}
            </p>
            <button class="btn scan-close" on:click=move |_| on_close.run(())>"Close scanner"</button>
        </div>
    }
}

async fn start(
    video: HtmlVideoElement,
    state: Rc<RefCell<ScanState>>,
    on_detect: Callback<String>,
) -> Result<(), JsValue> {
    let window = web_sys::window().ok_or("no window")?;
    let devices = window.navigator().media_devices()?;

    let video_opts = js_sys::Object::new();
    let facing = js_sys::Object::new();
    js_sys::Reflect::set(&facing, &"ideal".into(), &"environment".into())?;
    js_sys::Reflect::set(&video_opts, &"facingMode".into(), &facing)?;
    let width = js_sys::Object::new();
    js_sys::Reflect::set(&width, &"ideal".into(), &1280.into())?;
    js_sys::Reflect::set(&video_opts, &"width".into(), &width)?;
    let constraints = web_sys::MediaStreamConstraints::new();
    constraints.set_video(&video_opts);
    constraints.set_audio(&false.into());

    let stream: MediaStream =
        JsFuture::from(devices.get_user_media_with_constraints(&constraints)?)
            .await?
            .dyn_into()?;

    // The scanner may have been closed while we waited for permission.
    if state.borrow().stopped {
        state.borrow_mut().stream = Some(stream);
        stop(&state);
        return Ok(());
    }

    video.set_src_object(Some(&stream));
    let _ = video.play();
    state.borrow_mut().stream = Some(stream);

    let canvas: HtmlCanvasElement = window
        .document()
        .ok_or("no document")?
        .create_element("canvas")?
        .dyn_into()?;
    let opts = js_sys::Object::new();
    js_sys::Reflect::set(&opts, &"willReadFrequently".into(), &true.into())?;
    let ctx: CanvasRenderingContext2d = canvas
        .get_context_with_context_options("2d", &opts)?
        .ok_or("no 2d canvas")?
        .dyn_into()?;

    let tick_state = state.clone();
    let tick = Closure::<dyn FnMut()>::new(move || {
        if tick_state.borrow().stopped || video.ready_state() < 2 {
            return;
        }
        let Some(code) = read_frame(&video, &canvas, &ctx) else {
            return;
        };
        // Require the same number twice in a row to avoid misreads.
        let confirmed = {
            let mut s = tick_state.borrow_mut();
            let same = s.last_read.as_deref() == Some(code.as_str());
            s.last_read = Some(code.clone());
            same
        };
        if confirmed {
            stop(&tick_state);
            // Report after this tick returns, so the scanner isn't torn down mid-callback.
            spawn_local(async move { on_detect.run(code) });
        }
    });
    let id = window.set_interval_with_callback_and_timeout_and_arguments_0(
        tick.as_ref().unchecked_ref(),
        150,
    )?;
    let mut s = state.borrow_mut();
    s.interval = Some(id);
    s.tick = Some(tick);
    Ok(())
}

/// Grab the middle band of the current video frame and try to decode it.
fn read_frame(
    video: &HtmlVideoElement,
    canvas: &HtmlCanvasElement,
    ctx: &CanvasRenderingContext2d,
) -> Option<String> {
    let (vw, vh) = (video.video_width() as f64, video.video_height() as f64);
    if vw == 0.0 || vh == 0.0 {
        return None;
    }
    // Middle 50% of the height, full width, scaled to at most 800 px wide.
    let (sh, sy) = (vh * 0.5, vh * 0.25);
    let dw = vw.min(800.0).floor();
    let dh = (sh * dw / vw).floor();
    canvas.set_width(dw as u32);
    canvas.set_height(dh as u32);
    ctx.draw_image_with_html_video_element_and_sw_and_sh_and_dx_and_dy_and_dw_and_dh(
        video, 0.0, sy, vw, sh, 0.0, 0.0, dw, dh,
    )
    .ok()?;
    let data = ctx.get_image_data(0.0, 0.0, dw, dh).ok()?.data();
    decode_luma(rgba_to_luma(&data), dw as u32, dh as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn luma_of_white_and_black() {
        assert_eq!(
            rgba_to_luma(&[255, 255, 255, 255, 0, 0, 0, 255]),
            vec![255, 0]
        );
    }

    /// Draw a real barcode with a white margin, then read it back.
    fn roundtrip(code: &str, format: BarcodeFormat) -> Option<String> {
        use rxing::Writer;
        let m = rxing::MultiFormatWriter
            .encode(code, &format, 600, 160)
            .unwrap();
        let (w, h) = (m.getWidth() + 80, m.getHeight() + 40);
        let mut rgba = Vec::new();
        for y in 0..h {
            for x in 0..w {
                let black = x >= 40 && y >= 20 && x < w - 40 && y < h - 20 && m.get(x - 40, y - 20);
                let v = if black { 20 } else { 235 };
                rgba.extend_from_slice(&[v, v, v, 255]);
            }
        }
        decode_luma(rgba_to_luma(&rgba), w, h)
    }

    #[test]
    fn reads_ean13() {
        assert_eq!(
            roundtrip("5449000000996", BarcodeFormat::EAN_13).as_deref(),
            Some("5449000000996")
        );
    }

    #[test]
    fn reads_upc_a() {
        assert_eq!(
            roundtrip("049000028911", BarcodeFormat::UPC_A).as_deref(),
            Some("049000028911")
        );
    }

    #[test]
    fn blank_image_has_no_barcode() {
        assert_eq!(decode_luma(vec![255; 400 * 100], 400, 100), None);
    }
}
