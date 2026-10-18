/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { absoluteUrl } from "./docUrl";

/**
 * 本文を囲んでいた要素 (サイトの見た目で表示するときに, 本文の外側に作り直す).
 *
 * サイトの CSS は, 外側の要素のクラス (`.article .content p` など) を前提にすることが多いので,
 * タグの名前, id, クラスだけを残す (ほかの属性と, 中の要素は, 残さない).
 */
export interface FrameNode {
  /** タグの名前 (使ってよいもの以外は, `div`). */
  readonly tag: string;
  /** id (なければ空). */
  readonly id: string;
  /** クラス (空白で区切る. なければ空). */
  readonly classes: string;
}

/** サイトの CSS の 1 つ (CSS のファイルか, ページの中の `<style>`). */
export interface SiteSheet {
  /** CSS のファイルの URL (絶対 URL. `<style>` なら空). */
  readonly url: string;
  /** `<style>` の中身 (CSS のファイルなら空). */
  readonly text: string;
  /** 効かせる条件 (`media` の属性. `(prefers-color-scheme: dark)` など. なければ空). */
  readonly media: string;
}

/** サイトの CSS (サイトの見た目で表示するときに, 取得して入れる). */
export interface SiteStyles {
  /** CSS のファイルと `<style>` (ページに書かれた順. この順で, 後のものが勝つ). */
  readonly sheets: readonly SiteSheet[];
}

/** 本文の外側に作り直してよいタグ (それ以外は, `div` にする). */
const FRAME_TAGS = new Set([
  "html",
  "body",
  "main",
  "article",
  "section",
  "div",
  "nav",
  "aside",
  "header",
  "footer",
]);

/**
 * 本文の要素と, それを囲む要素を, 外側から順に集める (`html` から本文の要素まで).
 *
 * @param root 本文の要素
 * @returns 外側から順の要素
 */
export function collectFrame(root: Element): FrameNode[] {
  const nodes: FrameNode[] = [];
  for (let element: Element | null = root; element; element = element.parentElement) {
    const tag = element.tagName.toLowerCase();
    nodes.unshift({
      tag: FRAME_TAGS.has(tag) ? tag : "div",
      id: element.id,
      classes: element.getAttribute("class") ?? "",
    });
  }
  return nodes;
}

/**
 * ページの CSS (`<link rel="stylesheet">` の URL と, `<style>` の中身) を, 書かれた順に集める.
 *
 * 印刷のための CSS (`media="print"`) と, 使われていない CSS (`disabled`) は, 除く. ほかの `media`
 * (明るい色と暗い色のテーマなど) は, 条件として残す.
 *
 * @param doc ページ
 * @param url ページの URL (相対 URL の基準)
 * @returns CSS
 */
export function collectStyles(doc: Document, url: string): SiteStyles {
  const sheets = Array.from(doc.querySelectorAll("link[rel~='stylesheet'][href], style"))
    .filter(
      (element) => element.getAttribute("media") !== "print" && !element.hasAttribute("disabled"),
    )
    .map((element) => ({
      url:
        element.tagName === "LINK" ? absoluteUrl(element.getAttribute("href") as string, url) : "",
      text: element.tagName === "LINK" ? "" : (element.textContent as string),
      media: element.getAttribute("media") ?? "",
    }));
  return { sheets };
}

/**
 * CSS を, 条件 (`media`) の中に入れる (条件がないか, `all` なら, そのまま).
 *
 * 条件の中には書けない `@charset` は, 取り除く.
 *
 * @param css CSS
 * @param media 条件
 * @returns 条件の中に入れた CSS
 */
export function withMedia(css: string, media: string): string {
  const condition = media.trim();
  if (condition === "" || condition === "all") {
    return css;
  }
  return `@media ${condition} {\n${css.replace(/@charset[^;]*;/gi, "")}\n}`;
}

/** CSS の `url(...)` (引用符は, あってもなくても). */
const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/** CSS の `@import` (`url(...)` か, 引用符の文字列). */
const CSS_IMPORT = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/g;

/**
 * CSS の中の相対 URL (`url(...)`) を, CSS のファイルの URL を基準に, 絶対 URL にする.
 *
 * `data:` の URL は, そのまま.
 *
 * @param css CSS
 * @param base CSS のファイルの URL
 * @returns 書き換えた CSS
 */
export function absoluteCssUrls(css: string, base: string): string {
  return css.replace(CSS_URL, (_whole, _quote, target: string) =>
    target.startsWith("data:") ? `url("${target}")` : `url("${absoluteUrl(target, base)}")`,
  );
}

/**
 * CSS の `@import` の URL を, 絶対 URL で返す.
 *
 * @param css CSS
 * @param base CSS のファイルの URL
 * @returns 読み込む CSS の URL (書いてある順)
 */
export function cssImports(css: string, base: string): string[] {
  return Array.from(css.matchAll(CSS_IMPORT), (match) => absoluteUrl(match[2], base));
}

/**
 * CSS から `@import` を取り除く (読み込む CSS は, 先に取得して, 前に入れるため).
 *
 * @param css CSS
 * @returns 取り除いた CSS
 */
export function withoutImports(css: string): string {
  return css.replace(CSS_IMPORT, "");
}

/**
 * 属性の値に入れる文字を, エスケープする.
 *
 * @param value 値
 * @returns エスケープした値
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 要素の開きタグの, id と class の属性を作る.
 *
 * @param node 要素
 * @returns 属性 (前に空白が付く. なければ空)
 */
function attributes(node: FrameNode): string {
  const id = node.id ? ` id="${escapeAttribute(node.id)}"` : "";
  const classes = node.classes ? ` class="${escapeAttribute(node.classes)}"` : "";
  return id + classes;
}

/**
 * 本文を囲んでいた要素の `body` に, クラスを足す.
 *
 * @param frame 本文を囲んでいた要素
 * @param classes 足すクラス (空白で区切る. なければ, そのまま)
 * @returns 足した要素
 */
export function withBodyClass(frame: readonly FrameNode[], classes = ""): FrameNode[] {
  return frame.map((node) =>
    node.tag === "body" && classes.trim() !== ""
      ? { ...node, classes: `${node.classes} ${classes.trim()}`.trim() }
      : node,
  );
}

/** サイトの見た目で表示するページの材料. */
export interface SiteDocument {
  /** 本文を囲んでいた要素 (外側から順. `html` と `body` を含む). */
  readonly frame: readonly FrameNode[];
  /** サイトの CSS (取得して, `@import` を入れて, URL を絶対 URL にしたもの). */
  readonly css: string;
  /** 本文の HTML (安全にしてある. 翻訳したものか, 原文). */
  readonly html: string;
  /** ページの URL (相対 URL の基準). */
  readonly url: string;
}

/**
 * サイトの見た目で表示するページ (iframe の `srcdoc`) を作る.
 *
 * `html` と `body` の要素は, クラスを付けて, そのまま使う. ほかの外側の要素は, 本文の外側に,
 * 外側から順に作り直す. サイトの CSS は, `<style>` に入れる (スクリプトは入れない).
 *
 * @param page 材料
 * @returns ページの HTML
 */
export function buildSiteDocument(page: SiteDocument): string {
  const html = page.frame.find((node) => node.tag === "html");
  const body = page.frame.find((node) => node.tag === "body");
  const inner = page.frame.filter((node) => node.tag !== "html" && node.tag !== "body");
  const open = inner.map((node) => `<${node.tag}${attributes(node)}>`).join("");
  const close = [...inner]
    .reverse()
    .map((node) => `</${node.tag}>`)
    .join("");
  // CSS の中に </style> があると, そこで終わってしまうので, 崩しておく
  const css = page.css.replace(/<\/style/gi, "<\\/style");
  return (
    "<!doctype html>" +
    `<html${html ? attributes(html) : ""}>` +
    '<head><meta charset="utf-8">' +
    `<base href="${escapeAttribute(page.url)}">` +
    `<style>${css}</style>` +
    "</head>" +
    `<body${body ? attributes(body) : ""}>` +
    open +
    page.html +
    close +
    "</body></html>"
  );
}
