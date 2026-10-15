// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! プレーンテキストの翻訳 (`plain.rs`)の単体テスト (本番のソースとは、分けて置く).

use std::sync::Mutex;

use doc_translator_core::plain::*;
use doc_translator_core::translate::Backend;

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
        Piece::Raw("<code translate=\"no\" class=\"notranslate\">f(<b>x</b>)</code>".to_string())
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
        decode("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x41;&#66; x&nbsp;y &unknown; &"),
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

#[test]
fn splits_long_text_at_the_sentence_boundaries() {
    assert_eq!(split_sentences("Short one.", 400), vec!["Short one."]);
    assert_eq!(
        split_sentences("Aaa. Bbb! Ccc? 3.5 is a number. End", 12),
        vec!["Aaa. Bbb!", "Ccc?", "3.5 is a", "number.", "End"]
    );
    assert_eq!(split_sentences("  ", 10), Vec::<String>::new());
    assert_eq!(
        split_sentences("Pack. Them. Together.", 400),
        vec!["Pack. Them. Together."]
    );
}

#[test]
fn splits_a_long_sentence_at_the_words() {
    assert_eq!(
        split_sentences("one two three four five six", 9),
        vec!["one two", "three", "four five", "six"]
    );
    assert_eq!(
        split_sentences("unbroken_word_longer_than_max", 5),
        vec!["unbroken_word_longer_than_max"]
    );
}

#[tokio::test]
async fn translates_the_chunks_of_a_long_text_in_one_call_and_joins_them() {
    let long = format!("{} {}", "A".repeat(300), "B".repeat(300));
    let fake = Fake::new(|t| format!("<{}>", t.len()));
    let backend = PlainBackend::new(fake);
    let result = backend
        .translate(&strings(&[&format!(" {long}.")]))
        .await
        .unwrap();

    assert_eq!(result, vec![" &lt;300&gt; &lt;301&gt;".to_string()]);
    let calls = backend.plain.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].len(), 2);
}
