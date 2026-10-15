// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! プレーンテキストしか翻訳できないサービス (ML Kit) のために、HTML の断片を、テキストに直す.
//!
//! タグは `[[0]]` のような目印に置き換えて翻訳に渡し、翻訳のあとで、目印をタグに戻す.
//! 「翻訳しない」印のある要素は、中身ごと 1 つの目印にする. 目印が欠けたり増えたりしたときは、
//! タグの間の文章を 1 つずつ翻訳する.

use std::future::Future;

use regex::Regex;

use crate::translate::Backend;

/// プレーンテキストを翻訳するもの (ML Kit).
pub trait PlainTranslator {
    /// テキストを翻訳する. 同じ数の翻訳を、同じ順で返す.
    fn translate_plain(
        &self,
        texts: &[String],
    ) -> impl Future<Output = Result<Vec<String>, String>> + Send;
}

/// HTML の断片の部品.
#[derive(Debug, Clone, PartialEq)]
pub enum Piece {
    /// 文章 (文字参照を戻したテキスト).
    Text(String),
    /// そのまま残す HTML (タグ、または「翻訳しない」要素の全体).
    Raw(String),
}

/// 字句: タグか、文章.
#[derive(Debug)]
struct Token<'a> {
    raw: &'a str,
    /// タグなら、その情報.
    tag: Option<Tag>,
}

/// タグの情報.
#[derive(Debug)]
struct Tag {
    name: String,
    closing: bool,
    /// 終わりのタグがない (`<br>` や `<img />`).
    void: bool,
    /// `translate="no"` か `notranslate` の class を持つ.
    no_translate: bool,
}

/// 終わりのタグを持たない要素.
const VOID: [&str; 6] = ["br", "img", "wbr", "hr", "input", "meta"];

/// `<` から対応する `>` までの長さ (引用符の中の `>` は無視する). 閉じていなければ None.
fn tag_end(text: &str) -> Option<usize> {
    let mut quote: Option<char> = None;
    for (index, ch) in text.char_indices() {
        match (quote, ch) {
            (Some(q), c) if c == q => quote = None,
            (None, '"' | '\'') => quote = Some(ch),
            (None, '>') => return Some(index + 1),
            _ => {}
        }
    }

    None
}

/// 開きのタグの文字列から、情報を読む.
fn parse_tag(raw: &str) -> Tag {
    let inner = raw.trim_start_matches('<').trim_end_matches('>');
    let closing = inner.starts_with('/');
    let name: String = inner
        .trim_start_matches('/')
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    let lower = inner.to_ascii_lowercase();
    let void = inner.ends_with('/') || VOID.contains(&name.as_str());
    let no_translate = !closing
        && (lower.contains("translate=\"no\"")
            || lower.contains("translate='no'")
            || lower.contains("notranslate"));

    Tag {
        name,
        closing,
        void,
        no_translate,
    }
}

/// HTML の断片を、タグと文章に分ける.
fn tokenize(html: &str) -> Vec<Token<'_>> {
    let mut tokens = Vec::new();
    let mut rest = html;
    while !rest.is_empty() {
        let starts_tag = rest.starts_with('<')
            && rest[1..].starts_with(|c: char| c.is_ascii_alphabetic() || c == '/' || c == '!');
        let end = if starts_tag { tag_end(rest) } else { None };
        match end {
            Some(length) => {
                let raw = &rest[..length];
                let tag = if raw.starts_with("<!") {
                    None
                } else {
                    Some(parse_tag(raw))
                };
                // コメントなどは、タグとして扱わず、そのまま残す文章にしない
                tokens.push(Token { raw, tag });
                rest = &rest[length..];
            }
            None => {
                let next = rest[1..].find('<').map_or(rest.len(), |i| i + 1);
                tokens.push(Token {
                    raw: &rest[..next],
                    tag: None,
                });
                rest = &rest[next..];
            }
        }
    }

    tokens
}

/// 文字参照を、文字に戻す (よく使うものと、数値).
pub fn decode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        let decoded = rest.find(';').filter(|&end| end <= 10).and_then(|end| {
            let name = &rest[1..end];
            let ch = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" | "#39" => Some('\''),
                "nbsp" => Some(' '),
                _ => name
                    .strip_prefix("#x")
                    .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                    .or_else(|| name.strip_prefix('#').and_then(|dec| dec.parse().ok()))
                    .and_then(char::from_u32),
            };
            ch.map(|c| (c, end + 1))
        });
        match decoded {
            Some((ch, length)) => {
                out.push(ch);
                rest = &rest[length..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);

    out
}

/// 文字を、HTML の文章にできるよう、エスケープする.
pub fn encode(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// 文章に、翻訳する英字があるか.
fn has_letters(text: &str) -> bool {
    text.chars().any(|c| c.is_ascii_alphabetic())
}

/// 「翻訳しない」要素の終わり (対応する閉じタグの次の字句の位置) を探す.
fn element_end(tokens: &[Token<'_>], start: usize) -> Option<usize> {
    let name = &tokens[start].tag.as_ref()?.name;
    let mut depth = 0usize;
    for (offset, token) in tokens[start..].iter().enumerate() {
        if let Some(tag) = token
            .tag
            .as_ref()
            .filter(|tag| &tag.name == name && !tag.void)
        {
            if tag.closing {
                depth -= 1;
                if depth == 0 {
                    return Some(start + offset + 1);
                }
            } else {
                depth += 1;
            }
        }
    }

    None
}

/// 断片を、部品に分ける.
pub fn pieces(html: &str) -> Vec<Piece> {
    let tokens = tokenize(html);
    let mut out = Vec::new();
    let mut index = 0;
    while index < tokens.len() {
        let token = &tokens[index];
        let whole = match &token.tag {
            Some(tag) if tag.no_translate && !tag.void => element_end(&tokens, index),
            _ => None,
        };
        if let Some(end) = whole {
            out.push(Piece::Raw(
                tokens[index..end].iter().map(|t| t.raw).collect(),
            ));
            index = end;
        } else if token.tag.is_some() || token.raw.starts_with("<!") {
            out.push(Piece::Raw(token.raw.to_string()));
            index += 1;
        } else {
            out.push(Piece::Text(decode(token.raw)));
            index += 1;
        }
    }

    out
}

/// ML Kit に 1 回で渡す文章の長さの上限 (文字数). 長い文章は、遅くなる (止まったように見える) ので、
/// 文の切れ目で分けて、順に翻訳する.
const MAX_CHUNK: usize = 400;

/// 文章を、文の切れ目 (`.` `!` `?` `。` の後の空白) で、上限の長さ以下のまとまりに分ける.
///
/// 1 つの文が、上限より長いときは、単語の切れ目で分ける. 前後の空白は、取り除く.
pub fn split_sentences(text: &str, max: usize) -> Vec<String> {
    let mut sentences: Vec<&str> = Vec::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((index, ch)) = chars.next() {
        let ends = matches!(ch, '.' | '!' | '?' | '。')
            && chars.peek().is_none_or(|(_, next)| next.is_whitespace());
        if ends {
            sentences.push(&text[start..index + ch.len_utf8()]);
            start = index + ch.len_utf8();
        }
    }
    sentences.push(&text[start..]);

    let mut chunks: Vec<String> = Vec::new();
    for sentence in sentences.iter().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        match chunks.last_mut() {
            Some(last) if last.chars().count() + 1 + sentence.chars().count() <= max => {
                last.push(' ');
                last.push_str(sentence);
            }
            _ => chunks.push(sentence.to_string()),
        }
    }

    chunks
        .into_iter()
        .flat_map(|chunk| split_words(&chunk, max))
        .collect()
}

/// 上限より長いまとまりを、単語の切れ目で分ける (空白がなければ、そのまま).
fn split_words(text: &str, max: usize) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();
    for word in text.split(' ') {
        match parts.last_mut() {
            Some(last) if last.chars().count() + 1 + word.chars().count() <= max => {
                last.push(' ');
                last.push_str(word);
            }
            _ => parts.push(word.to_string()),
        }
    }

    parts
}

/// 目印の正規表現 (ブラケットは、全角や隅付きに変わることがある).
fn marker() -> Regex {
    Regex::new(r"[\[［【]{2}\s*(\d+)\s*[\]］】]{2}").expect("the pattern is valid")
}

/// 部品を、目印つきのテキストにする (Raw は、順に `[[0]]` `[[1]]`...).
pub fn to_template(parts: &[Piece]) -> String {
    let mut count = 0;
    parts
        .iter()
        .map(|part| match part {
            Piece::Text(text) => text.clone(),
            Piece::Raw(_) => {
                count += 1;
                format!("[[{}]]", count - 1)
            }
        })
        .collect()
}

/// 翻訳されたテキストの目印を、元の HTML に戻す. 目印が過不足なく 1 回ずつあるときだけ Some.
pub fn restore(translated: &str, parts: &[Piece]) -> Option<String> {
    let raws: Vec<&String> = parts
        .iter()
        .filter_map(|part| {
            if let Piece::Raw(raw) = part {
                Some(raw)
            } else {
                None
            }
        })
        .collect();
    let mut seen = vec![false; raws.len()];
    let mut out = String::new();
    let mut last = 0;
    for found in marker().captures_iter(translated) {
        let whole = found.get(0)?;
        let index: usize = found[1].parse().ok()?;
        let slot = seen.get_mut(index)?;
        if *slot {
            return None;
        }
        *slot = true;
        out.push_str(&encode(&translated[last..whole.start()]));
        out.push_str(raws[index]);
        last = whole.end();
    }
    out.push_str(&encode(&translated[last..]));

    seen.iter().all(|&flag| flag).then_some(out)
}

/// 部品の文章を 1 つずつ翻訳した結果から、HTML を組み立てる.
fn assemble(parts: &[Piece], translated: &mut impl Iterator<Item = String>) -> String {
    parts
        .iter()
        .map(|part| match part {
            Piece::Raw(raw) => raw.clone(),
            Piece::Text(text) if has_letters(text) => {
                let result = translated.next().unwrap_or_else(|| text.clone());
                // 前後の空白は、タグとの間の区切りなので、残す
                let lead = &text[..text.len() - text.trim_start().len()];
                let trail = &text[text.trim_end().len()..];
                format!("{lead}{}{trail}", encode(result.trim()))
            }
            Piece::Text(text) => encode(text),
        })
        .collect()
}

/// ML Kit のように、プレーンテキストを翻訳するものを、`Backend` にする.
pub struct PlainBackend<P: PlainTranslator> {
    /// 中身のプレーンテキストの翻訳 (テストが、呼び出しを調べる).
    pub plain: P,
}

impl<P: PlainTranslator> PlainBackend<P> {
    /// プレーンテキストの翻訳から作る.
    pub fn new(plain: P) -> Self {
        Self { plain }
    }

    /// 長い文章を、文の切れ目で分けて、まとめて翻訳して、つなぎ直す (前後の空白は、残す).
    async fn translate_split(&self, texts: &[String]) -> Result<Vec<String>, String> {
        let split: Vec<Vec<String>> = texts
            .iter()
            .map(|text| split_sentences(text, MAX_CHUNK))
            .collect();
        let flat: Vec<String> = split.iter().flatten().cloned().collect();
        let mut translated = if flat.is_empty() {
            Vec::new()
        } else {
            self.plain.translate_plain(&flat).await?
        };
        if translated.len() != flat.len() {
            return Err("ML Kit returned a different number of texts".to_string());
        }
        translated.reverse();

        Ok(texts
            .iter()
            .zip(&split)
            .map(|(text, chunks)| {
                let joined: Vec<String> = chunks
                    .iter()
                    .map(|_| translated.pop().unwrap_or_default())
                    .collect();
                let lead = &text[..text.len() - text.trim_start().len()];
                let trail = &text[text.trim_end().len()..];
                format!("{lead}{}{trail}", joined.join(" "))
            })
            .collect())
    }
}

impl<P: PlainTranslator + Sync> Backend for PlainBackend<P> {
    fn translate(
        &self,
        texts: &[String],
    ) -> impl Future<Output = Result<Vec<String>, String>> + Send {
        let parts: Vec<Vec<Piece>> = texts.iter().map(|text| pieces(text)).collect();

        async move {
            // 1 回目: 目印つきのテキストを、まとめて翻訳する
            let targets: Vec<usize> = (0..parts.len())
                .filter(|&i| {
                    parts[i]
                        .iter()
                        .any(|p| matches!(p, Piece::Text(t) if has_letters(t)))
                })
                .collect();
            let templates: Vec<String> = targets.iter().map(|&i| to_template(&parts[i])).collect();
            let first = self.translate_split(&templates).await?;
            let mut results: Vec<Option<String>> = vec![None; parts.len()];
            let mut retry = Vec::new();
            for (&i, translated) in targets.iter().zip(&first) {
                match restore(translated, &parts[i]) {
                    Some(html) => results[i] = Some(html),
                    None => retry.push(i),
                }
            }
            // 2 回目: 目印が崩れたものは、タグの間の文章を 1 つずつ翻訳する
            let singles: Vec<String> = retry
                .iter()
                .flat_map(|&i| parts[i].iter())
                .filter_map(|p| match p {
                    Piece::Text(t) if has_letters(t) => Some(t.trim().to_string()),
                    _ => None,
                })
                .collect();
            let mut second = self.translate_split(&singles).await?;
            second.reverse();
            let mut iterator = std::iter::from_fn(move || second.pop());
            for &i in &retry {
                results[i] = Some(assemble(&parts[i], &mut iterator));
            }

            Ok(texts
                .iter()
                .zip(results)
                .map(|(text, result)| result.unwrap_or_else(|| text.clone()))
                .collect())
        }
    }
}
