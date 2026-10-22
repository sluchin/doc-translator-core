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

/**
 * 1 つの大きなページ (ドキュメントの全体が 1 つの HTML) を, 見出しごとに分けて, 別のページとして開く設定.
 *
 * 分けたページの URL は, 元のページの URL に, クエリ `?section=<見出しの id>` を付けたもの. 取得するのは
 * 元のページだけ (1 回取得して, 覚えておく). ページの中のリンク (`#名前`) は, その名前がある部分のページを開く.
 * メニュー (目次) は, 見出しから作る.
 */
export interface SectionSource {
  /** 分ける見出しの CSS セレクタ (本文の直下の要素に合わせる. 例: `h1`). */
  readonly split: string;
  /** メニューに出す見出しの CSS セレクタ (上の階層から順に. 例: `["h1", "h2", "h3"]`). */
  readonly menuLevels: readonly string[];
}

/** 翻訳しない言葉の設定. */
export interface KeepTerms {
  /** 言葉を探す要素の CSS セレクタ (見出しなど). */
  readonly selector: string;
  /** 翻訳しない言葉に合わせる正規表現 (`g` は付けなくてよい). */
  readonly pattern: RegExp;
  /**
   * 翻訳しない言葉で始まる要素を翻訳に渡すときに, 前に付ける言葉 (`The` など. 表示はしない).
   * 翻訳サービスは, 先頭の「翻訳しない」印のあとの言葉を落とすことがある (「If expression」が「If」だけになる)
   * ので, 文の中の言葉にする. なければ, 付けない.
   */
  readonly lead?: string;
}

/** 翻訳するドキュメントのサイトごとの設定 (アプリごとに 1 つ). */
export interface SiteProfile {
  /** アプリの名前 (タイトルの表示に使う). */
  readonly name: string;
  /** アプリの中で開く, ドキュメントのホスト (Rust 側の設定と同じにする). */
  readonly host: string;
  /** アプリの中で開く, ページのパスの先頭 (`/` なら, ホストの全てのページ. 例: `/docs/`). */
  readonly pathPrefix: string;
  /** `pathPrefix` のほかに, アプリの中で開く, ページのパスの先頭 (例: `["/api/"]`. タブを使わないとき). */
  readonly otherPathPrefixes?: readonly string[];
  /** 最初に開くページ. */
  readonly homeUrl: string;
  /** 本文の要素の CSS セレクタ (最初に見つかったものを使う. なければ body). */
  readonly contentSelectors: readonly string[];
  /** 本文から取り除く要素の CSS セレクタ (スクリプトなどは, 共通で取り除く). */
  readonly removeSelectors: readonly string[];
  /** 本文の中で, 表示するが, 翻訳しない要素の CSS セレクタ (関数の宣言など. なければ, 共通の決まりだけ). */
  readonly noTranslateSelectors?: readonly string[];
  /**
   * 見出しなどの中で, 翻訳しない言葉 (プログラムの予約語など. 「If」や「For loops」の `If` `For` を,
   * 英語の言葉として訳さないように). なければ, 印を付けない.
   */
  readonly keepTerms?: KeepTerms;
  /**
   * 本文を組み直す (要素を書き換える. 表示の形によらず, 取り出すときに行う. 畳める項目を `details` にするなど).
   * 組み直した本文も, `sanitize()` を通す. なければ, 組み直さない.
   */
  readonly rewrite?: (content: Element) => void;
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
  /**
   * サイトの見た目で表示するときに, `body` に足すクラス (空白で区切る).
   *
   * サイトの JavaScript は動かさないので, JavaScript が描き終えたときに付けるクラスがないと, 本文を
   * 隠したままのサイトがある (Writerside の `app-render-failed` など). なければ, 足さない.
   */
  readonly siteLookBodyClass?: string;
  /**
   * サイトの見た目で表示するときに, 本文を組み直す (要素を書き換える).
   *
   * サイトの JavaScript が本文を組み直してから, CSS を当てるサイトがある (Writerside の注意書きの
   * 枠など). JavaScript は動かさないので, 同じ形に組み直す. 組み直した本文も, `sanitize()` を通す.
   * なければ, 組み直さない.
   */
  readonly siteLookRewrite?: (content: Element) => void;
  /** メニュー (目次) の取り方 (なければ, メニューを出さない. `tabs` があるときは, タブごとに決めるので, 使わない). */
  readonly menu?: MenuSource;
  /**
   * 1 つの大きなページを, 見出しごとに分けて開く (なければ, 分けない). あれば, メニューは見出しから作るので,
   * `menu` と `tabs` は使わない.
   */
  readonly sections?: SectionSource;
  /**
   * 同じホストの, 複数のドキュメントを, タブで切り替えるときの, タブの一覧 (2 つ以上).
   * あれば, アプリの中で開くのは, タブのパスの先頭に合うページだけ (`pathPrefix` は使わない).
   */
  readonly tabs?: readonly SiteTab[];
}
