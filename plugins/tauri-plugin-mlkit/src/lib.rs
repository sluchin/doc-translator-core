// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! ML Kit (Android) でテキストを端末の中で翻訳する, Tauri のプラグイン.
//!
//! Rust (アプリ) から [`MlkitExt::mlkit`] で呼ぶ. 画面 (WebView) からは, 呼べない.
//! Android 以外 (PC) では, 翻訳は [`Error::Unsupported`] で失敗する.

use tauri::{
    Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod error;
#[cfg(mobile)]
mod models;

#[cfg(desktop)]
use desktop::Mlkit;
#[cfg(mobile)]
use mobile::Mlkit;

pub use error::{Error, Result};

/// [`tauri::App`] と [`tauri::AppHandle`] から, ML Kit を使うための拡張.
pub trait MlkitExt<R: Runtime> {
    /// ML Kit の翻訳.
    fn mlkit(&self) -> &Mlkit<R>;
}

impl<R: Runtime, T: Manager<R>> MlkitExt<R> for T {
    fn mlkit(&self) -> &Mlkit<R> {
        self.state::<Mlkit<R>>().inner()
    }
}

/// プラグインを初期化する.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mlkit")
        .setup(|app, api| {
            #[cfg(mobile)]
            let mlkit = mobile::init(app, api)?;
            #[cfg(desktop)]
            let mlkit = desktop::init(app, api)?;
            app.manage(mlkit);
            Ok(())
        })
        .build()
}
