/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** 翻訳するドキュメントのサイトごとの設定 (アプリごとに 1 つ). */
export interface SiteProfile {
  /** アプリの名前 (タイトルの表示に使う). */
  readonly name: string;
  /** アプリの中で開く, ドキュメントのホスト (Rust 側の設定と同じにする). */
  readonly host: string;
  /** アプリの中で開く, ページのパスの先頭 (`/` なら, ホストの全てのページ. 例: `/docs/`). */
  readonly pathPrefix: string;
  /** 最初に開くページ. */
  readonly homeUrl: string;
  /** 本文の要素の CSS セレクタ (最初に見つかったものを使う. なければ body). */
  readonly contentSelectors: readonly string[];
  /** 本文から取り除く要素の CSS セレクタ (スクリプトなどは, 共通で取り除く). */
  readonly removeSelectors: readonly string[];
  /** タイトルの末尾の, サイト名 (取り除く). */
  readonly titleSuffix: RegExp;
}
