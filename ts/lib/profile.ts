/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { VersionChoice } from "./version";

/** メニュー (目次) の 1 つの項目. */
export interface MenuItem {
  /** 表示する名前. */
  readonly title: string;
  /** ページの絶対 URL (見出しだけの項目は, なし). */
  readonly url?: string;
  /** 子の項目. */
  readonly children: readonly MenuItem[];
}

/** メニューの取り方: ページの HTML の中にあるか, 別の HTML か JSON のファイルにあるか. */
export type MenuSource =
  | {
      /** ページの HTML の中の, メニューの要素から読む. */
      readonly type: "html";
      /** メニューの要素の CSS セレクタ (中の, 入れ子の一覧を読む). */
      readonly selector: string;
      /** 一覧の要素の CSS セレクタ (既定は `ul`. 番号つきの一覧なら `ul, ol`). */
      readonly list?: string;
    }
  | {
      /** サイトの別の HTML ファイル (ホストの中. mdBook の `toc.html` など) の, メニューの要素から読む. */
      readonly type: "htmlFile";
      /** HTML ファイルの URL (メニューの相対のリンクは, この URL から絶対 URL にする). */
      readonly url: string;
      /** メニューの要素の CSS セレクタ. */
      readonly selector: string;
      /** 一覧の要素の CSS セレクタ (既定は `ul`. 番号つきの一覧なら `ul, ol`). */
      readonly list?: string;
    }
  | {
      /** サイトの JSON ファイル (ホストの中) から読む. */
      readonly type: "json";
      /** JSON の URL. */
      readonly url: string;
      /** JSON を, メニューの項目にする. */
      readonly parse: (json: unknown, base: string) => MenuItem[];
    };

/** タブ: 同じホストの, 別のドキュメント (パスの先頭が違う). 画面の上のタブで切り替える. */
export interface SiteTab {
  /** タブの名前. */
  readonly label: string;
  /** このドキュメントのページのパスの先頭 (例: `/nomicon/`). 末尾の `/` まで書く. */
  readonly pathPrefix: string;
  /** このドキュメントの最初のページ. */
  readonly homeUrl: string;
  /** このドキュメントのメニュー (目次) の取り方 (なければ, このタブにはメニューを出さない). */
  readonly menu?: MenuSource;
}

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
  /** 本文の中で, 表示するが, 翻訳しない要素の CSS セレクタ (関数の宣言など. なければ, 共通の決まりだけ). */
  readonly noTranslateSelectors?: readonly string[];
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
  /**
   * ドキュメントの版 (URL のパスに, 版の名前がある. 例: `/4.4.0/`). あれば, 画面で版を選べて,
   * 翻訳のキャッシュも, 版ごとに分ける.
   */
  readonly versions?: {
    /** パスに合わせる正規表現 (1 つ目のグループが版. 例: `/^\/([^/]+)\//`). */
    readonly pattern: RegExp;
    /** ページの中の, 版の一覧のリンクの CSS セレクタ (ページに一覧があるサイト). */
    readonly selector?: string;
    /** 版の一覧を作るファイル (ホストの中. ページに一覧がないサイト). 起動のときに 1 回だけ取得する. */
    readonly list?: {
      /** ファイルの URL. */
      readonly url: string;
      /** ファイルの中身から, 版の選択肢を作る. */
      readonly parse: (text: string) => VersionChoice[];
    };
  };
  /**
   * URL に版がないサイトで, 今の版を読み取るファイル (ホストの中). あれば, 起動のときに 1 回だけ取得して,
   * 翻訳のキャッシュを, 版ごとに分ける (版は選べない. 読めなければ, 分けない).
   */
  readonly versionSource?: {
    /** ファイルの URL. */
    readonly url: string;
    /** 中身に合わせる正規表現 (1 つ目のグループが版). */
    readonly pattern: RegExp;
    /** true なら, 合うもの全てのうち, 一番新しい版を選ぶ (版の一覧から, 今の版を選ぶとき). 既定は, 最初に合うもの. */
    readonly highest?: boolean;
  };
  /** サイトが日本語のとき true (翻訳しない. 原文の切り替えと設定のボタンも出さない). 既定は false. */
  readonly japanese?: boolean;
  /** メニュー (目次) の取り方 (なければ, メニューを出さない. `tabs` があるときは, タブごとに決めるので, 使わない). */
  readonly menu?: MenuSource;
  /**
   * 同じホストの, 複数のドキュメントを, タブで切り替えるときの, タブの一覧 (2 つ以上).
   * あれば, アプリの中で開くのは, タブのパスの先頭に合うページだけ (`pathPrefix` は使わない).
   */
  readonly tabs?: readonly SiteTab[];
}
