// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 無料の Google 翻訳 (Web の翻訳が使う、非公式の入口). API キーは、要らない.
//!
//! 公式の API ではないので、仕様が変わったり、混んでいるときや、短い時間に多く送ったときに、
//! 断られたりすることがある. 個人が、自分で読むために使う.
//! プレーンテキストしか翻訳できないので、`PlainBackend` を通して、HTML の構造を保つ.

use std::future::Future;

use tokio::task::JoinSet;
use url::form_urlencoded;

use crate::plain::PlainTranslator;
use crate::translate::{SOURCE, TARGET};

/// 無料の Google 翻訳の入口.
const FREE_URL: &str = "https://translate.googleapis.com/translate_a/single";

/// 同時に送る依頼の数の既定 (多すぎると、断られやすい).
pub const DEFAULT_PARALLEL: usize = 4;

/// 同時に送る依頼の数の上限 (設定で、1 から、これまで選べる).
pub const MAX_PARALLEL: usize = 8;

/// 依頼の本文を作る (URL の長さの制限を避けるため、文章は、POST の本文に入れる).
pub fn free_body(text: &str) -> String {
    form_urlencoded::Serializer::new(String::new())
        .append_pair("client", "gtx")
        .append_pair("sl", SOURCE)
        .append_pair("tl", TARGET)
        .append_pair("dt", "t")
        .append_pair("q", text)
        .finish()
}

/// 応答の JSON (`[[["翻訳","原文",...],...],...]`) から、翻訳をつなげて取り出す.
pub fn parse_free(text: &str) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let parts = value
        .get(0)
        .and_then(|segments| segments.as_array())
        .ok_or_else(|| "Unexpected response from Google Translate".to_string())?;

    Ok(parts
        .iter()
        .filter_map(|part| part.get(0).and_then(|s| s.as_str()))
        .collect())
}

/// ネットワークを止められた応答か (確認の画面 (`google.com/sorry`) へのリダイレクト. 3xx).
pub fn is_blocked(status: u16) -> bool {
    (300..400).contains(&status)
}

/// 同時に送る依頼の数を、1 から上限までに収める.
pub fn clamp_parallel(parallel: usize) -> usize {
    parallel.clamp(1, MAX_PARALLEL)
}

/// 断られたときのメッセージ.
///
/// 自動では、やり直さない (止められている間は、やり直しても断られ、止められる時間が延びることがある).
/// 利用者が、画面の「やり直す」で送り直す.
pub fn free_error(status: u16) -> String {
    if is_blocked(status) {
        format!(
            "Google Translate (free) has blocked this network for unusual traffic (HTTP {status}). Wait a few hours and retry, or use mobile data or another service"
        )
    } else if status == 429 || status == 503 {
        format!(
            "Google Translate (free) is limiting the requests (HTTP {status}). Wait a while and retry, or use another service"
        )
    } else {
        format!("Google Translate (free) failed (HTTP {status})")
    }
}

/// 1 つの文章を翻訳する (空白だけの文章は、そのまま返す).
pub async fn translate_one(client: reqwest::Client, text: String) -> Result<String, String> {
    if text.trim().is_empty() {
        return Ok(text);
    }
    let response = client
        .post(FREE_URL)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(free_body(&text))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if status != 200 {
        return Err(free_error(status));
    }
    // 前後の空白は、翻訳で落ちるので、元のままにそろえる
    let translated = parse_free(&body)?;
    let lead: String = text.chars().take_while(|c| c.is_whitespace()).collect();
    let trail: String = text
        .chars()
        .rev()
        .take_while(|c| c.is_whitespace())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    Ok(format!("{lead}{}{trail}", translated.trim()))
}

/// 無料の Google 翻訳.
pub struct GoogleFree {
    client: reqwest::Client,
    /// 同時に送る依頼の数.
    parallel: usize,
}

impl GoogleFree {
    /// クライアントと、同時に送る依頼の数 (1 から上限までに収める) から作る.
    pub fn new(client: reqwest::Client, parallel: usize) -> Self {
        Self {
            client,
            parallel: clamp_parallel(parallel),
        }
    }
}

impl PlainTranslator for GoogleFree {
    fn translate_plain(
        &self,
        texts: &[String],
    ) -> impl Future<Output = Result<Vec<String>, String>> + Send {
        let client = self.client.clone();
        let texts = texts.to_vec();
        let parallel = self.parallel;

        async move {
            let mut results = vec![String::new(); texts.len()];
            for (batch, chunk) in texts.chunks(parallel).enumerate() {
                let mut tasks = JoinSet::new();
                for (offset, text) in chunk.iter().enumerate() {
                    let (client, text) = (client.clone(), text.clone());
                    tasks.spawn(async move {
                        (batch * parallel + offset, translate_one(client, text).await)
                    });
                }
                while let Some(done) = tasks.join_next().await {
                    let (index, result) = done.map_err(|e| e.to_string())?;
                    results[index] = result?;
                }
            }

            Ok(results)
        }
    }
}
