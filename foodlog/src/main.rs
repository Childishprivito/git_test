mod app;
mod off;
mod photo;
mod scanner;
mod server;
mod store;
mod workout_ui;

pub use foodlog_core::model;

fn main() {
    console_error_panic_hook::set_once();
    leptos::mount::mount_to_body(app::App);
}
