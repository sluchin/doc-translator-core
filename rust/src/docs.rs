// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! ドキュメントのページの取得 (サイトのホストだけ).

use std::time::Duration;

use reqwest::redirect::Policy;
use url::Url;

/// 取得するサイトの設定 (アプリごとに 1 つ).
#[derive(Debug, Clone, Copy)]
pub struct Site {
    /// 取得してよいホスト (これ以外へは, リダイレクトもしない).
    pub host: &'static str,
    /// サイトに名乗る User-Agent.
    pub user_agent: &'static str,
}

/// ページの大きさの上限 (バイト).
pub const MAX_BYTES: usize = 8 * 1024 * 1024;

/// リダイレクトをたどる回数の上限.
const MAX_REDIRECTS: usize = 5;

/// 通信の時間切れ.
const TIMEOUT: Duration = Duration::from_secs(30);

/// URL が, 取得してよいドキュメントのページか (https で, ホストが一致).
pub fn is_doc_url(host: &str, url: &str) -> bool {
    Url::parse(url)
        .map(|parsed| parsed.scheme() == "https" && parsed.host_str() == Some(host))
        .unwrap_or(false)
}

/// 取得に使う HTTP クライアントを作る (リダイレクトは, ドキュメントのホストの中だけ).
pub fn build_client(site: Site) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(site.user_agent)
        .timeout(TIMEOUT)
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                attempt.error("too many redirects")
            } else if is_doc_url(site.host, attempt.url().as_str()) {
                attempt.follow()
            } else {
                attempt.error("redirected out of the documentation host")
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

/// 取得するものの種類.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// ページの HTML.
    Html,
    /// サイトの JSON ファイル (メニューなど).
    Json,
}

/// ページの HTML を取得する.
pub async fn fetch_page(client: &reqwest::Client, host: &str, url: &str) -> Result<String, String> {
    fetch_text(client, host, url, Kind::Html).await
}

/// サイトのテキスト (HTML か JSON) を取得する (ホストが違えば, 通信しないで失敗する).
pub async fn fetch_text(
    client: &reqwest::Client,
    host: &str,
    url: &str,
    kind: Kind,
) -> Result<String, String> {
    if !is_doc_url(host, url) {
        return Err(format!("Not a documentation page: {url}"));
    }
    let response = client.get(url).send().await.map_err(|e| e.to_string())?;
    check_response(
        response.status().as_u16(),
        response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        response.content_length(),
        kind,
    )?;
    let text = response.text().await.map_err(|e| e.to_string())?;
    if text.len() > MAX_BYTES {
        return Err("The page is too large".to_string());
    }

    Ok(text)
}

/// 応答の状態, 種類, 大きさを確かめる.
pub fn check_response(
    status: u16,
    content_type: Option<&str>,
    length: Option<u64>,
    kind: Kind,
) -> Result<(), String> {
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status}"));
    }
    let accepted = content_type.is_some_and(|value| match kind {
        Kind::Html => value.starts_with("text/html"),
        Kind::Json => value.contains("json") || value.starts_with("text/plain"),
    });
    if !accepted {
        return Err("The page has an unexpected content type".to_string());
    }
    if length.is_some_and(|value| value > MAX_BYTES as u64) {
        return Err("The page is too large".to_string());
    }

    Ok(())
}
