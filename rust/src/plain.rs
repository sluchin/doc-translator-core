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
enum Piece {
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
fn decode(text: &str) -> String {
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
fn encode(text: &str) -> String {
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
fn pieces(html: &str) -> Vec<Piece> {
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

/// 目印の正規表現 (ブラケットは、全角や隅付きに変わることがある).
fn marker() -> Regex {
    Regex::new(r"[\[［【]{2}\s*(\d+)\s*[\]］】]{2}").expect("the pattern is valid")
}

/// 部品を、目印つきのテキストにする (Raw は、順に `[[0]]` `[[1]]`...).
fn to_template(parts: &[Piece]) -> String {
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
fn restore(translated: &str, parts: &[Piece]) -> Option<String> {
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
    plain: P,
}

impl<P: PlainTranslator> PlainBackend<P> {
    /// プレーンテキストの翻訳から作る.
    pub fn new(plain: P) -> Self {
        Self { plain }
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
            let first = self.plain.translate_plain(&templates).await?;
            if first.len() != templates.len() {
                return Err("ML Kit returned a different number of texts".to_string());
            }
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
            let mut second = if singles.is_empty() {
                Vec::new()
            } else {
                self.plain.translate_plain(&singles).await?
            };
            if second.len() != singles.len() {
                return Err("ML Kit returned a different number of texts".to_string());
            }
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

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    /// 偽の ML Kit: 設定した関数で変換して、渡されたテキストを記録する.
    struct Fake {
        calls: Mutex<Vec<Vec<String>>>,
        convert: fn(&str) -> String,
        wrong_count: bool,
    }

    impl Fake {
        fn new(convert: fn(&str) -> String) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                convert,
                wrong_count: false,
            }
        }
    }

    impl PlainTranslator for Fake {
        fn translate_plain(
            &self,
            texts: &[String],
        ) -> impl Future<Output = Result<Vec<String>, String>> + Send {
            self.calls.lock().unwrap().push(texts.to_vec());
            let result = if self.wrong_count {
                Vec::new()
            } else {
                texts.iter().map(|t| (self.convert)(t)).collect()
            };
            async move { Ok(result) }
        }
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    const SAMPLE: &str = "Call <code translate=\"no\" class=\"notranslate\">f(<b>x</b>)</code> and read <a href=\"#a>b\">this &amp; that</a> now.";

    #[test]
    fn splits_into_pieces_and_makes_the_template() {
        let parts = pieces(SAMPLE);
        assert_eq!(parts.len(), 7);
        assert_eq!(
            parts[1],
            Piece::Raw(
                "<code translate=\"no\" class=\"notranslate\">f(<b>x</b>)</code>".to_string()
            )
        );
        assert_eq!(parts[4], Piece::Text("this & that".to_string()));
        assert_eq!(
            to_template(&parts),
            "Call [[0]] and read [[1]]this & that[[2]] now."
        );
    }

    #[test]
    fn restores_tolerantly_and_rejects_broken_markers() {
        let parts = pieces(SAMPLE);
        let html = restore(
            "[[0]] を呼び、【【 1 】】これと&それ［［2］］を読む。",
            &parts,
        )
        .unwrap();
        assert!(html.starts_with("<code translate=\"no\""));
        assert!(html.contains("<a href=\"#a>b\">これと&amp;それ</a>"));
        assert!(restore("[[0]] と [[1]] だけ", &parts).is_none());
        assert!(restore("[[0]] [[0]] [[1]] [[2]]", &parts).is_none());
        assert!(restore("[[0]] [[1]] [[2]] [[9]]", &parts).is_none());
    }

    #[test]
    fn decodes_and_encodes_the_entities() {
        assert_eq!(
            decode(
                "a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x41;&#66; x&nbsp;y &unknown; &"
            ),
            "a & b <c> \"d\" 'e' AB x y &unknown; &"
        );
        assert_eq!(decode("&#xD800;&#99999999999;"), "&#xD800;&#99999999999;");
        assert_eq!(encode("a<b>&c"), "a&lt;b&gt;&amp;c");
    }

    #[test]
    fn handles_void_tags_comments_and_broken_tags() {
        let parts = pieces("A<br>B<img src=x />C<!-- c -->D<p");
        assert_eq!(
            parts.iter().filter(|p| matches!(p, Piece::Raw(_))).count(),
            3
        );
        assert_eq!(
            pieces("<x translate=\"no\">open only"),
            vec![
                Piece::Raw("<x translate=\"no\">".to_string()),
                Piece::Text("open only".to_string()),
            ]
        );
        assert_eq!(pieces("<br translate=\"no\">tail").len(), 2);
        assert_eq!(
            pieces("<span class=\"notranslate\"><span>a</span></span>z").len(),
            2
        );
        assert_eq!(
            pieces("a < b"),
            vec![
                Piece::Text("a ".to_string()),
                Piece::Text("< b".to_string())
            ]
        );
    }

    #[tokio::test]
    async fn translates_with_the_markers() {
        let fake = Fake::new(|t| format!("JA<{t}>"));
        let backend = PlainBackend::new(fake);
        let result = backend
            .translate(&strings(&["Hello <b>world</b>", "123", "Plain text"]))
            .await
            .unwrap();

        assert_eq!(result[0], "JA&lt;Hello <b>world</b>&gt;");
        assert_eq!(result[1], "123");
        assert_eq!(result[2], "JA&lt;Plain text&gt;");
        assert_eq!(backend.plain.calls.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn falls_back_to_one_text_at_a_time_when_the_markers_are_lost() {
        let fake = Fake::new(|t| {
            if t.contains("[[") {
                "markers lost".to_string()
            } else {
                format!("JA({t})")
            }
        });
        let backend = PlainBackend::new(fake);
        let result = backend
            .translate(&strings(&[" Call <code translate=\"no\">x</code> now "]))
            .await
            .unwrap();

        assert_eq!(
            result,
            vec![" JA(Call) <code translate=\"no\">x</code> JA(now) ".to_string()]
        );
        let calls = backend.plain.calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1], strings(&["Call", "now"]));
    }

    #[tokio::test]
    async fn rejects_a_different_number_of_results() {
        let mut fake = Fake::new(|t| t.to_string());
        fake.wrong_count = true;
        let error = PlainBackend::new(fake)
            .translate(&strings(&["Hi"]))
            .await
            .unwrap_err();
        assert!(error.contains("different number"));
    }
}
