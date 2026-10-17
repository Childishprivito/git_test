mod app;
mod off;
mod photo;
mod scanner;
mod server;
mod store;

pub use foodlog_core::model;

fn main() {
    console_error_panic_hook::set_once();
    leptos::mount::mount_to_body(app::App);
}
