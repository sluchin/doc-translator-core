// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 翻訳. 翻訳サービス (バックエンド) と, 翻訳の結果のキャッシュ.

use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::task::JoinSet;

/// 翻訳先の言語.
pub const TARGET: &str = "ja";

/// Gemini の API のアドレスの前半.
const GEMINI_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

/// Gemini に、やり直す回数 (混んでいるとき: 429 と 503).
const GEMINI_RETRIES: u32 = 2;

/// Gemini に、1 回の依頼で渡す文章の数 (小さく分けるほど、1 回の応答 (出力の長さ) が短く、速い).
pub const GEMINI_BATCH: usize = 10;

/// Gemini に、同時に送る依頼の数.
pub const GEMINI_PARALLEL: usize = 4;

/// Gemini の指示 (システムプロンプト).
const GEMINI_PROMPT: &str = "You translate fragments of software technical documentation (programming languages, libraries, operating systems) from English to Japanese. \
The input is a JSON array of HTML fragments. Return a JSON array of strings with exactly the same length and order; \
each output string is the Japanese translation of the input fragment at the same index. \
Rules: keep every HTML tag and attribute exactly as it is, and keep the tags in the translation. \
Never translate or change the content of elements with translate=\"no\" or class \"notranslate\". \
Do not translate identifiers, API, type and function names, configuration symbols, keywords, file paths, commands, and code. \
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
    pub fn get(&self, key: &str) -> Option<&String> {
        self.map.get(key)
    }

    /// 翻訳を足す (上限を超えたら, 古いものを捨てる).
    pub fn insert(&mut self, key: String, value: String) {
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
    pub fn len(&self) -> usize {
        self.map.len()
    }

    /// 空か.
    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
}

/// 既定の上限のキャッシュを, JSON から読む.
pub fn load_cache(text: &str) -> Cache {
    Cache::from_json(text, CACHE_CAPACITY)
}

/// キャッシュのキー (サービスの名前と文章から作る. サービスが違えば、翻訳も違う).
pub fn cache_key(namespace: &str, text: &str) -> String {
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

/// キャッシュにある翻訳を返す (通信しない). キャッシュにない文章は, None.
pub fn lookup_cache(
    cache: &Mutex<Cache>,
    namespace: &str,
    texts: &[String],
) -> Result<Vec<Option<String>>, String> {
    let guard = cache.lock().map_err(|e| e.to_string())?;

    Ok(texts
        .iter()
        .map(|text| guard.get(&cache_key(namespace, text)).cloned())
        .collect())
}

/// キャッシュを使って翻訳する. キャッシュにある文章は, バックエンドに渡さない.
///
/// キャッシュにない文章は, `batch` 個ずつバックエンドに渡して, 翻訳できたらすぐにキャッシュに入れる
/// (途中で断られても, それまでに翻訳できた分は, 捨てない). 返すのは, 翻訳と, キャッシュに足した数.
pub async fn translate_with_cache<B: Backend>(
    cache: &Mutex<Cache>,
    backend: &B,
    namespace: &str,
    texts: &[String],
    batch: usize,
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
    for part in missing.chunks(batch.max(1)) {
        let translated = backend.translate(part).await?;
        if translated.len() != part.len() {
            return Err("The translation service returned a different number of texts".to_string());
        }
        let mut guard = cache.lock().map_err(|e| e.to_string())?;
        for (text, result) in part.iter().zip(translated) {
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
pub fn google_body(texts: &[String]) -> String {
    serde_json::to_string(&GoogleRequest {
        q: texts,
        source: SOURCE,
        target: TARGET,
        format: "html",
    })
    .unwrap_or_default()
}

/// 応答の JSON から, 翻訳を取り出す.
pub fn parse_google(text: &str) -> Result<Vec<String>, String> {
    let response: GoogleResponse = serde_json::from_str(text).map_err(|e| e.to_string())?;

    Ok(response
        .data
        .translations
        .into_iter()
        .map(|item| item.translated_text)
        .collect())
}

/// エラーの応答から, メッセージを取り出す (読めなければ, 状態だけ).
pub fn google_error(status: u16, text: &str) -> String {
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
    /// モデルが、考える機能を切る設定 (`thinkingBudget: 0`) を断ったとき true (以後は、設定を付けない).
    thinking_rejected: Arc<AtomicBool>,
}

impl GeminiBackend {
    /// クライアント, API キー, モデルから作る.
    pub fn new(client: reqwest::Client, api_key: String, model: String) -> Self {
        Self {
            client,
            api_key,
            model,
            thinking_rejected: Arc::new(AtomicBool::new(false)),
        }
    }

    /// 依頼を送る先.
    pub fn url(&self) -> String {
        format!("{GEMINI_URL}/{}:generateContent", self.model)
    }
}

/// Gemini の依頼の本文を作る (入力は JSON の配列、出力も文字列の JSON の配列にさせる).
///
/// `no_thinking` が true のときは、考える機能を切る (`thinkingBudget: 0`). 翻訳には、考える時間が要らず、
/// 切ると、応答が、ずっと速い.
pub fn gemini_body(texts: &[String], no_thinking: bool) -> String {
    let mut config = serde_json::json!({
        "temperature": 0.2,
        "responseMimeType": "application/json",
        "responseSchema": { "type": "ARRAY", "items": { "type": "STRING" } },
    });
    if no_thinking {
        config["thinkingConfig"] = serde_json::json!({ "thinkingBudget": 0 });
    }
    serde_json::json!({
        "systemInstruction": { "parts": [{ "text": GEMINI_PROMPT }] },
        "contents": [{
            "role": "user",
            "parts": [{ "text": serde_json::to_string(texts).unwrap_or_default() }],
        }],
        "generationConfig": config,
    })
    .to_string()
}

/// 考える機能を切る設定を、モデルが断った応答か (400 で、メッセージに thinking とある).
pub fn rejects_thinking(status: u16, body: &str) -> bool {
    status == 400 && body.to_ascii_lowercase().contains("thinking")
}

/// 文章を、1 回の依頼の大きさ (`size` 個) に分ける (順は変えない).
pub fn split_batches(texts: &[String], size: usize) -> Vec<Vec<String>> {
    texts.chunks(size.max(1)).map(<[String]>::to_vec).collect()
}

/// Gemini の応答から、翻訳を取り出す (配列の長さが依頼と違えば、失敗).
pub fn parse_gemini(text: &str, expected: usize) -> Result<Vec<String>, String> {
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
pub fn is_retryable(status: u16) -> bool {
    status == 429 || status == 503
}

/// やり直す前に待つ秒数 (やり直しの回数が増えるほど、長く).
pub fn retry_delay(attempt: u32) -> std::time::Duration {
    std::time::Duration::from_secs(2 * u64::from(attempt + 1))
}

/// Gemini に、1 回の依頼を送って、翻訳を受け取る (混んでいるときは、やり直す. 考える機能を断られたら、切らずに送り直す).
async fn gemini_request(
    client: reqwest::Client,
    url: String,
    key: String,
    texts: Vec<String>,
    thinking_rejected: Arc<AtomicBool>,
) -> Result<Vec<String>, String> {
    let mut attempt = 0;
    loop {
        let no_thinking = !thinking_rejected.load(Ordering::Relaxed);
        let response = client
            .post(&url)
            .header("x-goog-api-key", &key)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(gemini_body(&texts, no_thinking))
            .timeout(std::time::Duration::from_secs(120))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = response.status().as_u16();
        let text = response.text().await.map_err(|e| e.to_string())?;
        if status == 200 {
            return parse_gemini(&text, texts.len());
        }
        if no_thinking && rejects_thinking(status, &text) {
            // このモデルは、考える機能を切れない. 設定を付けずに、送り直す
            thinking_rejected.store(true, Ordering::Relaxed);
        } else if is_retryable(status) && attempt < GEMINI_RETRIES {
            tokio::time::sleep(retry_delay(attempt)).await;
            attempt += 1;
        } else {
            return Err(google_error(status, &text).replace("Translation", "Gemini request"));
        }
    }
}

impl Backend for GeminiBackend {
    fn translate(
        &self,
        texts: &[String],
    ) -> impl Future<Output = Result<Vec<String>, String>> + Send {
        let url = self.url();
        let batches = split_batches(texts, GEMINI_BATCH);
        let client = self.client.clone();
        let key = self.api_key.clone();
        let rejected = self.thinking_rejected.clone();

        // 小さく分けて、GEMINI_PARALLEL 個ずつ、同時に送る (1 つが失敗したら、残りは、やめる)
        async move {
            let mut results = Vec::new();
            for wave in batches.chunks(GEMINI_PARALLEL) {
                let mut tasks = JoinSet::new();
                for (index, batch) in wave.iter().enumerate() {
                    let request = gemini_request(
                        client.clone(),
                        url.clone(),
                        key.clone(),
                        batch.clone(),
                        rejected.clone(),
                    );
                    tasks.spawn(async move { (index, request.await) });
                }
                let mut parts = vec![Vec::new(); wave.len()];
                while let Some(done) = tasks.join_next().await {
                    let (index, result) = done.map_err(|e| e.to_string())?;
                    parts[index] = result?;
                }
                results.extend(parts.into_iter().flatten());
            }

            Ok(results)
        }
    }
}
