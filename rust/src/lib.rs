// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! ドキュメントを, 開いたときに翻訳して表示するアプリの, 共通の Rust 側.
//!
//! ページの取得と翻訳の依頼 (API キーを使う通信) を受け持つ. HTML の解析と表示は, フロントエンド.
//! アプリ (zephyr-doc, kotlin-doc) は, [`builder`] に, サイトの設定 [`Site`] を渡して使う.

pub mod docs;
pub mod free;
pub mod plain;
pub mod settings;
pub mod translate;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Manager, State};

pub use docs::Site;
use free::GoogleFree;
use plain::{PlainBackend, PlainTranslator};
use settings::{Provider, Settings, Update, View};
use translate::{Backend, Cache, GeminiBackend, GoogleBackend};

/// キャッシュのファイルの名前.
const CACHE_FILE: &str = "translation-cache.json";

/// アプリの状態.
struct AppState {
    /// 設定と翻訳のキャッシュを保存するディレクトリ.
    dir: PathBuf,
    /// 取得するサイト.
    site: Site,
    settings: Mutex<Settings>,
    cache: Mutex<Cache>,
    client: reqwest::Client,
}

/// ML Kit (Android のプラグイン) を、プレーンテキストの翻訳として使う.
struct MlKit {
    app: tauri::AppHandle,
}

impl PlainTranslator for MlKit {
    fn translate_plain(
        &self,
        texts: &[String],
    ) -> impl std::future::Future<Output = Result<Vec<String>, String>> + Send {
        use tauri_plugin_mlkit::MlkitExt;

        let app = self.app.clone();
        let texts = texts.to_vec();

        async move {
            app.mlkit()
                .translate(texts)
                .await
                .map_err(|e| e.to_string())
        }
    }
}

/// ML Kit が使えるか (Android だけ).
const MLKIT_AVAILABLE: bool = cfg!(target_os = "android");

/// ドキュメントのページの HTML を取得する.
#[tauri::command]
async fn fetch_page(state: State<'_, AppState>, url: String) -> Result<String, String> {
    docs::fetch_page(&state.client, state.site.host, &url).await
}

/// サイトの JSON ファイル (メニューなど) を取得する.
#[tauri::command]
async fn fetch_json(state: State<'_, AppState>, url: String) -> Result<String, String> {
    docs::fetch_text(&state.client, state.site.host, &url, docs::Kind::Json).await
}

/// ML Kit が動くかを確かめる (翻訳のモデルを取得して, 短い文章を翻訳する. 設定の画面から呼ぶ).
#[tauri::command]
async fn check_mlkit(app: tauri::AppHandle) -> Result<String, String> {
    if !MLKIT_AVAILABLE {
        return Err("ML Kit is available only on Android".to_string());
    }
    let sample = ["Hello, world".to_string()];

    Ok(MlKit { app }.translate_plain(&sample).await?.join(" "))
}

/// 文章 (HTML の断片) を日本語に翻訳する. 同じ文章は, キャッシュから返す.
#[tauri::command]
async fn translate(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    texts: Vec<String>,
) -> Result<Vec<String>, String> {
    let (provider, key, model) = {
        let settings = state.settings.lock().map_err(|e| e.to_string())?;
        let key = settings
            .key_for_provider()
            .ok_or_else(|| "NO_API_KEY".to_string())?
            .to_string();
        (settings.provider, key, settings.gemini_model.clone())
    };
    let client = state.client.clone();
    // キャッシュを分ける名前 (サービスと, Gemini のモデル)
    let namespace = provider.namespace(&model);
    let (results, added) = match provider {
        Provider::Google => {
            translate_with(&state, &namespace, &GoogleBackend::new(client, key), &texts).await?
        }
        Provider::Gemini => {
            translate_with(
                &state,
                &namespace,
                &GeminiBackend::new(client, key, model),
                &texts,
            )
            .await?
        }
        Provider::Googlefree => {
            translate_with(
                &state,
                &namespace,
                &PlainBackend::new(GoogleFree::new(client)),
                &texts,
            )
            .await?
        }
        Provider::Mlkit => {
            if !MLKIT_AVAILABLE {
                return Err("ML Kit is available only on Android".to_string());
            }
            translate_with(
                &state,
                &namespace,
                &PlainBackend::new(MlKit { app }),
                &texts,
            )
            .await?
        }
    };
    if added > 0 {
        let json = state.cache.lock().map_err(|e| e.to_string())?.to_json();
        // キャッシュが書けなくても, 翻訳は返す
        let _ = std::fs::write(state.dir.join(CACHE_FILE), json);
    }

    Ok(results)
}

/// バックエンドとキャッシュで翻訳する.
async fn translate_with<B: Backend>(
    state: &State<'_, AppState>,
    namespace: &str,
    backend: &B,
    texts: &[String],
) -> Result<(Vec<String>, usize), String> {
    translate::translate_with_cache(&state.cache, backend, namespace, texts).await
}

/// 設定を返す (API キーそのものは、画面に返さない).
#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<View, String> {
    Ok(state
        .settings
        .lock()
        .map_err(|e| e.to_string())?
        .view(MLKIT_AVAILABLE))
}

/// 設定を変えて保存する.
#[tauri::command]
fn set_settings(state: State<'_, AppState>, update: Update) -> Result<View, String> {
    let mut settings = state.settings.lock().map_err(|e| e.to_string())?;
    if update.provider == Provider::Mlkit && !MLKIT_AVAILABLE {
        return Err("ML Kit is available only on Android".to_string());
    }
    settings.apply(&update);
    settings.save(&state.dir)?;

    Ok(settings.view(MLKIT_AVAILABLE))
}

/// アプリの Tauri ビルダーを作る (コマンドと状態は、設定済み).
///
/// ML Kit のプラグイン (`tauri_plugin_mlkit::init()`) は、Android のビルドが、アプリの直接の依存から
/// 見つけるので、アプリ側で `.plugin(...)` に足す.
pub fn builder(site: Site) -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let dir = app.path().app_data_dir()?;
            let cache = std::fs::read_to_string(dir.join(CACHE_FILE))
                .map(|text| translate::load_cache(&text))
                .unwrap_or_else(|_| translate::load_cache("[]"));
            app.manage(AppState {
                settings: Mutex::new(Settings::load(&dir)),
                cache: Mutex::new(cache),
                client: docs::build_client(site)?,
                site,
                dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_page,
            fetch_json,
            translate,
            check_mlkit,
            get_settings,
            set_settings
        ])
}
