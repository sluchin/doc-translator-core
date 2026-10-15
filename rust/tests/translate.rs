// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 翻訳とキャッシュ (`translate.rs`)の単体テスト (本番のソースとは、分けて置く).

use std::sync::Mutex;

use doc_translator_core::translate::*;

/// 偽の翻訳サービス: 文章に印を付けて, 渡された文章を記録する.
struct Fake {
    calls: Mutex<Vec<Vec<String>>>,
    wrong_count: bool,
}

impl Fake {
    fn new(wrong_count: bool) -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            wrong_count,
        }
    }
}

impl Backend for Fake {
    fn translate(
        &self,
        texts: &[String],
    ) -> impl Future<Output = Result<Vec<String>, String>> + Send {
        self.calls.lock().unwrap().push(texts.to_vec());
        let result = if self.wrong_count {
            Vec::new()
        } else {
            texts.iter().map(|text| format!("JA:{text}")).collect()
        };
        async move { Ok(result) }
    }
}

fn texts(items: &[&str]) -> Vec<String> {
    items.iter().map(|item| item.to_string()).collect()
}

#[tokio::test]
async fn translates_each_text_once_and_uses_the_cache() {
    let cache = Mutex::new(Cache::new(10));
    let fake = Fake::new(false);

    let (first, added) = translate_with_cache(&cache, &fake, "t", &texts(&["a", "b", "a"]))
        .await
        .unwrap();
    assert_eq!(first, texts(&["JA:a", "JA:b", "JA:a"]));
    assert_eq!(added, 2);
    let (second, added) = translate_with_cache(&cache, &fake, "t", &texts(&["b", "c"]))
        .await
        .unwrap();
    assert_eq!(second, texts(&["JA:b", "JA:c"]));
    assert_eq!(added, 1);
    let (third, added) = translate_with_cache(&cache, &fake, "t", &texts(&["a"]))
        .await
        .unwrap();

    assert_eq!((third, added), (texts(&["JA:a"]), 0));
    assert_eq!(
        *fake.calls.lock().unwrap(),
        vec![texts(&["a", "b"]), texts(&["c"])]
    );
}

#[tokio::test]
async fn rejects_a_different_number_of_results() {
    let cache = Mutex::new(Cache::new(10));
    let error = translate_with_cache(&cache, &Fake::new(true), "t", &texts(&["a"]))
        .await
        .unwrap_err();
    assert!(error.contains("different number"));
}

#[test]
fn drops_the_oldest_and_round_trips_through_json() {
    let mut cache = Cache::new(2);
    assert!(cache.is_empty());
    cache.insert("a".into(), "1".into());
    cache.insert("b".into(), "2".into());
    cache.insert("b".into(), "22".into());
    cache.insert("c".into(), "3".into());

    assert_eq!(cache.len(), 2);
    assert!(cache.get("a").is_none());
    let restored = Cache::from_json(&cache.to_json(), 2);
    assert_eq!(restored.get("b").map(String::as_str), Some("22"));
    assert_eq!(restored.get("c").map(String::as_str), Some("3"));
    assert!(Cache::from_json("not json", 2).is_empty());
    assert!(load_cache("[]").is_empty());
}

#[test]
fn keys_depend_on_the_language_and_the_text() {
    assert_eq!(cache_key("google", "a"), cache_key("google", "a"));
    assert_ne!(cache_key("google", "a"), cache_key("gemini", "a"));
    assert_ne!(cache_key("google", "a"), cache_key("google", "b"));
    assert_eq!(cache_key("google", "a").len(), 64);
}

#[test]
fn builds_the_google_request_and_reads_the_response() {
    let body: serde_json::Value =
        serde_json::from_str(&google_body(&texts(&["<p>Hi</p>"]))).unwrap();
    assert_eq!(body["q"][0], "<p>Hi</p>");
    assert_eq!(body["source"], "en");
    assert_eq!(body["target"], "ja");
    assert_eq!(body["format"], "html");

    let response =
        r#"{"data":{"translations":[{"translatedText":"<p>やあ</p>"},{"translatedText":"b"}]}}"#;
    assert_eq!(
        parse_google(response).unwrap(),
        texts(&["<p>やあ</p>", "b"])
    );
    assert!(parse_google("{}").is_err());
}

#[test]
fn reads_the_error_message() {
    let body = r#"{"error":{"code":403,"message":"API key not valid."}}"#;
    assert_eq!(
        google_error(400, body),
        "Translation failed (HTTP 400): API key not valid."
    );
    assert_eq!(google_error(500, "oops"), "Translation failed (HTTP 500)");
}

#[test]
fn builds_the_gemini_request() {
    let body: serde_json::Value =
        serde_json::from_str(&gemini_body(&texts(&["<p>Hi</p>"]))).unwrap();
    assert_eq!(body["contents"][0]["parts"][0]["text"], "[\"<p>Hi</p>\"]");
    assert_eq!(
        body["generationConfig"]["responseMimeType"],
        "application/json"
    );
    assert!(
        body["systemInstruction"]["parts"][0]["text"]
            .as_str()
            .unwrap()
            .contains("translate=\"no\"")
    );
    let backend = GeminiBackend::new(reqwest::Client::new(), "k".into(), "gemini-x".into());
    assert_eq!(
        backend.url(),
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent"
    );
}

#[test]
fn reads_the_gemini_response() {
    let ok = r#"{"candidates":[{"content":{"parts":[{"text":"[\"<p>やあ</p>\",\"b\"]"}]}}]}"#;
    assert_eq!(parse_gemini(ok, 2).unwrap(), texts(&["<p>やあ</p>", "b"]));
    assert!(
        parse_gemini(ok, 3)
            .unwrap_err()
            .contains("different number")
    );
    assert!(parse_gemini("{}", 1).unwrap_err().contains("unexpected"));
    assert!(
        parse_gemini(
            r#"{"candidates":[{"content":{"parts":[{"text":"not json"}]}}]}"#,
            1
        )
        .is_err()
    );
    assert!(parse_gemini("not json", 1).is_err());
    let blocked = r#"{"promptFeedback":{"blockReason":"SAFETY"}}"#;
    assert!(parse_gemini(blocked, 1).unwrap_err().contains("SAFETY"));
}

#[test]
fn retries_only_when_busy() {
    assert!(is_retryable(429) && is_retryable(503));
    assert!(!is_retryable(400) && !is_retryable(200));
    assert!(retry_delay(1) > retry_delay(0));
}
