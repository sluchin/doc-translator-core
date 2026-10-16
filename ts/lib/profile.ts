/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** メニュー (目次) の 1 つの項目. */
export interface MenuItem {
  /** 表示する名前. */
  readonly title: string;
  /** ページの絶対 URL (見出しだけの項目は, なし). */
  readonly url?: string;
  /** 子の項目. */
  readonly children: readonly MenuItem[];
}

/** メニューの取り方: ページの HTML の中にあるか, 別の JSON ファイルにあるか. */
export type MenuSource =
  | {
      /** ページの HTML の中の, メニューの要素から読む. */
      readonly type: "html";
      /** メニューの要素の CSS セレクタ (中の, 入れ子の `ul` を読む). */
      readonly selector: string;
    }
  | {
      /** サイトの JSON ファイル (ホストの中) から読む. */
      readonly type: "json";
      /** JSON の URL. */
      readonly url: string;
      /** JSON を, メニューの項目にする. */
      readonly parse: (json: unknown, base: string) => MenuItem[];
    };

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
  /** コードの中で、取り除く行 (サイトの JavaScript が隠す印など. 行全体に合わせる. なければ、取り除かない). */
  readonly dropCodeLines?: RegExp;
  /** タイトルの末尾の, サイト名 (取り除く). */
  readonly titleSuffix: RegExp;
  /**
   * 同じパスの, もう 1 つのサイト (日本語のサイトと, 英語のサイトの切り替えなど). あれば, 切り替えのボタンが出る
   * (Rust 側の `Site` の `alt_host` と同じにする).
   */
  readonly alt?: {
    /** もう 1 つのサイトのホスト. */
    readonly host: string;
    /** 今のサイトから, もう 1 つのサイトへ移るボタンの名前. */
    readonly toLabel: string;
    /** もう 1 つのサイトから, 今のサイトへ戻るボタンの名前. */
    readonly backLabel: string;
  };
  /** サイトが日本語のとき true (翻訳しない. 原文の切り替えと設定のボタンも出さない). 既定は false. */
  readonly japanese?: boolean;
  /** メニュー (目次) の取り方 (なければ, メニューを出さない). */
  readonly menu?: MenuSource;
}
