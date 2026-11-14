// このプラグインは, Rust から直接呼ぶ (画面からは呼ばない) のでコマンドはない.
fn main() {
    tauri_plugin::Builder::new(&[])
        .android_path("android")
        .build();
}
