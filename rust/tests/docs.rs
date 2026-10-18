// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! ページの取得 (`docs.rs`)の単体テスト (本番のソースとは、分けて置く).

use doc_translator_core::docs::*;

const HOST: &str = "docs.example.com";

#[test]
fn accepts_only_https_pages_of_the_documentation_host() {
    assert!(is_doc_url(
        HOST,
        "https://docs.example.com/latest/index.html#a"
    ));
    assert!(!is_doc_url(HOST, "http://docs.example.com/"));
    assert!(!is_doc_url(HOST, "https://docs.example.com.evil.example/"));
    assert!(!is_doc_url(HOST, "https://evil.example/docs.example.com"));
    assert!(!is_doc_url(HOST, "file:///etc/passwd"));
    assert!(!is_doc_url(HOST, "not a url"));
}

#[test]
fn allows_the_alternative_host_only_when_it_is_set() {
    let site = Site {
        host: HOST,
        alt_host: Some("alt.example.com"),
        user_agent: "test/0.1",
    };
    assert!(site.allows("https://docs.example.com/a"));
    assert!(site.allows("https://alt.example.com/a"));
    assert!(!site.allows("https://other.example.com/a"));
    assert!(!site.allows("http://alt.example.com/a"));
    let single = Site {
        alt_host: None,
        ..site
    };
    assert!(!single.allows("https://alt.example.com/a"));
}

#[test]
fn checks_the_response() {
    let html = Kind::Html;
    assert!(check_response(200, Some("text/html; charset=utf-8"), Some(10), html).is_ok());
    assert!(check_response(200, Some("text/html"), None, html).is_ok());
    assert_eq!(
        check_response(404, Some("text/html"), None, html),
        Err("HTTP 404".to_string())
    );
    assert!(check_response(200, Some("image/png"), None, html).is_err());
    assert!(check_response(200, Some("application/json"), None, html).is_err());
    assert!(check_response(200, None, None, html).is_err());
    assert!(check_response(200, Some("text/html"), Some(MAX_BYTES as u64 + 1), html).is_err());
}

#[test]
fn accepts_json_only_for_the_json_kind() {
    let json = Kind::Json;
    assert!(check_response(200, Some("application/json; charset=utf-8"), None, json).is_ok());
    assert!(check_response(200, Some("text/plain"), None, json).is_ok());
    assert!(check_response(200, Some("text/html"), None, json).is_err());
}

#[test]
fn accepts_css_only_for_the_css_kind() {
    let css = Kind::Css;
    assert!(check_response(200, Some("text/css; charset=utf-8"), None, css).is_ok());
    assert!(check_response(200, Some("text/html"), None, css).is_err());
    assert!(check_response(200, Some("text/css"), None, Kind::Html).is_err());
}

#[tokio::test]
async fn refuses_other_hosts_without_a_request() {
    let site = Site {
        host: HOST,
        alt_host: Some("alt.example.com"),
        user_agent: "test/0.1",
    };
    let client = build_client(site).unwrap();
    // 翻訳の API のクライアントも作れる (リダイレクトは, たどらない)
    assert!(build_api_client(site).is_ok());
    let error = fetch_page(&client, site, "https://example.com/")
        .await
        .unwrap_err();
    assert!(error.starts_with("Not a documentation page"));
}
