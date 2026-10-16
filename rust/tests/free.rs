// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 無料の Google 翻訳 (`free.rs`)の単体テスト (本番のソースとは、分けて置く).

use doc_translator_core::free::*;
use doc_translator_core::plain::PlainTranslator;

#[test]
fn builds_the_form_body_with_the_escaped_text() {
    let body = free_body("a & b=c\nそう");
    assert!(body.starts_with("client=gtx&sl=en&tl=ja&dt=t&q="));
    assert!(body.contains("a+%26+b%3Dc%0A"));
}

#[test]
fn joins_the_translated_segments() {
    let json =
        r#"[[["こんにちは。","Hello.",null,null,10],["世界","World",null,null,10]],null,"en"]"#;
    assert_eq!(parse_free(json).unwrap(), "こんにちは。世界");
}

#[test]
fn rejects_an_unexpected_response() {
    assert!(parse_free("not json").is_err());
    assert!(parse_free("{}").is_err());
    assert!(parse_free(r#"["x"]"#).is_err());
}

#[test]
fn explains_the_limit() {
    assert!(free_error(429).contains("limiting"));
    assert!(free_error(503).contains("limiting"));
    // 確認の画面へのリダイレクトも、断られたものとして扱う
    assert!(free_error(302).contains("limiting the requests (HTTP 302)"));
    assert_eq!(free_error(500), "Google Translate (free) failed (HTTP 500)");
}

#[test]
fn retries_only_when_limited_and_within_the_retries() {
    assert!(is_limited(429) && is_limited(503) && is_limited(300) && is_limited(399));
    assert!(!is_limited(200) && !is_limited(400) && !is_limited(500));
    // 待つ時間は、やり直すたびに長くなる
    let first = retry_wait(429, 0).unwrap();
    let last = retry_wait(302, 2).unwrap();
    assert!(first < last);
    // 回数を使い切ったら、やり直さない
    assert_eq!(retry_wait(429, 3), None);
    // 断られたのでなければ、やり直さない
    assert_eq!(retry_wait(500, 0), None);
}

#[test]
fn keeps_the_parallel_requests_in_the_range() {
    assert_eq!(clamp_parallel(0), 1);
    assert_eq!(clamp_parallel(1), 1);
    assert_eq!(clamp_parallel(DEFAULT_PARALLEL), DEFAULT_PARALLEL);
    assert_eq!(clamp_parallel(MAX_PARALLEL), MAX_PARALLEL);
    assert_eq!(clamp_parallel(MAX_PARALLEL + 1), MAX_PARALLEL);
}

#[tokio::test]
async fn returns_a_blank_text_without_a_request() {
    let result = translate_one(reqwest::Client::new(), " \n".to_string()).await;
    assert_eq!(result.unwrap(), " \n");
    let none = GoogleFree::new(reqwest::Client::new(), 0)
        .translate_plain(&[])
        .await;
    assert_eq!(none.unwrap(), Vec::<String>::new());
}
