// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 設定 (`settings.rs`)の単体テスト (本番のソースとは、分けて置く).

use std::fs;

use doc_translator_core::settings::*;

fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("zephyr-doc-test-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    dir
}

fn update(provider: Provider, google: Option<&str>, gemini: Option<&str>, model: &str) -> Update {
    Update {
        provider,
        google_key: google.map(str::to_string),
        gemini_key: gemini.map(str::to_string),
        gemini_model: model.to_string(),
        free_parallel: None,
    }
}

#[test]
fn sets_the_parallel_requests_of_the_free_service() {
    let mut settings = Settings::default();
    assert_eq!(
        settings.free_parallel,
        doc_translator_core::free::DEFAULT_PARALLEL
    );
    // None なら変えない. 範囲の外は、1 から上限までに収める
    let mut change = update(Provider::Googlefree, None, None, "");
    settings.apply(&change);
    assert_eq!(
        settings.free_parallel,
        doc_translator_core::free::DEFAULT_PARALLEL
    );
    change.free_parallel = Some(2);
    settings.apply(&change);
    assert_eq!(settings.view(false).free_parallel, 2);
    change.free_parallel = Some(0);
    settings.apply(&change);
    assert_eq!(settings.free_parallel, 1);
    // 設定のファイルに、範囲の外の値が書かれていても、画面には、収めた値を返す
    settings.free_parallel = 100;
    assert_eq!(
        settings.view(false).free_parallel,
        doc_translator_core::free::MAX_PARALLEL
    );
}

#[test]
fn saves_and_loads() {
    let dir = temp_dir("settings");
    let mut settings = Settings::default();
    settings.apply(&update(
        Provider::Gemini,
        Some("  g1 \n"),
        Some("m1"),
        " gemini-x ",
    ));
    settings.save(&dir).unwrap();

    let loaded = Settings::load(&dir);
    assert_eq!(loaded, settings);
    assert_eq!(loaded.api_key.as_deref(), Some("g1"));
    assert_eq!(loaded.gemini_model, "gemini-x");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn keys_are_kept_cleared_or_replaced() {
    let mut settings = Settings::default();
    settings.apply(&update(Provider::Google, Some("a"), Some("b"), ""));
    settings.apply(&update(Provider::Google, None, Some("   "), ""));

    assert_eq!(settings.api_key.as_deref(), Some("a"));
    // 消したキーは, 空にする (まだ入れていないキー (None) と, 区別する)
    assert_eq!(settings.gemini_key.as_deref(), Some(""));
    assert!(!settings.view(false).has_gemini_key);
    settings.provider = Provider::Gemini;
    assert_eq!(settings.key_for_provider(), None);
    assert_eq!(settings.gemini_model, DEFAULT_GEMINI_MODEL);
}

#[test]
fn fills_the_keys_not_entered_yet_from_the_build() {
    let dir = temp_dir("build-keys");
    // ファイルがなければ, ビルドのときのキー
    let fresh = Settings::load_with_keys(&dir, Some("g"), Some("m"));
    assert_eq!(fresh.api_key.as_deref(), Some("g"));
    assert_eq!(fresh.gemini_key.as_deref(), Some("m"));
    // まだ入れていないキー (null) は, ビルドのときのキー. 入れたキーと, 消したキーは, そのまま
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join(FILE_NAME),
        r#"{"provider":"gemini","api_key":null,"gemini_key":"mine","free_parallel":1}"#,
    )
    .unwrap();
    let saved = Settings::load_with_keys(&dir, Some("g"), Some("m"));
    assert_eq!(saved.api_key.as_deref(), Some("g"));
    assert_eq!(saved.gemini_key.as_deref(), Some("mine"));
    assert_eq!(saved.free_parallel, 1);
    fs::write(dir.join(FILE_NAME), r#"{"api_key":"","gemini_key":null}"#).unwrap();
    let cleared = Settings::load_with_keys(&dir, Some("g"), None);
    assert_eq!(cleared.api_key.as_deref(), Some(""));
    assert_eq!(cleared.gemini_key, None);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn falls_back_to_the_default() {
    let dir = temp_dir("missing");
    assert_eq!(
        Settings::load_with_keys(&dir, None, None),
        Settings::with_keys(None, None)
    );
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(FILE_NAME), "not json").unwrap();
    assert_eq!(
        Settings::load_with_keys(&dir, None, None),
        Settings::with_keys(None, None)
    );
    // 古い形式 (キーだけ) も読める
    fs::write(dir.join(FILE_NAME), r#"{"api_key":"old"}"#).unwrap();
    assert_eq!(Settings::load(&dir).api_key.as_deref(), Some("old"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn picks_the_key_of_the_provider_and_hides_the_keys() {
    let mut settings = Settings::default();
    settings.apply(&update(Provider::Google, Some("a"), Some("b"), ""));
    assert_eq!(settings.key_for_provider(), Some("a"));
    settings.provider = Provider::Gemini;
    assert_eq!(settings.key_for_provider(), Some("b"));
    settings.provider = Provider::Googlefree;
    assert_eq!(settings.key_for_provider(), Some(""));
    settings.provider = Provider::Mlkit;
    assert_eq!(settings.key_for_provider(), Some(""));

    let view = settings.view(true);
    assert!(view.has_google_key && view.has_gemini_key && view.mlkit_available);
    assert_eq!(Provider::Google.name(), "google");
    assert_eq!(Provider::Gemini.name(), "gemini");
    assert_eq!(Provider::Mlkit.name(), "mlkit");
    assert_eq!(Provider::Googlefree.name(), "googlefree");
    // Gemini は、モデルが違えば、キャッシュの名前も違う. ほかは、モデルを見ない
    assert_eq!(Provider::Gemini.namespace("m1"), "gemini:m1");
    assert_ne!(
        Provider::Gemini.namespace("m1"),
        Provider::Gemini.namespace("m2")
    );
    assert_eq!(Provider::Google.namespace("m1"), "google");
    assert_eq!(Provider::Mlkit.namespace("m1"), "mlkit");
    assert_eq!(Provider::Googlefree.namespace("m1"), "googlefree");
    assert_eq!(Settings::default().provider, Provider::Googlefree);
    assert_eq!(Settings::default().key_for_provider(), Some(""));
    // キーのない設定 (Settings::default() は, ビルドのときの環境変数にキーがあれば, それを持つ)
    let google = Settings {
        provider: Provider::Google,
        ..Settings::with_keys(None, None)
    };
    assert_eq!(google.key_for_provider(), None);
}

#[test]
fn takes_the_initial_keys_from_the_build() {
    let settings = Settings::with_keys(Some(" google "), Some(""));
    assert_eq!(settings.api_key.as_deref(), Some("google"));
    assert_eq!(settings.gemini_key, None);
    assert_eq!(
        Settings::with_keys(None, Some("gemini"))
            .gemini_key
            .as_deref(),
        Some("gemini")
    );
}
