/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { SiteProfile } from "./profile";

/**
 * URL が, アプリの中で開いてよい, ドキュメントのページかを確かめる.
 *
 * @param url URL
 * @param site サイトの設定 (ホストと, パスの先頭)
 * @returns https で, ホストが一致して, パスが先頭に合うなら true
 */
export function isDocUrl(url: string, site: Pick<SiteProfile, "host" | "pathPrefix">): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === site.host &&
      parsed.pathname.startsWith(site.pathPrefix)
    );
  } catch {
    return false;
  }
}

/**
 * URL を絶対 URL にする (読めなければ, そのまま).
 *
 * @param value 相対 URL か絶対 URL
 * @param base ページの URL
 * @returns 絶対 URL
 */
export function absoluteUrl(value: string, base: string): string {
  try {
    return new URL(value, base).href;
  } catch {
    return value;
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
