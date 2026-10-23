// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 通信する部分 (ページの取得, 翻訳の API) のテスト. 相手は, テスト用の HTTP サーバー (mockito).

use doc_translator_core::docs::{self, Kind, MAX_BYTES, Site};
use doc_translator_core::free::{GoogleFree, translate_one};
use doc_translator_core::plain::PlainTranslator;
use doc_translator_core::translate::{Backend, GeminiBackend, GoogleBackend};
use mockito::{Matcher, Server};
use serde_json::json;

/// テストのサイト. `localhost` の https は, 接続できない (通信しないで, 失敗する).
const SITE: Site = Site {
    host: "localhost",
    alt_host: None,
    user_agent: "test/0.1",
};

/// 文字列の配列にする.
fn texts(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

/// Gemini の応答 (翻訳を, JSON の文字列の配列にして, 返す).
fn gemini_answer(items: &[&str]) -> String {
    json!({"candidates": [{"content": {"parts": [{"text": json!(items).to_string()}]}}]})
        .to_string()
}

#[test]
fn check_redirect_follows_only_the_documentation_host() {
    assert_eq!(docs::check_redirect(SITE, 0, "https://localhost/a"), Ok(()));
    assert_eq!(
        docs::check_redirect(SITE, 0, "https://example.com/a"),
        Err("redirected out of the documentation host")
    );
    assert_eq!(
        docs::check_redirect(SITE, 5, "https://localhost/a"),
        Err("too many redirects")
    );
}

#[tokio::test]
async fn get_text_checks_the_response() {
    let mut server = Server::new_async().await;
    let _ok = server
        .mock("GET", "/page")
        .with_header("content-type", "text/html")
        .with_body("<p>a</p>")
        .create_async()
        .await;
    let _missing = server
        .mock("GET", "/missing")
        .with_status(404)
        .create_async()
        .await;
    let _large = server
        .mock("GET", "/large")
        .with_header("content-type", "text/html")
        // 大きさを知らせない (読んでから, 確かめる)
        .with_chunked_body(|w| w.write_all(&vec![b'a'; MAX_BYTES + 1]))
        .create_async()
        .await;
    let client = reqwest::Client::new();
    let url = |path: &str| format!("{}{path}", server.url());
    assert_eq!(
        docs::get_text(&client, &url("/page"), Kind::Html).await,
        Ok("<p>a</p>".to_string())
    );
    assert_eq!(
        docs::get_text(&client, &url("/missing"), Kind::Html).await,
        Err("HTTP 404".to_string())
    );
    assert_eq!(
        docs::get_text(&client, &url("/large"), Kind::Html).await,
        Err("The page is too large".to_string())
    );
    // 接続できない
    assert!(
        docs::get_text(&client, "http://127.0.0.1:1/", Kind::Html)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn fetch_text_fetches_only_the_documentation_host() {
    let client = docs::build_client(SITE).unwrap();
    assert_eq!(
        docs::fetch_page(&client, SITE, "https://example.com/").await,
        Err("Not a documentation page: https://example.com/".to_string())
    );
    // ホストは合っている (接続できないので, 失敗する)
    assert!(
        docs::fetch_text(&client, SITE, "https://localhost:1/", Kind::Css)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn the_client_follows_redirects_only_to_the_documentation_host() {
    let mut server = Server::new_async().await;
    let _out = server
        .mock("GET", "/out")
        .with_status(302)
        .with_header("location", "https://example.com/")
        .create_async()
        .await;
    let _in = server
        .mock("GET", "/in")
        .with_status(302)
        .with_header("location", "https://localhost:1/")
        .create_async()
        .await;
    let client = docs::build_client(SITE).unwrap();
    let out = client
        .get(format!("{}/out", server.url()))
        .send()
        .await
        .unwrap_err();
    assert!(out.is_redirect());
    // たどる (接続できないので, 失敗する)
    let inside = client
        .get(format!("{}/in", server.url()))
        .send()
        .await
        .unwrap_err();
    assert!(!inside.is_redirect());
    assert!(docs::build_api_client(SITE).is_ok());
}

#[tokio::test]
async fn translate_one_keeps_the_spaces_and_reports_the_errors() {
    let mut server = Server::new_async().await;
    let _ok = server
        .mock("POST", "/ok")
        .match_body(Matcher::Regex(r"q=\+a%0A".to_string()))
        .with_body(json!([[["あ", "a"]]]).to_string())
        .create_async()
        .await;
    let _blocked = server
        .mock("POST", "/blocked")
        .with_status(302)
        .create_async()
        .await;
    let client = reqwest::Client::new();
    assert_eq!(
        translate_one(
            client.clone(),
            &format!("{}/ok", server.url()),
            " a\n".into()
        )
        .await,
        Ok(" あ\n".to_string())
    );
    let blocked = translate_one(
        client.clone(),
        &format!("{}/blocked", server.url()),
        "a".into(),
    )
    .await
    .unwrap_err();
    assert!(blocked.contains("HTTP 302"));
    assert!(
        translate_one(client, "http://127.0.0.1:1/", "a".into())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn google_free_translates_in_parallel() {
    let mut server = Server::new_async().await;
    let _ok = server
        .mock("POST", "/")
        .with_body(json!([[["訳", "x"]]]).to_string())
        .expect(3)
        .create_async()
        .await;
    let free = GoogleFree::with_url(reqwest::Client::new(), 2, &server.url());
    assert_eq!(
        free.translate_plain(&texts(&["a", "b", "c"])).await,
        Ok(texts(&["訳", "訳", "訳"]))
    );
    let failing = GoogleFree::with_url(reqwest::Client::new(), 2, "http://127.0.0.1:1/");
    assert!(failing.translate_plain(&texts(&["a"])).await.is_err());
}

#[tokio::test]
async fn google_backend_sends_the_key_and_reads_the_answer() {
    let mut server = Server::new_async().await;
    let _ok = server
        .mock("POST", "/ok")
        .match_header("x-goog-api-key", "key")
        .with_body(json!({"data": {"translations": [{"translatedText": "訳"}]}}).to_string())
        .create_async()
        .await;
    let _bad = server
        .mock("POST", "/bad")
        .with_status(400)
        .with_body(json!({"error": {"message": "bad key"}}).to_string())
        .create_async()
        .await;
    let client = reqwest::Client::new();
    let ok = GoogleBackend::with_url(
        client.clone(),
        "key".into(),
        &format!("{}/ok", server.url()),
    );
    assert_eq!(ok.translate(&texts(&["a"])).await, Ok(texts(&["訳"])));
    let bad = GoogleBackend::with_url(
        client.clone(),
        "key".into(),
        &format!("{}/bad", server.url()),
    );
    assert_eq!(
        bad.translate(&texts(&["a"])).await,
        Err("Translation failed (HTTP 400): bad key".to_string())
    );
    let down = GoogleBackend::with_url(client, "key".into(), "http://127.0.0.1:1/");
    assert!(down.translate(&texts(&["a"])).await.is_err());
}

#[tokio::test]
async fn gemini_backend_translates_and_keeps_the_blank_texts() {
    let mut server = Server::new_async().await;
    let _ok = server
        .mock("POST", "/m:generateContent")
        .match_header("x-goog-api-key", "key")
        .with_body(gemini_answer(&["訳"]))
        .create_async()
        .await;
    let backend = GeminiBackend::with_base(
        reqwest::Client::new(),
        "key".into(),
        "m".into(),
        &server.url(),
    );
    assert_eq!(
        backend.translate(&texts(&["a", " "])).await,
        Ok(texts(&["訳", " "]))
    );
}

#[tokio::test]
async fn gemini_backend_retries_without_thinking_and_when_busy() {
    let mut server = Server::new_async().await;
    // 1 回目: 考える機能を切る設定を断る. 2 回目: 混んでいる. 3 回目: 翻訳する
    let _thinking = server
        .mock("POST", "/m:generateContent")
        .match_body(Matcher::Regex("thinkingBudget".to_string()))
        .with_status(400)
        .with_body(json!({"error": {"message": "thinking is not supported"}}).to_string())
        .create_async()
        .await;
    let _busy = server
        .mock("POST", "/m:generateContent")
        .with_status(503)
        .expect(1)
        .create_async()
        .await;
    let backend = GeminiBackend::with_base(
        reqwest::Client::new(),
        "key".into(),
        "m".into(),
        &server.url(),
    );
    let _ok = server
        .mock("POST", "/m:generateContent")
        .with_body(gemini_answer(&["訳"]))
        .create_async()
        .await;
    assert_eq!(backend.translate(&texts(&["a"])).await, Ok(texts(&["訳"])));
}

#[tokio::test]
async fn gemini_backend_reports_the_errors() {
    let mut server = Server::new_async().await;
    let _bad = server
        .mock("POST", "/bad:generateContent")
        .with_status(500)
        .create_async()
        .await;
    let _short = server
        .mock("POST", "/short:generateContent")
        .with_body(gemini_answer(&[]))
        .create_async()
        .await;
    let client = reqwest::Client::new();
    let bad = GeminiBackend::with_base(client.clone(), "key".into(), "bad".into(), &server.url());
    assert_eq!(
        bad.translate(&texts(&["a"])).await,
        Err("Gemini request failed (HTTP 500)".to_string())
    );
    // 数が合わなければ, 1 つずつに分けて, それでも合わなければ, 原文のまま
    let short =
        GeminiBackend::with_base(client.clone(), "key".into(), "short".into(), &server.url());
    assert_eq!(
        short.translate(&texts(&["a", "b"])).await,
        Ok(texts(&["a", "b"]))
    );
    let down = GeminiBackend::with_base(client, "key".into(), "m".into(), "http://127.0.0.1:1");
    assert!(down.translate(&texts(&["a"])).await.is_err());
}

#[test]
fn backends_use_the_services_by_default() {
    let client = reqwest::Client::new();
    let _google = GoogleBackend::new(client.clone(), "key".into());
    let free = GoogleFree::new(client, 4);
    drop(free);
}
