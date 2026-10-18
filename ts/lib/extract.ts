/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { absoluteUrl } from "./docUrl";
import { parseHtmlMenu } from "./menu";
import type { MenuItem, SiteProfile } from "./profile";
import { sanitize } from "./sanitize";
import { type FrameNode, type SiteStyles, collectFrame, collectStyles } from "./siteLook";
import { type VersionChoice, parseVersions } from "./version";

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
  /** ページの中の, 版の一覧 (プロファイルに版の設定があるときだけ. なければ空). */
  readonly versions: readonly VersionChoice[];
  /** 転送のページ (`<meta http-equiv="refresh">` で, 別のページに移る) なら, 移り先の絶対 URL. */
  readonly redirect?: string;
  /** 本文を囲んでいた要素 (サイトの見た目で表示するとき. 前の版で保存したページには, ない). */
  readonly frame?: readonly FrameNode[];
  /** サイトの CSS (サイトの見た目で表示するとき. 前の版で保存したページには, ない). */
  readonly styles?: SiteStyles;
}

/**
 * ページの `<meta http-equiv="refresh" content="0; url=...">` から, 移り先を読む.
 *
 * @param doc ページ
 * @param url ページの URL (相対の移り先を, 絶対 URL にする)
 * @returns 移り先の絶対 URL (なければ undefined)
 */
function refreshTarget(doc: Document, url: string): string | undefined {
  const meta = Array.from(doc.querySelectorAll("meta")).find(
    (element) => element.getAttribute("http-equiv")?.toLowerCase() === "refresh",
  );
  const target = /url\s*=\s*['"]?([^'"\s]+)/i.exec(meta?.getAttribute("content") ?? "")?.[1];
  return target === undefined ? undefined : absoluteUrl(target, url);
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
  const menu =
    menuRoot && profile.menu?.type === "html"
      ? parseHtmlMenu(menuRoot, url, profile.menu.list)
      : [];
  const content = root.cloneNode(true) as Element;
  content
    .querySelectorAll([...REMOVE, ...profile.removeSelectors].join(", "))
    .forEach((element) => element.remove());
  if (profile.noTranslateSelectors && profile.noTranslateSelectors.length > 0) {
    // 関数の宣言などは、表示するが、翻訳しない (「翻訳しない」印の class を付ける)
    content
      .querySelectorAll(profile.noTranslateSelectors.join(", "))
      .forEach((element) => element.classList.add("notranslate"));
  }
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

  const versions = profile.versions?.selector
    ? parseVersions(doc, profile.versions.selector, profile.versions.pattern, url)
    : [];

  return {
    url,
    title,
    html: sanitize(content.innerHTML),
    menu,
    versions,
    redirect: refreshTarget(doc, url),
    frame: collectFrame(root),
    styles: collectStyles(doc, url),
  };
}
