/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { SiteProfile, SiteTab } from "./profile";

/**
 * URL が, アプリの中で開いてよい, ドキュメントのページかを確かめる.
 *
 * @param url URL
 * @param site サイトの設定 (ホストと, パスの先頭とほかのパスの先頭. タブがあれば, どれかのタブのパスの先頭)
 * @returns https で, ホストが一致して, パスが先頭に合うなら true
 */
export function isDocUrl(
  url: string,
  site: Pick<
    SiteProfile,
    "host" | "pathPrefix" | "otherPathPrefixes" | "alt" | "tabs" | "versions"
  >,
): boolean {
  try {
    const parsed = new URL(url);
    const prefixes = site.tabs
      ? site.tabs.map((tab) => tab.pathPrefix)
      : [site.pathPrefix, ...(site.otherPathPrefixes ?? [])];
    const path = pathWithoutVersion(parsed.pathname, site.versions?.pattern);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === site.host || parsed.hostname === site.alt?.host) &&
      prefixes.some((prefix) => path.startsWith(prefix))
    );
  } catch {
    return false;
  }
}

/**
 * パスから, 版を除く (版のあるサイトで, タブのパスの先頭と比べるため. 例: `/1.90.0/book/a.html` → `/book/a.html`).
 *
 * @param path URL のパス
 * @param pattern パスの中の版に合わせる正規表現 (1 つ目のグループが版. なければ, そのまま)
 * @returns 版を除いたパス (版が見つからなければ, そのまま)
 */
export function pathWithoutVersion(path: string, pattern?: RegExp): string {
  const match = pattern?.exec(path);
  if (match?.[1] === undefined) {
    return path;
  }
  const start = match.index + match[0].indexOf(match[1]);
  const end = start + match[1].length + (path[start + match[1].length] === "/" ? 1 : 0);
  return path.slice(0, start) + path.slice(end);
}

/**
 * URL が, どのタブのドキュメントかを調べる (パスの先頭が, 一番長く合うタブ).
 *
 * @param url ページの URL
 * @param tabs タブの一覧
 * @param pattern パスの中の版に合わせる正規表現 (版のあるサイト. 版を除いて比べる)
 * @returns タブの番号 (どれにも合わなければ 0. 読めない URL も 0)
 */
export function tabIndexOf(url: string, tabs: readonly SiteTab[], pattern?: RegExp): number {
  try {
    const path = pathWithoutVersion(new URL(url).pathname, pattern);
    let best = 0;
    let length = -1;
    tabs.forEach((tab, index) => {
      if (path.startsWith(tab.pathPrefix) && tab.pathPrefix.length > length) {
        best = index;
        length = tab.pathPrefix.length;
      }
    });
    return best;
  } catch {
    return 0;
  }
}

/**
 * ページの URL を, もう 1 つのサイトの同じパスの URL にする (今がもう 1 つのサイトなら, もとのサイトにする).
 *
 * @param url ページの URL
 * @param site サイトの設定
 * @returns 切り替えた URL (もう 1 つのサイトがないか, どちらのホストでもなければ, そのまま)
 */
export function switchedUrl(url: string, site: Pick<SiteProfile, "host" | "alt">): string {
  const alt = site.alt?.host;
  try {
    const parsed = new URL(url);
    if (alt !== undefined) {
      if (parsed.hostname === site.host) {
        parsed.hostname = alt;
      } else if (parsed.hostname === alt) {
        parsed.hostname = site.host;
      }
    }
    return parsed.href;
  } catch {
    return url;
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
