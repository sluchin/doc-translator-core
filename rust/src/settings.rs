// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 設定 (翻訳サービスの選択と, API キー). アプリ専用のディレクトリのファイルに保存する.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::free::{DEFAULT_PARALLEL, clamp_parallel};

/// 設定のファイルの名前.
pub const FILE_NAME: &str = "settings.json";

/// Gemini の既定のモデル (最新の Flash を指す別名).
pub const DEFAULT_GEMINI_MODEL: &str = "gemini-flash-latest";

/// 翻訳に使うサービス.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    /// Google Cloud Translation (Basic, v2).
    Google,
    /// Gemini API.
    Gemini,
    /// ML Kit (Android の端末の中で翻訳する. オフライン).
    Mlkit,
    /// 無料の Google 翻訳 (非公式の入口. キーは要らない. 既定).
    #[default]
    Googlefree,
}

impl Provider {
    /// 翻訳のキャッシュを分ける名前 (サービスが違えば、翻訳も違う).
    pub fn name(self) -> &'static str {
        match self {
            Provider::Google => "google",
            Provider::Gemini => "gemini",
            Provider::Mlkit => "mlkit",
            Provider::Googlefree => "googlefree",
        }
    }
}

impl Provider {
    /// 翻訳のキャッシュを分ける名前 (Gemini は, モデルが違えば、翻訳も違うので、モデルの名前も入れる).
    pub fn namespace(self, gemini_model: &str) -> String {
        match self {
            Provider::Gemini => format!("{}:{}", self.name(), gemini_model),
            _ => self.name().to_string(),
        }
    }
}

/// 設定.
#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// 翻訳に使うサービス.
    pub provider: Provider,
    /// Google Cloud Translation の API キー (まだ入れていなければ None. 画面で消したら, 空).
    pub api_key: Option<String>,
    /// Gemini API のキー (まだ入れていなければ None. 画面で消したら, 空).
    pub gemini_key: Option<String>,
    /// Gemini のモデル.
    pub gemini_model: String,
    /// 無料の Google 翻訳に、同時に送る依頼の数.
    pub free_parallel: usize,
}

/// ビルドのときに, 環境変数 `GOOGLE_CLOUD_TRANSLATION_API_KEY` に入っていた, Google の API キー (なければ None).
///
/// キーは, アプリの実行ファイルに入る (取り出せる) ので, 自分で使うビルドだけで使う (配るビルドでは, 設定しない).
const BUILD_GOOGLE_KEY: Option<&str> = option_env!("GOOGLE_CLOUD_TRANSLATION_API_KEY");

/// ビルドのときに, 環境変数 `GEMINI_API_KEY` に入っていた, Gemini の API キー (なければ None).
const BUILD_GEMINI_KEY: Option<&str> = option_env!("GEMINI_API_KEY");

impl Default for Settings {
    /// 既定の設定 (API キーは, ビルドのときの環境変数にあれば, それ).
    fn default() -> Self {
        Self::with_keys(BUILD_GOOGLE_KEY, BUILD_GEMINI_KEY)
    }
}

/// 画面から受け取る設定の変更. キーは、None なら変えず、空の文字列なら消す.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    /// 翻訳に使うサービス.
    pub provider: Provider,
    /// Google の API キー.
    pub google_key: Option<String>,
    /// Gemini の API キー.
    pub gemini_key: Option<String>,
    /// Gemini のモデル (空なら既定).
    pub gemini_model: String,
    /// 無料の Google 翻訳に、同時に送る依頼の数 (None なら変えない).
    #[serde(default)]
    pub free_parallel: Option<usize>,
}

/// 画面に返す設定 (キーそのものは返さない).
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    /// 翻訳に使うサービス.
    pub provider: Provider,
    /// Google の API キーが設定されているか.
    pub has_google_key: bool,
    /// Gemini の API キーが設定されているか.
    pub has_gemini_key: bool,
    /// Gemini のモデル.
    pub gemini_model: String,
    /// 無料の Google 翻訳に、同時に送る依頼の数.
    pub free_parallel: usize,
    /// ML Kit が使えるか (Android だけ).
    pub mlkit_available: bool,
}

/// キーの変更を適用する (None なら変えない. 空白だけなら消す).
///
/// 消したキーは, None ではなく, 空の文字列にする (None は, まだ入れていないキー. 読むときに,
/// ビルドのときのキーを入れる. 消したキーには, 入れない).
fn apply_key(current: &mut Option<String>, change: &Option<String>) {
    if let Some(value) = change {
        *current = Some(value.trim().to_string());
    }
}

/// 使えるキー (まだ入れていないか, 消したキーは None).
fn usable(key: &Option<String>) -> Option<&str> {
    key.as_deref().filter(|value| !value.is_empty())
}

impl Settings {
    /// API キーの初期値を決めた, 既定の設定を作る (空白だけのキーは, ないものとする).
    ///
    /// 保存した設定にキーの項目がなければ, この初期値になる. 画面でキーを消したときは, 消したまま (空) になる.
    pub fn with_keys(google: Option<&str>, gemini: Option<&str>) -> Self {
        let key = |value: Option<&str>| {
            value
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string)
        };
        Self {
            provider: Provider::default(),
            api_key: key(google),
            gemini_key: key(gemini),
            gemini_model: DEFAULT_GEMINI_MODEL.to_string(),
            free_parallel: DEFAULT_PARALLEL,
        }
    }

    /// ディレクトリの設定を読む (なければ, 読めなければ, 既定).
    ///
    /// まだ入れていないキー (None) は, ビルドのときのキーにする (前の版で保存した設定や, Android の
    /// バックアップから戻った設定でも, ビルドのときのキーを使う).
    pub fn load(dir: &Path) -> Self {
        Self::load_with_keys(dir, BUILD_GOOGLE_KEY, BUILD_GEMINI_KEY)
    }

    /// ディレクトリの設定を読んで, まだ入れていないキーを, 与えたキーにする ([Self::load] の中身).
    pub fn load_with_keys(dir: &Path, google: Option<&str>, gemini: Option<&str>) -> Self {
        let initial = Self::with_keys(google, gemini);
        let mut settings: Self = fs::read_to_string(dir.join(FILE_NAME))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_else(|| Self::with_keys(google, gemini));
        if settings.api_key.is_none() {
            settings.api_key = initial.api_key;
        }
        if settings.gemini_key.is_none() {
            settings.gemini_key = initial.gemini_key;
        }

        settings
    }

    /// ディレクトリに設定を書く.
    pub fn save(&self, dir: &Path) -> Result<(), String> {
        let text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        fs::write(dir.join(FILE_NAME), text).map_err(|e| e.to_string())
    }

    /// 変更を適用する.
    pub fn apply(&mut self, update: &Update) {
        self.provider = update.provider;
        apply_key(&mut self.api_key, &update.google_key);
        apply_key(&mut self.gemini_key, &update.gemini_key);
        let model = update.gemini_model.trim();
        self.gemini_model = if model.is_empty() {
            DEFAULT_GEMINI_MODEL.to_string()
        } else {
            model.to_string()
        };
        if let Some(parallel) = update.free_parallel {
            self.free_parallel = clamp_parallel(parallel);
        }
    }

    /// 選んだサービスの API キー (ML Kit は、キーが要らないので、空の文字列).
    pub fn key_for_provider(&self) -> Option<&str> {
        match self.provider {
            Provider::Google => usable(&self.api_key),
            Provider::Gemini => usable(&self.gemini_key),
            Provider::Mlkit | Provider::Googlefree => Some(""),
        }
    }

    /// 画面に返す形にする.
    pub fn view(&self, mlkit_available: bool) -> View {
        View {
            provider: self.provider,
            has_google_key: usable(&self.api_key).is_some(),
            has_gemini_key: usable(&self.gemini_key).is_some(),
            gemini_model: self.gemini_model.clone(),
            free_parallel: clamp_parallel(self.free_parallel),
            mlkit_available,
        }
    }
}
