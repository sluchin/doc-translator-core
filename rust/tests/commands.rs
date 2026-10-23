// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 画面から呼ぶコマンド (`commands`) のテスト. 翻訳の API は, テスト用の HTTP サーバー (mockito) で代わりにする.

use std::fs;
use std::future::Future;
use std::sync::atomic::Ordering;

use doc_translator_core::commands::{self, AppState, CACHE_FILE, Endpoints};
use doc_translator_core::docs::{Kind, Site};
use doc_translator_core::logging;
use doc_translator_core::plain::PlainTranslator;
use doc_translator_core::settings::{Provider, Update};
use mockito::{Server, ServerGuard};
use serde_json::json;
use tempfile::{TempDir, tempdir};

/// テストのサイト. `localhost` の https は, 接続できない (通信しないで, 失敗する).
const SITE: Site = Site {
    host: "localhost",
    alt_host: None,
    user_agent: "test/0.1",
};

/// ML Kit の代わり (`[mlkit] 文章` にする. 空の文章は, 失敗にする).
struct FakeMlkit;

impl PlainTranslator for FakeMlkit {
    fn translate_plain(
        &self,
        texts: &[String],
    ) -> impl Future<Output = Result<Vec<String>, String>> + Send {
        let result = if texts.iter().any(|text| text == "fail") {
            Err("mlkit failed".to_string())
        } else {
            Ok(texts.iter().map(|text| format!("[mlkit] {text}")).collect())
        };
        async move { result }
    }
}

/// 文字列の配列にする.
fn texts(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

/// アプリの状態を作る. 翻訳の API の送り先は, `server`.
fn state(server: &ServerGuard) -> (TempDir, AppState) {
    let dir = tempdir().unwrap();
    let mut state = AppState::new(SITE, dir.path().to_path_buf()).unwrap();
    state.endpoints = Endpoints {
        google: format!("{}/google", server.url()),
        gemini: format!("{}/gemini", server.url()),
        free: format!("{}/free", server.url()),
    };
    (dir, state)
}

/// 設定を変える.
fn select(state: &AppState, provider: Provider, mlkit_available: bool) {
    let update = Update {
        provider,
        google_key: Some("g".into()),
        gemini_key: Some("k".into()),
        gemini_model: "m".into(),
        free_parallel: Some(2),
    };
    commands::set_settings(state, &update, mlkit_available).unwrap();
}

#[test]
fn endpoints_default_to_the_services() {
    let endpoints = Endpoints::default();
    assert!(
        endpoints
            .google
            .starts_with("https://translation.googleapis.com/")
    );
    assert!(
        endpoints
            .gemini
            .starts_with("https://generativelanguage.googleapis.com/")
    );
    assert!(
        endpoints
            .free
            .starts_with("https://translate.googleapis.com/")
    );
}

#[test]
fn new_reads_the_saved_cache() {
    let dir = tempdir().unwrap();
    commands::write_cache(dir.path(), &[("k".into(), "v".into())]).unwrap();
    let state = AppState::new(SITE, dir.path().to_path_buf()).unwrap();
    assert_eq!(commands::cache_snapshot(&state).unwrap().len(), 1);
    // 書いたキャッシュを, そのまま読める
    assert!(
        fs::read_to_string(dir.path().join(CACHE_FILE))
            .unwrap()
            .contains("\"v\"")
    );
}

#[tokio::test]
async fn fetch_only_the_documentation_host() {
    let server = Server::new_async().await;
    let (_dir, state) = state(&server);
    assert!(
        commands::fetch(&state, "https://example.com/", Kind::Html)
            .await
            .unwrap_err()
            .starts_with("Not a documentation page")
    );
}

#[tokio::test]
async fn check_mlkit_only_on_android() {
    assert_eq!(
        commands::check_mlkit(&FakeMlkit, false).await,
        Err("ML Kit is available only on Android".to_string())
    );
    assert_eq!(
        commands::check_mlkit(&FakeMlkit, true).await,
        Ok("[mlkit] Hello, world".to_string())
    );
}

#[tokio::test]
async fn translate_with_each_service_and_the_cache() {
    let mut server = Server::new_async().await;
    let _google = server
        .mock("POST", "/google")
        .with_body(json!({"data": {"translations": [{"translatedText": "G"}]}}).to_string())
        .create_async()
        .await;
    let _gemini = server
        .mock("POST", "/gemini/m:generateContent")
        .with_body(
            json!({"candidates": [{"content": {"parts": [{"text": "[\"M\"]"}]}}]}).to_string(),
        )
        .create_async()
        .await;
    let _free = server
        .mock("POST", "/free")
        .with_body(json!([[["F", "a"]]]).to_string())
        .create_async()
        .await;
    let (_dir, state) = state(&server);
    let a = texts(&["a"]);
    for (provider, expected) in [
        (Provider::Google, "G"),
        (Provider::Gemini, "M"),
        (Provider::Googlefree, "F"),
        (Provider::Mlkit, "[mlkit] a"),
    ] {
        select(&state, provider, true);
        let translated = commands::translate(&state, FakeMlkit, true, &a, Some("v1"), false).await;
        assert_eq!(translated.result, Ok(texts(&[expected])), "{provider:?}");
        assert!(translated.changed);
        // 2 回目は, キャッシュから返す (キャッシュは変わらない)
        let cached = commands::translate(&state, FakeMlkit, true, &a, Some("v1"), false).await;
        assert_eq!(cached.result, Ok(texts(&[expected])));
        assert!(!cached.changed);
        assert_eq!(
            commands::lookup_cache(&state, &a, Some("v1")).unwrap(),
            vec![Some(expected.to_string())]
        );
    }
}

#[tokio::test]
async fn translate_reports_the_errors() {
    let server = Server::new_async().await;
    let (_dir, state) = state(&server);
    // キーがない
    commands::set_settings(
        &state,
        &Update {
            provider: Provider::Google,
            google_key: Some(String::new()),
            gemini_key: None,
            gemini_model: "m".into(),
            free_parallel: None,
        },
        false,
    )
    .unwrap();
    let translated =
        commands::translate(&state, FakeMlkit, false, &texts(&["a"]), None, false).await;
    assert_eq!(translated.result, Err("NO_API_KEY".to_string()));
    assert!(!translated.changed);
    // ML Kit は Android だけ
    select(&state, Provider::Mlkit, true);
    let translated =
        commands::translate(&state, FakeMlkit, false, &texts(&["a"]), None, false).await;
    assert_eq!(
        translated.result,
        Err("ML Kit is available only on Android".to_string())
    );
    assert!(!translated.changed);
    // 翻訳の失敗 (それまでの分を保存するので, 変わったことにする)
    let translated =
        commands::translate(&state, FakeMlkit, true, &texts(&["fail"]), None, true).await;
    assert!(translated.result.is_err());
    assert!(translated.changed);
}

#[test]
fn save_and_merge_the_cache() {
    let dir = tempdir().unwrap();
    let state = AppState::new(SITE, dir.path().to_path_buf()).unwrap();
    assert_eq!(
        commands::merge_cache(&state, &json!([["k", "v"]]).to_string()),
        Ok(1)
    );
    assert!(commands::merge_cache(&state, "not json").is_err());
    state.save_pending.store(true, Ordering::Release);
    commands::save_cache(&state).unwrap();
    assert!(!state.save_pending.load(Ordering::Acquire));
    let saved = AppState::new(SITE, dir.path().to_path_buf()).unwrap();
    assert_eq!(commands::cache_snapshot(&saved).unwrap().len(), 1);
    // 書けない
    assert!(commands::write_cache(&dir.path().join("missing"), &[]).is_err());
}

#[test]
fn read_clear_and_export_the_log() {
    let dir = tempdir().unwrap();
    let state = AppState::new(SITE, dir.path().to_path_buf()).unwrap();
    let path = logging::log_path(dir.path());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "line\n").unwrap();
    assert_eq!(commands::read_log(&state), Ok("line\n".to_string()));
    assert_eq!(commands::log_for_export(dir.path()), "line\n");
    commands::clear_log(&state).unwrap();
    // ログのパスがディレクトリなら, 読めず, 消せない (書き出しには, 理由を書く)
    let _ = fs::remove_file(&path);
    fs::create_dir_all(&path).unwrap();
    assert!(commands::read_log(&state).is_err());
    assert!(commands::clear_log(&state).is_err());
    assert!(!commands::log_for_export(dir.path()).is_empty());
}

#[test]
fn get_and_set_the_settings() {
    let dir = tempdir().unwrap();
    let state = AppState::new(SITE, dir.path().to_path_buf()).unwrap();
    let view = commands::get_settings(&state, false).unwrap();
    assert!(!view.mlkit_available);
    let update = Update {
        provider: Provider::Mlkit,
        google_key: None,
        gemini_key: None,
        gemini_model: "m".into(),
        free_parallel: None,
    };
    assert_eq!(
        commands::set_settings(&state, &update, false),
        Err("ML Kit is available only on Android".to_string())
    );
    assert_eq!(
        commands::set_settings(&state, &update, true)
            .unwrap()
            .provider,
        Provider::Mlkit
    );
    // 保存できない
    fs::remove_dir_all(dir.path()).unwrap();
    fs::write(dir.path(), "not a directory").unwrap();
    assert!(commands::set_settings(&state, &update, true).is_err());
}

#[tokio::test]
async fn translate_fails_when_the_settings_are_poisoned() {
    let server = Server::new_async().await;
    let (_dir, state) = state(&server);
    // 設定を持ったまま, ほかのスレッドが落ちた
    std::thread::scope(|s| {
        let _ = s
            .spawn(|| {
                let _settings = state.settings.lock().unwrap();
                panic!("poison the settings");
            })
            .join();
    });
    let translated =
        commands::translate(&state, FakeMlkit, true, &texts(&["a"]), None, false).await;
    assert!(translated.result.is_err());
    assert!(!translated.changed);
}
