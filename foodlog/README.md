# FoodLog

A personal calorie and macro tracker with a free barcode scanner, written in Rust
([Leptos](https://leptos.dev) compiled to WebAssembly). It installs to your phone's
home screen like a normal app and works offline.

- **Scan barcodes** with the camera. Decoding happens in Rust ([rxing](https://crates.io/crates/rxing)),
  so it works on iPhone too.
- **Food data** from [Open Food Facts](https://world.openfoodfacts.org): free, no API key.
- **Custom foods**: if a barcode isn't found, enter the label once and it's remembered.
- **Diary** by meal with daily calorie/protein/carb/fat goals.
- **USDA search** for generic foods ("banana") and US brands, when the server is set up.
- **Photo search** when a barcode or search finds nothing: snap the front of the package, AI reads
  what it is and looks it up in the databases. Pick the match (its barcode is remembered), or use
  the AI's own estimate (also works for a photo of your plate).
- **Sync** between devices through your own server (`../foodlog-worker`), or keep everything
  on the phone only. Settings › Backup copies it out either way.

## Install on iPhone

1. Open `https://childishprivito.github.io/git_test/` in **Safari**.
2. Tap **Share** → **Add to Home Screen**.
3. Open it from the home screen icon and allow camera access the first time you scan.

## Develop

```sh
rustup target add wasm32-unknown-unknown
cargo install trunk        # or grab a release binary
cd foodlog
trunk serve --open         # http://127.0.0.1:8080, rebuilds on save
cargo test                 # unit tests (model, food parsing, barcode decoding)
```

Pushing to `master` runs the tests, builds, and publishes to GitHub Pages
(`.github/workflows/foodlog.yml`).

## Code map

| File | What it does |
| --- | --- |
| `../foodlog-core` | Shared with the server: foods, diary, sync merge, Open Food Facts/USDA parsing, AI estimate format |
| `src/store.rs` | Saving to the phone (localStorage), dates |
| `src/off.rs` | Open Food Facts barcode lookup and search |
| `src/server.rs` | Talking to your FoodLog server (sync, USDA, AI) |
| `src/photo.rs` | Shrinking photos before they're sent for an AI estimate |
| `src/scanner.rs` | Camera feed → greyscale → rxing barcode decode |
| `src/app.rs` | The screens (Diary, Add food, Settings, amount sheet) |
| `index.html`, `style.css`, `sw.js`, `manifest.webmanifest` | Web app shell, styles, offline cache, home-screen install |

## Accessibility

Real buttons and labels throughout, 44px+ tap targets, screen-reader announcements
for status messages, labelled progress bars, dark mode, and reduced-motion support.
