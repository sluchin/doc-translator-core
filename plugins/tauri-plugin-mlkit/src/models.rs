// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

use serde::{Deserialize, Serialize};

/// Kotlin 側への翻訳の依頼.
#[derive(Debug, Serialize)]
pub struct TranslateRequest {
    /// 翻訳する文章 (英語のテキスト).
    pub texts: Vec<String>,
}

/// Kotlin 側からの翻訳の結果.
#[derive(Debug, Deserialize)]
pub struct TranslateResponse {
    /// 翻訳された文章 (日本語のテキスト. 依頼と同じ数, 同じ順).
    pub texts: Vec<String>,
}

/// Kotlin 側への, ファイルを Google Drive に渡す依頼.
#[derive(Debug, Serialize)]
pub struct ShareRequest {
    /// 渡すファイルのパス (アプリのキャッシュのディレクトリの中).
    pub path: String,
}
