// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! ドキュメントを, 開いたときに翻訳して表示するアプリの, 共通の Rust 側.
//!
//! ページの取得と翻訳の依頼 (API キーを使う通信) を受け持つ. HTML の解析と表示は, フロントエンド.
//! アプリ (zephyr-doc, kotlin-doc) は, [`builder`] に, サイトの設定 [`Site`] を渡して使う.

pub mod docs;
pub mod free;
pub mod logging;
pub mod plain;
pub mod settings;
pub mod translate;

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use std::io::Write;

use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::{FsExt, OpenOptions};

pub use docs::Site;
use free::GoogleFree;
use plain::{PlainBackend, PlainTranslator};
use settings::{Provider, Settings, Update, View};
use translate::{Backend, Cache, GeminiBackend, GoogleBackend};

/// キャッシュのファイルの名前.
const CACHE_FILE: &str = "translation-cache.json";

/// キャッシュを保存するまで待つ時間 (続けて翻訳したときは, まとめて 1 回だけ書く).
const SAVE_DELAY: std::time::Duration = std::time::Duration::from_secs(2);

/// アプリの状態.
struct AppState {
    /// 設定と翻訳のキャッシュを保存するディレクトリ.
    dir: PathBuf,
    /// 取得するサイト.
    site: Site,
    settings: Mutex<Settings>,
    cache: Mutex<Cache>,
    /// キャッシュの保存を, 待っているか (待っている間は, 新しく予約しない).
    save_pending: AtomicBool,
    /// ページの取得に使う HTTP クライアント (リダイレクトは, ドキュメントのホストの中だけ).
    client: reqwest::Client,
    /// 翻訳の API に使う HTTP クライアント (リダイレクトは, たどらない).
    api_client: reqwest::Client,
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
    log::debug!("Fetching {}", url);
    docs::fetch_page(&state.client, state.site, &url)
        .await
        .inspect_err(|e| log::warn!("Could not fetch {}: {}", url, e))
}

/// サイトの JSON ファイル (メニューなど) を取得する.
#[tauri::command]
async fn fetch_json(state: State<'_, AppState>, url: String) -> Result<String, String> {
    docs::fetch_text(&state.client, state.site, &url, docs::Kind::Json).await
}

/// サイトの CSS を取得する (サイトの見た目で表示するため. ホストが違えば, 通信しないで失敗する).
#[tauri::command]
async fn fetch_css(state: State<'_, AppState>, url: String) -> Result<String, String> {
    docs::fetch_text(&state.client, state.site, &url, docs::Kind::Css).await
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
///
/// `scope` (ドキュメントの版など) があれば, その範囲ごとに, 別のキャッシュにする.
#[tauri::command]
async fn translate(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    texts: Vec<String>,
    scope: Option<String>,
) -> Result<Vec<String>, String> {
    let (provider, key, model, parallel) = {
        let settings = state.settings.lock().map_err(|e| e.to_string())?;
        let key = settings
            .key_for_provider()
            .ok_or_else(|| "NO_API_KEY".to_string())?
            .to_string();
        (
            settings.provider,
            key,
            settings.gemini_model.clone(),
            settings.free_parallel,
        )
    };
    let client = state.api_client.clone();
    // キャッシュを分ける名前 (サービスと, Gemini のモデルと, ドキュメントの版)
    let namespace = translate::scoped_namespace(&provider.namespace(&model), scope.as_deref());
    // 無料の Google 翻訳は, 同時に送る数ずつキャッシュに入れる (断られても, 翻訳できた分を捨てない)
    let batch = if provider == Provider::Googlefree {
        free::clamp_parallel(parallel)
    } else {
        usize::MAX
    };
    let result = match provider {
        Provider::Google => {
            translate_with(
                &state,
                &namespace,
                &GoogleBackend::new(client, key),
                &texts,
                batch,
            )
            .await
        }
        Provider::Gemini => {
            translate_with(
                &state,
                &namespace,
                &GeminiBackend::new(client, key, model),
                &texts,
                batch,
            )
            .await
        }
        Provider::Googlefree => {
            translate_with(
                &state,
                &namespace,
                &PlainBackend::new(GoogleFree::new(client, parallel)),
                &texts,
                batch,
            )
            .await
        }
        Provider::Mlkit => {
            if !MLKIT_AVAILABLE {
                return Err("ML Kit is available only on Android".to_string());
            }
            translate_with(
                &state,
                &namespace,
                &PlainBackend::new(MlKit { app: app.clone() }),
                &texts,
                batch,
            )
            .await
        }
    };
    // 失敗しても, それまでに翻訳できた分は, キャッシュに入っているので, 保存する
    let changed = match &result {
        Ok((_, added)) => *added > 0,
        Err(_) => true,
    };
    if changed {
        schedule_save(&app);
    }
    let (results, _) = result?;

    Ok(results)
}

/// キャッシュの保存を予約する ([`SAVE_DELAY`] のあとに, 1 回だけ書く).
///
/// 依頼のたびに, キャッシュ全体 (数 MB になる) を書き直すと, 遅くなる. 続けて翻訳したときは, まとめて書く.
/// ロックの中では写しだけを作り, JSON にして書くのは, 別のスレッドで行う (翻訳を止めない).
/// キャッシュが書けなくても, 翻訳は続ける.
fn schedule_save(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    if state.save_pending.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SAVE_DELAY).await;
        let state = app.state::<AppState>();
        // 写しを作る前に, 予約を外す (書いている間に増えた分は, 次の予約で書く)
        state.save_pending.store(false, Ordering::Release);
        let Ok(snapshot) = state.cache.lock().map(|cache| cache.snapshot()) else {
            return;
        };
        let path = state.dir.join(CACHE_FILE);
        let _ = tokio::task::spawn_blocking(move || {
            std::fs::write(path, translate::entries_to_json(&snapshot))
        })
        .await;
    });
}

/// 書き出すファイルの名前 (サイトのホストと, 日時). 日時が数字とハイフンでなければ, 日時を付けない.
pub fn export_name(host: &str, stamp: &str) -> String {
    let base = format!("{}-cache", host.replace('.', "-"));
    if !stamp.is_empty() && stamp.chars().all(|c| c.is_ascii_digit() || c == '-') {
        format!("{base}-{stamp}.json")
    } else {
        format!("{base}.json")
    }
}

/// 書き出しの結果.
#[derive(serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum Exported {
    /// 保存の画面で, 保存した (PC).
    Saved,
    /// Google Drive のアプリ (なければ, 共有先の一覧) に渡した. 保存は, 利用者が Drive の画面で行う (Android).
    Shared,
    /// 保存の画面で, やめた.
    Cancelled,
}

/// 翻訳のキャッシュを書き出す.
///
/// Android は, Google Drive のアプリの「ドライブに保存」の画面に渡す (Android の保存の画面は, 機種によって,
/// Drive を選べない). PC は, 保存の画面を開く (PC 版の Google Drive のフォルダも選べる).
/// 別の端末で [`import_cache`] で読み込むと, 翻訳を引き継げる.
///
/// `stamp` は, 書き出した日時 (画面が, 端末の時刻で作る. 例: `20261017-1530`). Google Drive は, 同じ名前でも
/// 上書きしないので, 名前に日時を入れて, どれが新しいか分かるようにする.
#[tauri::command]
async fn export_cache(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    stamp: String,
) -> Result<Exported, String> {
    let snapshot = state.cache.lock().map_err(|e| e.to_string())?.snapshot();
    // ファイルの名前は, アプリ (サイト) ごとに分ける (別のアプリのキャッシュと, 取り違えない)
    let name = export_name(state.site.host, &stamp);
    if MLKIT_AVAILABLE {
        // Android: キャッシュのディレクトリに書いて, Drive に渡す (`FileProvider` が渡せるのは, そこだけ)
        use tauri_plugin_mlkit::MlkitExt;

        let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
        let path = dir.join(&name);
        let file = path.clone();
        tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            std::fs::create_dir_all(&dir)?;
            std::fs::write(file, translate::entries_to_json(&snapshot))
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
        app.mlkit()
            .share_to_drive(path.to_string_lossy().into_owned())
            .await
            .map_err(|e| e.to_string())?;
        return Ok(Exported::Shared);
    }
    let dialog = app.dialog().file().set_file_name(name);
    let Some(path) = tokio::task::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(Exported::Cancelled);
    };
    let fs_app = app.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        let mut file = fs_app.fs().open(path, options).map_err(|e| e.to_string())?;
        file.write_all(translate::entries_to_json(&snapshot).as_bytes())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(Exported::Saved)
}

/// 書き出したキャッシュを読み込んで, 端末のキャッシュに足し合わせる (選択の画面を開く).
///
/// 返すのは, 新しく足した翻訳の数. 選ぶのをやめたら null.
#[tauri::command]
async fn import_cache(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<usize>, String> {
    let dialog = app.dialog().file();
    let Some(path) = tokio::task::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    let fs_app = app.clone();
    let text = tokio::task::spawn_blocking(move || fs_app.fs().read_to_string(path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let added = state
        .cache
        .lock()
        .map_err(|e| e.to_string())?
        .merge_json(&text)?;
    if added > 0 {
        schedule_save(&app);
    }

    Ok(Some(added))
}

/// バックエンドとキャッシュで翻訳する (`batch` 個ずつ, キャッシュに入れる).
async fn translate_with<B: Backend>(
    state: &State<'_, AppState>,
    namespace: &str,
    backend: &B,
    texts: &[String],
    batch: usize,
) -> Result<(Vec<String>, usize), String> {
    translate::translate_with_cache(&state.cache, backend, namespace, texts, batch).await
}

/// キャッシュにある翻訳を返す (通信しない. 今のサービスのキャッシュ. ない文章は, null).
///
/// 画面は, 翻訳を始める前に呼んで, 翻訳できている分を先に表示し, 残りだけを翻訳に渡す.
#[tauri::command]
fn lookup_cache(
    state: State<'_, AppState>,
    texts: Vec<String>,
    scope: Option<String>,
) -> Result<Vec<Option<String>>, String> {
    let namespace = {
        let settings = state.settings.lock().map_err(|e| e.to_string())?;
        translate::scoped_namespace(
            &settings.provider.namespace(&settings.gemini_model),
            scope.as_deref(),
        )
    };

    translate::lookup_cache(&state.cache, &namespace, &texts)
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
/// 見つけるので、アプリ側で `.plugin(...)` に足す. ダイアログとファイルのプラグインも、アプリの `Cargo.toml` の
/// 直接の依存に入れる (Android のプロジェクトに、プラグインを含めるため).
pub fn builder(site: Site) -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(move |app| {
            let dir = app.path().app_data_dir()?;
            logging::init_logging(&logging::log_path(&dir));
            log::info!("Started for {} ({})", site.host, env!("CARGO_PKG_VERSION"));
            let cache = std::fs::read_to_string(dir.join(CACHE_FILE))
                .map(|text| translate::load_cache(&text))
                .unwrap_or_else(|_| translate::load_cache("[]"));
            app.manage(AppState {
                settings: Mutex::new(Settings::load(&dir)),
                cache: Mutex::new(cache),
                save_pending: AtomicBool::new(false),
                client: docs::build_client(site)?,
                api_client: docs::build_api_client(site)?,
                site,
                dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            logging::log_frontend_message,
            fetch_page,
            fetch_json,
            fetch_css,
            translate,
            lookup_cache,
            export_cache,
            import_cache,
            check_mlkit,
            get_settings,
            set_settings
        ])
}
