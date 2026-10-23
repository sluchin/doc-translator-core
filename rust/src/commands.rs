// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 画面 (フロントエンド) から呼ぶコマンドの本体. Tauri に依存する部分 (`State` や `AppHandle` を受け取る
//! 関数, 保存の画面, Drive への共有) は `lib.rs` に薄く置いて, ここでは, アプリの状態 ([`AppState`]) を
//! 受け取る普通の関数にする.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::docs::{self, Kind, Site};
use crate::free::{self, GoogleFree};
use crate::logging;
use crate::plain::{PlainBackend, PlainTranslator};
use crate::settings::{Provider, Settings, Update, View};
use crate::translate::{self, Backend, Cache, GeminiBackend, GoogleBackend};

/// キャッシュのファイルの名前.
pub const CACHE_FILE: &str = "translation-cache.json";

/// 翻訳の API の送り先 (テストでは, テスト用のサーバーにする).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    /// Google Cloud Translation.
    pub google: String,
    /// Gemini のモデルの一覧.
    pub gemini: String,
    /// 無料の Google 翻訳.
    pub free: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            google: translate::GOOGLE_URL.to_string(),
            gemini: translate::GEMINI_URL.to_string(),
            free: free::FREE_URL.to_string(),
        }
    }
}

/// アプリの状態.
pub struct AppState {
    /// 設定と翻訳のキャッシュを保存するディレクトリ.
    pub dir: PathBuf,
    /// 取得するサイト.
    pub site: Site,
    /// 設定.
    pub settings: Mutex<Settings>,
    /// 翻訳のキャッシュ.
    pub cache: Mutex<Cache>,
    /// キャッシュの保存を, 待っているか (待っている間は, 新しく予約しない).
    pub save_pending: AtomicBool,
    /// ページの取得に使う HTTP クライアント (リダイレクトは, ドキュメントのホストの中だけ).
    pub client: reqwest::Client,
    /// 翻訳の API に使う HTTP クライアント (リダイレクトは, たどらない).
    pub api_client: reqwest::Client,
    /// 翻訳の API の送り先.
    pub endpoints: Endpoints,
}

impl AppState {
    /// アプリの状態を作る (設定と, 保存したキャッシュを読む. キャッシュが読めなければ, 空).
    ///
    /// # Arguments
    ///
    /// * `site` - 取得するサイト.
    /// * `dir` - 設定と翻訳のキャッシュを保存するディレクトリ.
    ///
    /// # Returns
    ///
    /// アプリの状態. HTTP クライアントを作れなければ, エラー.
    pub fn new(site: Site, dir: PathBuf) -> Result<Self, String> {
        let cache = std::fs::read_to_string(dir.join(CACHE_FILE))
            .map(|text| translate::load_cache(&text))
            .unwrap_or_else(|_| translate::load_cache("[]"));
        Ok(Self {
            settings: Mutex::new(Settings::load(&dir)),
            cache: Mutex::new(cache),
            save_pending: AtomicBool::new(false),
            client: docs::build_client(site)?,
            api_client: docs::build_api_client(site)?,
            endpoints: Endpoints::default(),
            site,
            dir,
        })
    }
}

/// ドキュメントのサイトのテキスト (ページの HTML, JSON, CSS) を取得する.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `url` - URL.
/// * `kind` - 種類.
///
/// # Returns
///
/// テキスト. ホストが違うか, 取得できなければ, エラー.
pub async fn fetch(state: &AppState, url: &str, kind: Kind) -> Result<String, String> {
    log::debug!("Fetching {}", url);
    docs::fetch_text(&state.client, state.site, url, kind)
        .await
        .inspect_err(|e| log::warn!("Could not fetch {}: {}", url, e))
}

/// ML Kit が動くかを確かめる (短い文章を翻訳する).
///
/// # Arguments
///
/// * `mlkit` - ML Kit.
/// * `available` - ML Kit が使えるか (Android だけ).
///
/// # Returns
///
/// 翻訳した文章.
pub async fn check_mlkit(mlkit: &impl PlainTranslator, available: bool) -> Result<String, String> {
    if !available {
        return Err(mlkit_unavailable());
    }
    let sample = ["Hello, world".to_string()];

    Ok(mlkit.translate_plain(&sample).await?.join(" "))
}

/// ML Kit が使えないときのエラー.
fn mlkit_unavailable() -> String {
    "ML Kit is available only on Android".to_string()
}

/// 翻訳の結果.
#[derive(Debug)]
pub struct Translated {
    /// 翻訳した文章, またはエラー.
    pub result: Result<Vec<String>, String>,
    /// キャッシュが変わったか (変わったら, 保存する. 失敗しても, それまでに翻訳できた分は入っている).
    pub changed: bool,
}

/// 文章 (HTML の断片) を日本語に翻訳する. 同じ文章は, キャッシュから返す.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `mlkit` - ML Kit.
/// * `mlkit_available` - ML Kit が使えるか (Android だけ).
/// * `texts` - 文章.
/// * `scope` - キャッシュを分ける範囲 (ドキュメントの版など).
/// * `fresh` - キャッシュにある文章も, 翻訳し直すか.
///
/// # Returns
///
/// 翻訳の結果.
pub async fn translate(
    state: &AppState,
    mlkit: impl PlainTranslator + Sync,
    mlkit_available: bool,
    texts: &[String],
    scope: Option<&str>,
    fresh: bool,
) -> Translated {
    let (provider, key, model, parallel) = {
        let settings = match state.settings.lock() {
            Ok(settings) => settings,
            Err(e) => return unchanged(Err(e.to_string())),
        };
        let Some(key) = settings.key_for_provider() else {
            return unchanged(Err("NO_API_KEY".to_string()));
        };
        (
            settings.provider,
            key.to_string(),
            settings.gemini_model.clone(),
            settings.free_parallel,
        )
    };
    let client = state.api_client.clone();
    // キャッシュを分ける名前 (サービスと, Gemini のモデルと, ドキュメントの版)
    let namespace = translate::scoped_namespace(&provider.namespace(&model), scope);
    // 無料の Google 翻訳は, 同時に送る数ずつキャッシュに入れる (断られても, 翻訳できた分を捨てない)
    let batch = if provider == Provider::Googlefree {
        free::clamp_parallel(parallel)
    } else {
        usize::MAX
    };
    let endpoints = &state.endpoints;
    let result = match provider {
        Provider::Google => {
            let backend = GoogleBackend::with_url(client, key, &endpoints.google);
            translate_with(state, &namespace, &backend, texts, batch, fresh).await
        }
        Provider::Gemini => {
            let backend = GeminiBackend::with_base(client, key, model, &endpoints.gemini);
            translate_with(state, &namespace, &backend, texts, batch, fresh).await
        }
        Provider::Googlefree => {
            let backend =
                PlainBackend::new(GoogleFree::with_url(client, parallel, &endpoints.free));
            translate_with(state, &namespace, &backend, texts, batch, fresh).await
        }
        Provider::Mlkit => {
            if !mlkit_available {
                return unchanged(Err(mlkit_unavailable()));
            }
            let backend = PlainBackend::new(mlkit);
            translate_with(state, &namespace, &backend, texts, batch, fresh).await
        }
    };
    // 失敗しても, それまでに翻訳できた分は, キャッシュに入っているので, 保存する
    let changed = match &result {
        Ok((_, added)) => *added > 0,
        Err(_) => true,
    };

    Translated {
        result: result.map(|(results, _)| results),
        changed,
    }
}

/// キャッシュを変えなかった結果.
fn unchanged(result: Result<Vec<String>, String>) -> Translated {
    Translated {
        result,
        changed: false,
    }
}

/// バックエンドとキャッシュで翻訳する (`batch` 個ずつ, キャッシュに入れる).
async fn translate_with<B: Backend>(
    state: &AppState,
    namespace: &str,
    backend: &B,
    texts: &[String],
    batch: usize,
    fresh: bool,
) -> Result<(Vec<String>, usize), String> {
    translate::translate_with_cache(&state.cache, backend, namespace, texts, batch, fresh).await
}

/// キャッシュを保存する (保存の予約を外してから, 写しを作って書く. 書いている間に増えた分は, 次の予約で書く).
///
/// # Arguments
///
/// * `state` - アプリの状態.
///
/// # Returns
///
/// 書けなければ, エラー.
pub fn save_cache(state: &AppState) -> Result<(), String> {
    state.save_pending.store(false, Ordering::Release);
    let snapshot = cache_snapshot(state)?;
    write_cache(&state.dir, &snapshot)
}

/// キャッシュの写しを, ファイルに書く.
///
/// # Arguments
///
/// * `dir` - 保存するディレクトリ.
/// * `snapshot` - キャッシュの写し.
///
/// # Returns
///
/// 書けなければ, エラー.
pub fn write_cache(dir: &Path, snapshot: &[(String, String)]) -> Result<(), String> {
    std::fs::write(dir.join(CACHE_FILE), translate::entries_to_json(snapshot))
        .map_err(|e| e.to_string())
}

/// キャッシュの写しを作る (書き出しと保存は, 写しを使って, ロックの外で行う).
///
/// # Arguments
///
/// * `state` - アプリの状態.
///
/// # Returns
///
/// キャッシュの項目.
pub fn cache_snapshot(state: &AppState) -> Result<Vec<(String, String)>, String> {
    Ok(state.cache.lock().map_err(|e| e.to_string())?.snapshot())
}

/// 書き出したキャッシュ (JSON) を, 端末のキャッシュに足し合わせる.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `text` - 書き出したキャッシュ.
///
/// # Returns
///
/// 新しく足した翻訳の数.
pub fn merge_cache(state: &AppState, text: &str) -> Result<usize, String> {
    state
        .cache
        .lock()
        .map_err(|e| e.to_string())?
        .merge_json(text)
}

/// アプリのログの末尾を返す (ローテート済みのファイルも含めて, [`logging::MAX_READ_BYTES`] まで).
///
/// # Arguments
///
/// * `state` - アプリの状態.
///
/// # Returns
///
/// ログの末尾.
pub fn read_log(state: &AppState) -> Result<String, String> {
    logging::read_tail(
        &logging::log_path(&state.dir),
        logging::MAX_BACKUPS,
        logging::MAX_READ_BYTES,
    )
    .map_err(|e| e.to_string())
}

/// アプリのログを消す.
///
/// # Arguments
///
/// * `state` - アプリの状態.
///
/// # Returns
///
/// 消せなければ, エラー.
pub fn clear_log(state: &AppState) -> Result<(), String> {
    logging::clear_logs(&logging::log_path(&state.dir), logging::MAX_BACKUPS)
        .map_err(|e| e.to_string())?;
    log::info!("Cleared the log");

    Ok(())
}

/// 書き出すログ (全体. 最大で約 20 MB). 読めなければ, その理由.
///
/// # Arguments
///
/// * `dir` - アプリのデータのディレクトリ.
///
/// # Returns
///
/// ログの文字列.
pub fn log_for_export(dir: &Path) -> String {
    let max = logging::MAX_LOG_BYTES * u64::from(logging::MAX_BACKUPS + 1);
    logging::read_tail(&logging::log_path(dir), logging::MAX_BACKUPS, max)
        .unwrap_or_else(|e| e.to_string())
}

/// キャッシュにある翻訳を返す (通信しない. 今のサービスのキャッシュ. ない文章は, null).
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `texts` - 文章.
/// * `scope` - キャッシュを分ける範囲.
///
/// # Returns
///
/// 文章ごとの翻訳.
pub fn lookup_cache(
    state: &AppState,
    texts: &[String],
    scope: Option<&str>,
) -> Result<Vec<Option<String>>, String> {
    let namespace = {
        let settings = state.settings.lock().map_err(|e| e.to_string())?;
        translate::scoped_namespace(&settings.provider.namespace(&settings.gemini_model), scope)
    };

    translate::lookup_cache(&state.cache, &namespace, texts)
}

/// 設定を返す (API キーそのものは, 画面に返さない).
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `mlkit_available` - ML Kit が使えるか.
///
/// # Returns
///
/// 設定.
pub fn get_settings(state: &AppState, mlkit_available: bool) -> Result<View, String> {
    Ok(state
        .settings
        .lock()
        .map_err(|e| e.to_string())?
        .view(mlkit_available))
}

/// 設定を変えて保存する.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `update` - 変更.
/// * `mlkit_available` - ML Kit が使えるか.
///
/// # Returns
///
/// 変えたあとの設定.
pub fn set_settings(
    state: &AppState,
    update: &Update,
    mlkit_available: bool,
) -> Result<View, String> {
    let mut settings = state.settings.lock().map_err(|e| e.to_string())?;
    if update.provider == Provider::Mlkit && !mlkit_available {
        return Err(mlkit_unavailable());
    }
    settings.apply(update);
    settings.save(&state.dir)?;

    Ok(settings.view(mlkit_available))
}
