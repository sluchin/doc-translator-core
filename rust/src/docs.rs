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
    /// 同じパスで, もう 1 つ取得してよいホスト (日本語のサイトと, 英語のサイトの切り替えなど. なければ `None`).
    pub alt_host: Option<&'static str>,
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

impl Site {
    /// URL が, 取得してよいドキュメントのページか (ホストか, もう 1 つのホストに一致).
    pub fn allows(&self, url: &str) -> bool {
        is_doc_url(self.host, url) || self.alt_host.is_some_and(|alt| is_doc_url(alt, url))
    }
}

/// 取得に使う HTTP クライアントを作る (リダイレクトは, ドキュメントのホストの中だけ).
pub fn build_client(site: Site) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(site.user_agent)
        .timeout(TIMEOUT)
        .redirect(Policy::custom(move |attempt| {
            match check_redirect(site, attempt.previous().len(), attempt.url().as_str()) {
                Ok(()) => attempt.follow(),
                Err(reason) => attempt.error(reason),
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

/// リダイレクトをたどってよいか (回数の上限までで, 行き先がドキュメントのホスト).
///
/// `previous` は, これまでにたどった回数. たどれないときは, その理由.
pub fn check_redirect(site: Site, previous: usize, url: &str) -> Result<(), &'static str> {
    if previous >= MAX_REDIRECTS {
        Err("too many redirects")
    } else if site.allows(url) {
        Ok(())
    } else {
        Err("redirected out of the documentation host")
    }
}

/// 翻訳の API に使う HTTP クライアントを作る (リダイレクトは, たどらない).
///
/// 無料の Google 翻訳は, 断るときに, 確認の画面へリダイレクトすることがある. たどらずに, 応答の状態として扱う.
pub fn build_api_client(site: Site) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(site.user_agent)
        .timeout(TIMEOUT)
        .redirect(Policy::none())
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
    /// サイトの CSS (サイトの見た目で表示するため).
    Css,
}

/// ページの HTML を取得する.
pub async fn fetch_page(client: &reqwest::Client, site: Site, url: &str) -> Result<String, String> {
    fetch_text(client, site, url, Kind::Html).await
}

/// サイトのテキスト (HTML, JSON, CSS) を取得する (ホストが違えば, 通信しないで失敗する).
pub async fn fetch_text(
    client: &reqwest::Client,
    site: Site,
    url: &str,
    kind: Kind,
) -> Result<String, String> {
    if !site.allows(url) {
        return Err(format!("Not a documentation page: {url}"));
    }
    get_text(client, url, kind).await
}

/// URL のテキストを取得して, 状態, 種類, 大きさを確かめる (ホストは, 呼ぶ前に確かめておく).
pub async fn get_text(client: &reqwest::Client, url: &str, kind: Kind) -> Result<String, String> {
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
        Kind::Css => value.starts_with("text/css"),
    });
    if !accepted {
        return Err("The page has an unexpected content type".to_string());
    }
    if length.is_some_and(|value| value > MAX_BYTES as u64) {
        return Err("The page is too large".to_string());
    }

    Ok(())
}
