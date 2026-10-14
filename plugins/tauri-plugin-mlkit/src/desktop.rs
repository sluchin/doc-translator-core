// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

use serde::de::DeserializeOwned;
use tauri::{AppHandle, Runtime, plugin::PluginApi};

/// PC では, ML Kit は使えない.
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Mlkit<R>> {
    Ok(Mlkit(std::marker::PhantomData))
}

/// ML Kit の翻訳 (PC では, 常に失敗する).
pub struct Mlkit<R: Runtime>(std::marker::PhantomData<fn() -> R>);

impl<R: Runtime> Mlkit<R> {
    /// 文章を翻訳する (PC では, 使えない).
    pub async fn translate(&self, _texts: Vec<String>) -> crate::Result<Vec<String>> {
        Err(crate::Error::Unsupported)
    }
}
