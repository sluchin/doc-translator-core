// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

use serde::{Serialize, ser::Serializer};

/// プラグインの結果.
pub type Result<T> = std::result::Result<T, Error>;

/// プラグインのエラー.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// この OS では使えない (ML Kit は Android だけ).
    #[error("ML Kit is available only on Android")]
    Unsupported,
    /// Kotlin 側の呼び出しの失敗.
    #[cfg(mobile)]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
