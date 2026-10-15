/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { absoluteUrl } from "./docUrl";
import { parseHtmlMenu } from "./menu";
import type { MenuItem, SiteProfile } from "./profile";
import { sanitize } from "./sanitize";

/** 取り出したページ. */
export interface DocPage {
  /** ページの URL (フラグメントなし). */
  readonly url: string;
  /** タイトル. */
  readonly title: string;
  /** 本文の HTML (安全にしてある. リンクと画像の URL は絶対 URL). */
  readonly html: string;
  /** ページの中のメニュー (プロファイルが HTML のメニューを指すときだけ. なければ空). */
  readonly menu: readonly MenuItem[];
}

/** 本文から取り除く要素 (スクリプトなど. サイトごとの分は, プロファイルで足す). */
const REMOVE = ["script", "style", "noscript", "iframe", "form", "link", ".headerlink"];

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
  const menuRoot = profile.menu?.type === "html" ? doc.querySelector(profile.menu.selector) : null;
  const menu = menuRoot ? parseHtmlMenu(menuRoot, url) : [];
  const content = root.cloneNode(true) as Element;
  content
    .querySelectorAll([...REMOVE, ...profile.removeSelectors].join(", "))
    .forEach((element) => element.remove());
  content.querySelectorAll("a[href]").forEach((a) => {
    a.setAttribute("href", absoluteUrl(a.getAttribute("href") as string, url));
  });
  content.querySelectorAll("img[src]").forEach((img) => {
    img.setAttribute("src", absoluteUrl(img.getAttribute("src") as string, url));
  });
  const { dropCodeLines } = profile;
  if (dropCodeLines) {
    content.querySelectorAll("pre, .code-block").forEach((code) => {
      if (code.children.length === 0) {
        // 色づけのない、文字だけのコードだけを直す (色づけの要素は、壊さない)
        const lines = (code.textContent as string).split("\n");
        code.textContent = lines
          .filter((line) => !dropCodeLines.test(line))
          .join("\n")
          .replace(/^\n+|\s+$/g, "");
      }
    });
  }
  const heading = content.querySelector("h1")?.textContent ?? "";
  const title = doc.title.replace(profile.titleSuffix, "").trim() || heading;

  return { url, title, html: sanitize(content.innerHTML), menu };
}
