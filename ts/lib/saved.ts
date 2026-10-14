/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** しおり (ブックマーク). */
export interface Bookmark {
  /** ページの URL (フラグメントなし). */
  readonly url: string;
  /** 付けたときに表示していたタイトル. */
  readonly title: string;
}

/** 端末に覚えておくこと: 最後に読んだページ, ページごとの読んだ位置, しおり. */
export interface Saved {
  /** 最後に開いていたページの URL. */
  readonly last?: string;
  /** ページごとの、読んだ位置 (本文の長さに対する 0 から 1 の割合. 翻訳で長さが変わっても、ずれにくい). */
  readonly scroll: Readonly<Record<string, number>>;
  /** しおり (付けた順). */
  readonly bookmarks: readonly Bookmark[];
}

/** 何も覚えていない状態. */
export const EMPTY_SAVED: Saved = { scroll: {}, bookmarks: [] };

/** 位置を覚えておくページの数 (多いものから、古い順に捨てる). */
export const MAX_SCROLL = 200;

/** `localStorage` のうち、使う部分. */
export interface KeyValue {
  /** 値を読む. */
  getItem: (key: string) => string | null;
  /** 値を書く. */
  setItem: (key: string, value: string) => void;
}

/**
 * 値を、キーと値の組 (オブジェクト) として読む (オブジェクトでなければ、空).
 *
 * @param value 値
 * @returns キーと値の組
 */
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * 保存した文字列から、覚えていることを読む (壊れた値や、足りない項目は、空として読む).
 *
 * @param text 保存した JSON (なければ null)
 * @returns 覚えていること
 */
export function parseSaved(text: string | null): Saved {
  let raw: unknown;
  try {
    raw = JSON.parse(text ?? "null");
  } catch {
    return EMPTY_SAVED;
  }
  const data = record(raw);
  const bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  return {
    last: typeof data.last === "string" ? data.last : undefined,
    scroll: Object.fromEntries(
      Object.entries(record(data.scroll)).filter(([, ratio]) => typeof ratio === "number"),
    ) as Record<string, number>,
    bookmarks: bookmarks
      .map(record)
      .filter((b) => typeof b.url === "string" && typeof b.title === "string")
      .map((b) => ({ url: b.url as string, title: b.title as string })),
  };
}

/**
 * 端末から、覚えていることを読む (使えない端末や、読めないときは、空).
 *
 * @param store 保存先 (使えなければ undefined)
 * @param key キー
 * @returns 覚えていること
 */
export function loadSaved(store: KeyValue | undefined, key: string): Saved {
  try {
    return parseSaved(store?.getItem(key) ?? null);
  } catch {
    return EMPTY_SAVED;
  }
}

/**
 * 端末に、覚えていることを書く (書けなくても、何もしない).
 *
 * @param store 保存先 (使えなければ undefined)
 * @param key キー
 * @param saved 覚えていること
 */
export function storeSaved(store: KeyValue | undefined, key: string, saved: Saved): void {
  try {
    store?.setItem(key, JSON.stringify(saved));
  } catch {
    // 容量がない, 書き込みが禁止されているときは、覚えられないだけ
  }
}

/**
 * 最後に開いたページを変えた状態を返す.
 *
 * @param saved 覚えていること
 * @param url ページの URL
 * @returns 新しい状態
 */
export function withLast(saved: Saved, url: string): Saved {
  return { ...saved, last: url };
}

/**
 * ページの読んだ位置を変えた状態を返す (古いページの位置は、多すぎれば捨てる).
 *
 * @param saved 覚えていること
 * @param url ページの URL
 * @param ratio 位置 (0 から 1)
 * @returns 新しい状態
 */
export function withScroll(saved: Saved, url: string, ratio: number): Saved {
  const rest = { ...saved.scroll };
  delete rest[url];
  const entries = Object.entries({ ...rest, [url]: Math.round(ratio * 1000) / 1000 });
  return { ...saved, scroll: Object.fromEntries(entries.slice(-MAX_SCROLL)) };
}

/**
 * ページにしおりがあるかを返す.
 *
 * @param bookmarks しおり
 * @param url ページの URL
 * @returns あれば true
 */
export function isBookmarked(bookmarks: readonly Bookmark[], url: string): boolean {
  return bookmarks.some((b) => b.url === url);
}

/**
 * しおりを付ける (すでにあれば外す).
 *
 * @param bookmarks しおり
 * @param url ページの URL
 * @param title タイトル
 * @returns 新しいしおり
 */
export function toggleBookmark(
  bookmarks: readonly Bookmark[],
  url: string,
  title: string,
): readonly Bookmark[] {
  return isBookmarked(bookmarks, url)
    ? bookmarks.filter((b) => b.url !== url)
    : [...bookmarks, { url, title }];
}
