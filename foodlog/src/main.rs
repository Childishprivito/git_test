mod app;
mod model;
mod off;
mod scanner;
mod store;

fn main() {
    console_error_panic_hook::set_once();
    leptos::mount::mount_to_body(app::App);
}
