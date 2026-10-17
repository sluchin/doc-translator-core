// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! キャッシュの書き出しのファイルの名前 (`lib.rs` の `export_name`) の単体テスト.

use doc_translator_core::export_name;

#[test]
fn names_the_export_file_by_the_site_and_the_date() {
    assert_eq!(
        export_name("docs.zephyrproject.org", "20261017-1530"),
        "docs-zephyrproject-org-cache-20261017-1530.json"
    );
    // 日時がないか, 数字とハイフンでなければ (パスの区切りなど), 日時を付けない
    assert_eq!(
        export_name("kotlinlang.org", ""),
        "kotlinlang-org-cache.json"
    );
    assert_eq!(
        export_name("kotlinlang.org", "../x"),
        "kotlinlang-org-cache.json"
    );
    assert_eq!(
        export_name("kotlinlang.org", "2026 10"),
        "kotlinlang-org-cache.json"
    );
}
