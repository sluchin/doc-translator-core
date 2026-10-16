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
    /// この文章を渡されたら, 失敗する (断られたときの代わり).
    fail_on: Option<&'static str>,
}

impl Fake {
    fn new(wrong_count: bool) -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            wrong_count,
            fail_on: None,
        }
    }
}

impl Backend for Fake {
    fn translate(
        &self,
        texts: &[String],
    ) -> impl Future<Output = Result<Vec<String>, String>> + Send {
        self.calls.lock().unwrap().push(texts.to_vec());
        let failed = self
            .fail_on
            .is_some_and(|fail| texts.iter().any(|text| text == fail));
        let result = if failed {
            Err("limited".to_string())
        } else if self.wrong_count {
            Ok(Vec::new())
        } else {
            Ok(texts.iter().map(|text| format!("JA:{text}")).collect())
        };
        async move { result }
    }
}

fn texts(items: &[&str]) -> Vec<String> {
    items.iter().map(|item| item.to_string()).collect()
}

/// 全部を 1 回でバックエンドに渡す.
const ALL: usize = usize::MAX;

#[tokio::test]
async fn caches_each_batch_and_keeps_it_on_a_failure() {
    let cache = Mutex::new(Cache::new(10));
    let mut fake = Fake::new(false);
    fake.fail_on = Some("c");

    // 2 個ずつ渡す: 1 回目 (a, b) は翻訳できて, 2 回目 (c, d) で断られる
    let error = translate_with_cache(&cache, &fake, "t", &texts(&["a", "b", "c", "d"]), 2)
        .await
        .unwrap_err();
    assert_eq!(error, "limited");
    assert_eq!(
        lookup_cache(&cache, "t", &texts(&["a", "b", "c"])).unwrap(),
        vec![Some("JA:a".to_string()), Some("JA:b".to_string()), None]
    );

    // やり直すと, 翻訳できなかった分だけを渡す (0 個ずつは, 1 個ずつとして扱う)
    fake.fail_on = None;
    let (results, added) = translate_with_cache(&cache, &fake, "t", &texts(&["a", "c", "d"]), 0)
        .await
        .unwrap();
    assert_eq!(results, texts(&["JA:a", "JA:c", "JA:d"]));
    assert_eq!(added, 2);
    assert_eq!(
        *fake.calls.lock().unwrap(),
        vec![
            texts(&["a", "b"]),
            texts(&["c", "d"]),
            texts(&["c"]),
            texts(&["d"])
        ]
    );
    // サービスが違えば, キャッシュも違う
    assert_eq!(
        lookup_cache(&cache, "u", &texts(&["a"])).unwrap(),
        vec![None]
    );
}

#[tokio::test]
async fn translates_each_text_once_and_uses_the_cache() {
    let cache = Mutex::new(Cache::new(10));
    let fake = Fake::new(false);

    let (first, added) = translate_with_cache(&cache, &fake, "t", &texts(&["a", "b", "a"]), ALL)
        .await
        .unwrap();
    assert_eq!(first, texts(&["JA:a", "JA:b", "JA:a"]));
    assert_eq!(added, 2);
    let (second, added) = translate_with_cache(&cache, &fake, "t", &texts(&["b", "c"]), ALL)
        .await
        .unwrap();
    assert_eq!(second, texts(&["JA:b", "JA:c"]));
    assert_eq!(added, 1);
    let (third, added) = translate_with_cache(&cache, &fake, "t", &texts(&["a"]), ALL)
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
    let error = translate_with_cache(&cache, &Fake::new(true), "t", &texts(&["a"]), ALL)
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
        serde_json::from_str(&gemini_body(&texts(&["<p>Hi</p>"]), true)).unwrap();
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
    assert!(
        body["systemInstruction"]["parts"][0]["text"]
            .as_str()
            .unwrap()
            .contains("never add, explain, or expand")
    );
    // 指示文は、特定のサイトの名前を含まない (ほかのアプリも、共通のコードを使う)
    assert!(
        !body["systemInstruction"]["parts"][0]["text"]
            .as_str()
            .unwrap()
            .contains("Zephyr")
    );
    // 考える機能は、切る (翻訳が速い). 断るモデルのためには、設定なしの本文も作れる
    assert_eq!(
        body["generationConfig"]["thinkingConfig"]["thinkingBudget"],
        0
    );
    let plain: serde_json::Value =
        serde_json::from_str(&gemini_body(&texts(&["a"]), false)).unwrap();
    assert!(plain["generationConfig"]["thinkingConfig"].is_null());
    assert_eq!(plain["generationConfig"]["temperature"], 0.2);
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
fn splits_the_texts_into_small_batches_in_order() {
    let all = texts(&["a", "b", "c", "d", "e"]);
    assert_eq!(
        split_batches(&all, 2),
        vec![texts(&["a", "b"]), texts(&["c", "d"]), texts(&["e"])]
    );
    // 0 個ずつは、1 個ずつとして扱う. 空なら、依頼はない
    assert_eq!(split_batches(&all, 0).len(), 5);
    assert!(split_batches(&[], GEMINI_BATCH).is_empty());
    // 40 個 (画面が 1 回に渡す数) は、同時に送る数の、1 回分に収まる
    let forty: Vec<String> = (0..40).map(|i| i.to_string()).collect();
    assert_eq!(split_batches(&forty, GEMINI_BATCH).len(), GEMINI_PARALLEL);
}

#[test]
fn skips_the_blank_texts_and_puts_the_translations_back() {
    let all = texts(&["a", " ", "b", "", "c"]);
    let (indexes, sendable) = split_blank(&all);
    assert_eq!(indexes, vec![0, 2, 4]);
    assert_eq!(sendable, texts(&["a", "b", "c"]));
    let translated = texts(&["JA:a", "JA:b", "JA:c"]);
    assert_eq!(
        merge_blank(&all, &indexes, translated),
        texts(&["JA:a", " ", "JA:b", "", "JA:c"])
    );
    assert!(split_blank(&[]).1.is_empty());
}

#[tokio::test]
async fn halves_the_batch_when_the_number_does_not_match() {
    let calls = Mutex::new(Vec::new());
    // 3 個以上は、数が合わない (モデルが、数を間違える). 2 個までは、翻訳できる
    let send = |batch: Vec<String>| {
        calls.lock().unwrap().push(batch.len());
        async move {
            if batch.len() > 2 {
                Err(GEMINI_MISMATCH.to_string())
            } else {
                Ok(batch.iter().map(|text| format!("JA:{text}")).collect())
            }
        }
    };
    let all = texts(&["a", "b", "c", "d", "e"]);
    let result = translate_halving(all, &send).await.unwrap();

    assert_eq!(result, texts(&["JA:a", "JA:b", "JA:c", "JA:d", "JA:e"]));
    // 5 個で失敗 → 2 個と 3 個 (3 個は、また失敗 → 1 個と 2 個)
    assert_eq!(*calls.lock().unwrap(), vec![5, 2, 3, 1, 2]);
}

#[tokio::test]
async fn keeps_a_single_text_that_never_matches_and_passes_other_errors() {
    let never = |_: Vec<String>| async { Err::<Vec<String>, String>(GEMINI_MISMATCH.to_string()) };
    // 1 つだけで合わないときは、原文のまま (ページ全体は、失敗にしない)
    assert_eq!(
        translate_halving(texts(&["a", "b"]), &never).await.unwrap(),
        texts(&["a", "b"])
    );
    // 数の違い以外のエラーは、そのまま返す
    let busy = |_: Vec<String>| async { Err::<Vec<String>, String>("busy".to_string()) };
    assert_eq!(
        translate_halving(texts(&["a", "b"]), &busy)
            .await
            .unwrap_err(),
        "busy"
    );
}

#[test]
fn detects_the_model_that_rejects_the_thinking_setting() {
    let message = r#"{"error":{"message":"Thinking budget 0 is invalid for this model"}}"#;
    assert!(rejects_thinking(400, message));
    assert!(rejects_thinking(400, "THINKING_CONFIG is not supported"));
    // 別の 400 と、400 以外は、考える機能の設定のせいではない
    assert!(!rejects_thinking(
        400,
        r#"{"error":{"message":"API key not valid"}}"#
    ));
    assert!(!rejects_thinking(429, message));
}

#[test]
fn retries_only_when_busy() {
    assert!(is_retryable(429) && is_retryable(503));
    assert!(!is_retryable(400) && !is_retryable(200));
    assert!(retry_delay(1) > retry_delay(0));
}
