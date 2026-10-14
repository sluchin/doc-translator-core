/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { SiteProfile } from "./profile";
import { sanitize } from "./sanitize";

/** 取り出したページ. */
export interface DocPage {
  /** ページの URL (フラグメントなし). */
  readonly url: string;
  /** タイトル. */
  readonly title: string;
  /** 本文の HTML (安全にしてある. リンクと画像の URL は絶対 URL). */
  readonly html: string;
}

/** 本文から取り除く要素 (スクリプトなど. サイトごとの分は, プロファイルで足す). */
const REMOVE = ["script", "style", "noscript", "iframe", "form", "link", ".headerlink"];

/**
 * URL を絶対 URL にする (読めなければ, そのまま).
 *
 * @param value 相対 URL か絶対 URL
 * @param base ページの URL
 * @returns 絶対 URL
 */
function absolute(value: string, base: string): string {
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
}

/**
 * サイトの HTML から, 本文とタイトルを取り出す.
 *
 * 本文は, プロファイルのセレクタで最初に見つかった要素, なければ `body`.
 * スクリプトなどを除いて, リンクと画像の URL を絶対 URL にして, 安全な HTML にする.
 *
 * @param html ページの HTML
 * @param url ページの URL
 * @param profile サイトの設定
 * @returns 取り出したページ
 */
export function extractPage(html: string, url: string, profile: SiteProfile): DocPage {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root =
    profile.contentSelectors.map((selector) => doc.querySelector(selector)).find(Boolean) ??
    doc.body;
  const content = root.cloneNode(true) as Element;
  content
    .querySelectorAll([...REMOVE, ...profile.removeSelectors].join(", "))
    .forEach((element) => element.remove());
  content.querySelectorAll("a[href]").forEach((a) => {
    a.setAttribute("href", absolute(a.getAttribute("href") as string, url));
  });
  content.querySelectorAll("img[src]").forEach((img) => {
    img.setAttribute("src", absolute(img.getAttribute("src") as string, url));
  });
  const heading = content.querySelector("h1")?.textContent ?? "";
  const title = doc.title.replace(profile.titleSuffix, "").trim() || heading;

  return { url, title, html: sanitize(content.innerHTML) };
}
