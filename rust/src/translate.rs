// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 翻訳. 翻訳サービス (バックエンド) と, 翻訳の結果のキャッシュ.

use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// 翻訳先の言語.
pub const TARGET: &str = "ja";

/// Gemini の API のアドレスの前半.
const GEMINI_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

/// Gemini に、やり直す回数 (混んでいるとき: 429 と 503).
const GEMINI_RETRIES: u32 = 2;

/// Gemini の指示 (システムプロンプト).
const GEMINI_PROMPT: &str = "You translate fragments of the Zephyr RTOS technical documentation from English to Japanese. \
The input is a JSON array of HTML fragments. Return a JSON array of strings with exactly the same length and order; \
each output string is the Japanese translation of the input fragment at the same index. \
Rules: keep every HTML tag and attribute exactly as it is, and keep the tags in the translation. \
Never translate or change the content of elements with translate=\"no\" or class \"notranslate\". \
Do not translate identifiers, API and function names, Kconfig and devicetree symbols, file paths, commands, and code. \
Use a natural, accurate technical Japanese style (です・ます調). Do not add explanations.";

/// 翻訳元の言語.
pub const SOURCE: &str = "en";

/// キャッシュに残す文章の数の上限 (超えたら, 古いものから捨てる).
const CACHE_CAPACITY: usize = 20_000;

/// Google Cloud Translation (Basic, v2) の URL.
const GOOGLE_URL: &str = "https://translation.googleapis.com/language/translate/v2";

/// 翻訳サービス. HTML の断片を, 構造を保って翻訳する.
pub trait Backend {
    /// 文章 (HTML の断片) を翻訳する. 同じ数の翻訳を, 同じ順で返す.
    fn translate(
        &self,
        texts: &[String],
    ) -> impl Future<Output = Result<Vec<String>, String>> + Send;
}

/// 翻訳の結果のキャッシュ (同じ文章を, もう一度翻訳しないため. 翻訳の費用を減らす).
#[derive(Debug, Default)]
pub struct Cache {
    map: HashMap<String, String>,
    order: VecDeque<String>,
    capacity: usize,
}

/// キャッシュのファイルの 1 行 (保存の形式).
#[derive(Serialize, Deserialize)]
struct Entry {
    key: String,
    value: String,
}

impl Cache {
    /// 上限を決めて, 空のキャッシュを作る.
    pub fn new(capacity: usize) -> Self {
        Self {
            map: HashMap::new(),
            order: VecDeque::new(),
            capacity,
        }
    }

    /// 文章の翻訳を探す.
    fn get(&self, key: &str) -> Option<&String> {
        self.map.get(key)
    }

    /// 翻訳を足す (上限を超えたら, 古いものを捨てる).
    fn insert(&mut self, key: String, value: String) {
        if self.map.insert(key.clone(), value).is_none() {
            self.order.push_back(key);
        }
        while self.order.len() > self.capacity {
            if let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
            }
        }
    }

    /// 保存する JSON にする (古い順).
    pub fn to_json(&self) -> String {
        let entries: Vec<Entry> = self
            .order
            .iter()
            .filter_map(|key| {
                self.map.get(key).map(|value| Entry {
                    key: key.clone(),
                    value: value.clone(),
                })
            })
            .collect();
        serde_json::to_string(&entries).unwrap_or_default()
    }

    /// JSON から読む (読めなければ, 空).
    pub fn from_json(text: &str, capacity: usize) -> Self {
        let mut cache = Self::new(capacity);
        for entry in serde_json::from_str::<Vec<Entry>>(text).unwrap_or_default() {
            cache.insert(entry.key, entry.value);
        }
        cache
    }

    /// 数.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.map.len()
    }

    /// 空か.
    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
}

/// 既定の上限のキャッシュを, JSON から読む.
pub fn load_cache(text: &str) -> Cache {
    Cache::from_json(text, CACHE_CAPACITY)
}

/// キャッシュのキー (サービスの名前と文章から作る. サービスが違えば、翻訳も違う).
fn cache_key(namespace: &str, text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(namespace.as_bytes());
    hasher.update([0]);
    hasher.update(text.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// キャッシュを使って翻訳する. キャッシュにある文章は, バックエンドに渡さない.
///
/// 返すのは, 翻訳と, キャッシュに足した数.
pub async fn translate_with_cache<B: Backend>(
    cache: &Mutex<Cache>,
    backend: &B,
    namespace: &str,
    texts: &[String],
) -> Result<(Vec<String>, usize), String> {
    let keys: Vec<String> = texts
        .iter()
        .map(|text| cache_key(namespace, text))
        .collect();
    let (mut missing, mut seen) = (Vec::new(), HashSet::new());
    {
        let guard = cache.lock().map_err(|e| e.to_string())?;
        for (key, text) in keys.iter().zip(texts) {
            if guard.get(key).is_none() && seen.insert(key.clone()) {
                missing.push(text.clone());
            }
        }
    }
    let added = missing.len();
    if !missing.is_empty() {
        let translated = backend.translate(&missing).await?;
        if translated.len() != missing.len() {
            return Err("The translation service returned a different number of texts".to_string());
        }
        let mut guard = cache.lock().map_err(|e| e.to_string())?;
        for (text, result) in missing.iter().zip(translated) {
            guard.insert(cache_key(namespace, text), result);
        }
    }
    let guard = cache.lock().map_err(|e| e.to_string())?;
    let results = keys
        .iter()
        .zip(texts)
        .map(|(key, text)| guard.get(key).cloned().unwrap_or_else(|| text.clone()))
        .collect();

    Ok((results, added))
}

/// Google Cloud Translation (Basic, v2). API キーは, 利用者が自分のものを設定する.
pub struct GoogleBackend {
    client: reqwest::Client,
    api_key: String,
}

/// Google の依頼の本文.
#[derive(Serialize)]
struct GoogleRequest<'a> {
    q: &'a [String],
    source: &'a str,
    target: &'a str,
    format: &'a str,
}

/// Google の応答.
#[derive(Deserialize)]
struct GoogleResponse {
    data: GoogleData,
}

/// Google の応答の data.
#[derive(Deserialize)]
struct GoogleData {
    translations: Vec<GoogleTranslation>,
}

/// Google の応答の 1 つの翻訳.
#[derive(Deserialize)]
struct GoogleTranslation {
    #[serde(rename = "translatedText")]
    translated_text: String,
}

impl GoogleBackend {
    /// クライアントと API キーから作る.
    pub fn new(client: reqwest::Client, api_key: String) -> Self {
        Self { client, api_key }
    }
}

/// 依頼の本文を作る (HTML の形式で, コードなどの「翻訳しない」印を守らせる).
fn google_body(texts: &[String]) -> String {
    serde_json::to_string(&GoogleRequest {
        q: texts,
        source: SOURCE,
        target: TARGET,
        format: "html",
    })
    .unwrap_or_default()
}

/// 応答の JSON から, 翻訳を取り出す.
fn parse_google(text: &str) -> Result<Vec<String>, String> {
    let response: GoogleResponse = serde_json::from_str(text).map_err(|e| e.to_string())?;

    Ok(response
        .data
        .translations
        .into_iter()
        .map(|item| item.translated_text)
        .collect())
}

/// エラーの応答から, メッセージを取り出す (読めなければ, 状態だけ).
fn google_error(status: u16, text: &str) -> String {
    let message = serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|value| value["error"]["message"].as_str().map(str::to_string));

    match message {
        Some(message) => format!("Translation failed (HTTP {status}): {message}"),
        None => format!("Translation failed (HTTP {status})"),
    }
}

impl Backend for GoogleBackend {
    fn translate(
        &self,
        texts: &[String],
    ) -> impl Future<Output = Result<Vec<String>, String>> + Send {
        let request = self
            .client
            .post(GOOGLE_URL)
            .header("X-goog-api-key", &self.api_key)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(google_body(texts));

        async move {
            let response = request.send().await.map_err(|e| e.to_string())?;
            let status = response.status().as_u16();
            let text = response.text().await.map_err(|e| e.to_string())?;
            if status != 200 {
                return Err(google_error(status, &text));
            }
            parse_google(&text)
        }
    }
}

/// Gemini API. キーは、利用者が自分のものを設定する.
pub struct GeminiBackend {
    client: reqwest::Client,
    api_key: String,
    model: String,
}

impl GeminiBackend {
    /// クライアント, API キー, モデルから作る.
    pub fn new(client: reqwest::Client, api_key: String, model: String) -> Self {
        Self {
            client,
            api_key,
            model,
        }
    }

    /// 依頼を送る先.
    fn url(&self) -> String {
        format!("{GEMINI_URL}/{}:generateContent", self.model)
    }
}

/// Gemini の依頼の本文を作る (入力は JSON の配列、出力も文字列の JSON の配列にさせる).
fn gemini_body(texts: &[String]) -> String {
    serde_json::json!({
        "systemInstruction": { "parts": [{ "text": GEMINI_PROMPT }] },
        "contents": [{
            "role": "user",
            "parts": [{ "text": serde_json::to_string(texts).unwrap_or_default() }],
        }],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json",
            "responseSchema": { "type": "ARRAY", "items": { "type": "STRING" } },
        },
    })
    .to_string()
}

/// Gemini の応答から、翻訳を取り出す (配列の長さが依頼と違えば、失敗).
fn parse_gemini(text: &str, expected: usize) -> Result<Vec<String>, String> {
    let value: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if let Some(reason) = value["promptFeedback"]["blockReason"].as_str() {
        return Err(format!("Gemini blocked the request: {reason}"));
    }
    let answer: String = value["candidates"][0]["content"]["parts"]
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| part["text"].as_str())
                .collect()
        })
        .unwrap_or_default();
    let texts: Vec<String> = serde_json::from_str(&answer)
        .map_err(|_| "Gemini returned an unexpected answer".to_string())?;
    if texts.len() != expected {
        return Err("Gemini returned a different number of texts".to_string());
    }

    Ok(texts)
}

/// 混んでいるときの応答 (少し待って、やり直す).
fn is_retryable(status: u16) -> bool {
    status == 429 || status == 503
}

/// やり直す前に待つ秒数 (やり直しの回数が増えるほど、長く).
fn retry_delay(attempt: u32) -> std::time::Duration {
    std::time::Duration::from_secs(2 * u64::from(attempt + 1))
}

impl Backend for GeminiBackend {
    fn translate(
        &self,
        texts: &[String],
    ) -> impl Future<Output = Result<Vec<String>, String>> + Send {
        let url = self.url();
        let body = gemini_body(texts);
        let expected = texts.len();
        let client = self.client.clone();
        let key = self.api_key.clone();

        async move {
            let mut attempt = 0;
            loop {
                let response = client
                    .post(&url)
                    .header("x-goog-api-key", &key)
                    .header(reqwest::header::CONTENT_TYPE, "application/json")
                    .body(body.clone())
                    .timeout(std::time::Duration::from_secs(120))
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                let status = response.status().as_u16();
                let text = response.text().await.map_err(|e| e.to_string())?;
                if status == 200 {
                    return parse_gemini(&text, expected);
                }
                if is_retryable(status) && attempt < GEMINI_RETRIES {
                    tokio::time::sleep(retry_delay(attempt)).await;
                    attempt += 1;
                } else {
                    return Err(
                        google_error(status, &text).replace("Translation", "Gemini request")
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

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

        let response = r#"{"data":{"translations":[{"translatedText":"<p>やあ</p>"},{"translatedText":"b"}]}}"#;
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
}
