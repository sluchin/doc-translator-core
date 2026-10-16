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
 * @param site サイトの設定 (ホストと, パスの先頭. タブがあれば, どれかのタブのパスの先頭)
 * @returns https で, ホストが一致して, パスが先頭に合うなら true
 */
export function isDocUrl(
  url: string,
  site: Pick<SiteProfile, "host" | "pathPrefix" | "alt" | "tabs">,
): boolean {
  try {
    const parsed = new URL(url);
    const prefixes = site.tabs ? site.tabs.map((tab) => tab.pathPrefix) : [site.pathPrefix];
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === site.host || parsed.hostname === site.alt?.host) &&
      prefixes.some((prefix) => parsed.pathname.startsWith(prefix))
    );
  } catch {
    return false;
  }
}

/**
 * URL が, どのタブのドキュメントかを調べる (パスの先頭が, 一番長く合うタブ).
 *
 * @param url ページの URL
 * @param tabs タブの一覧
 * @returns タブの番号 (どれにも合わなければ 0. 読めない URL も 0)
 */
export function tabIndexOf(url: string, tabs: readonly SiteTab[]): number {
  try {
    const path = new URL(url).pathname;
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
