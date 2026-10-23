// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

use serde::de::DeserializeOwned;
use tauri::{
    AppHandle, Runtime,
    plugin::{PluginApi, PluginHandle},
};

use crate::models::{ShareRequest, ShareResponse, TranslateRequest, TranslateResponse};

#[cfg(target_os = "ios")]
compile_error!("This plugin supports Android only");

/// Kotlin のプラグインクラスを登録する.
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Mlkit<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("jp.doctranslator.mlkit", "MlKitPlugin")?;
    Ok(Mlkit(handle))
}

/// ML Kit の翻訳 (Kotlin のプラグインを呼ぶ).
pub struct Mlkit<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Mlkit<R> {
    /// 文章 (英語のテキスト) を, 端末の中で日本語に翻訳する. 初めてのときは, 翻訳のモデルを取得する.
    pub async fn translate(&self, texts: Vec<String>) -> crate::Result<Vec<String>> {
        let response: TranslateResponse = self
            .0
            .run_mobile_plugin_async("translate", TranslateRequest { texts })
            .await?;

        Ok(response.texts)
    }

    /// ファイルを, Google Drive のアプリの「ドライブに保存」の画面に渡す (Drive がなければ, 共有先の一覧).
    ///
    /// ファイルは, アプリのキャッシュのディレクトリに置く (Android の `FileProvider` が, そこだけを渡せる).
    pub async fn share_to_drive(&self, path: String) -> crate::Result<()> {
        let _: ShareResponse = self
            .0
            .run_mobile_plugin_async("shareToDrive", ShareRequest { path })
            .await?;

        Ok(())
    }
}
