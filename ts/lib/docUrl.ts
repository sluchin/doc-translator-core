/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * URL が, アプリの中で開いてよい, ドキュメントのページかを確かめる.
 *
 * @param url URL
 * @param host ドキュメントのホスト
 * @returns https で, ホストが一致するなら true
 */
export function isDocUrl(url: string, host: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === host;
  } catch {
    return false;
  }
}

/**
 * URL から, フラグメント (#以降) を除く.
 *
 * @param url URL
 * @returns フラグメントのない URL (URL として読めなければ, そのまま)
 */
export function withoutHash(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * URL のフラグメント (#以降の名前) を返す.
 *
 * @param url URL
 * @returns 名前 (なければ空の文字列)
 */
export function hashOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).hash.slice(1));
  } catch {
    return "";
  }
}
