/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { absoluteUrl, withoutHash } from "./docUrl";
import type { MenuItem } from "./profile";
import { type TranslateFn, chunk } from "./translatePage";

/**
 * `li` から, メニューの項目を作る (直接の子の `a` が, 名前と URL. 直接の子の `ul` が, 子の項目).
 * `a` がない項目 (ボタンだけのグループなど) の名前は, `ul` を除いた子の文字にする.
 *
 * @param li 項目の要素
 * @param base ページの URL
 * @returns 項目
 */
function itemFromLi(li: Element, base: string): MenuItem {
  const children = Array.from(li.children);
  const link = children.find((child) => child.tagName === "A");
  const href = link?.getAttribute("href");
  const own = Array.from(li.childNodes)
    .filter((node) => !(node instanceof Element && node.tagName === "UL"))
    .map((node) => node.textContent)
    .join(" ");
  const title = ((link ? link.textContent : own) as string).replace(/\s+/g, " ").trim();
  return {
    title,
    url: href ? absoluteUrl(href, base) : undefined,
    children: children
      .filter((child) => child.tagName === "UL")
      .flatMap((ul) => itemsFromUl(ul, base)),
  };
}

/**
 * `ul` から, 項目の一覧を作る.
 *
 * @param ul 一覧の要素
 * @param base ページの URL
 * @returns 項目
 */
function itemsFromUl(ul: Element, base: string): MenuItem[] {
  return Array.from(ul.children)
    .filter((child) => child.tagName === "LI")
    .map((li) => itemFromLi(li, base));
}

/**
 * HTML のメニューの要素から, 項目の木を作る (要素の中の, 一番外側の `ul` を, 全て読む).
 *
 * @param root メニューの要素
 * @param base ページの URL (相対のリンクを, 絶対 URL にする)
 * @returns 項目 (名前のない項目は除く)
 */
export function parseHtmlMenu(root: Element, base: string): MenuItem[] {
  return Array.from(root.querySelectorAll("ul"))
    .filter((ul) => !ul.parentElement?.closest("ul"))
    .flatMap((ul) => itemsFromUl(ul, base))
    .filter((item) => item.title !== "");
}

/**
 * 項目が, 開いているページを指すかを確かめる (フラグメントは見ない).
 *
 * @param item 項目
 * @param url 開いているページの URL
 * @returns 指していれば true
 */
export function isCurrent(item: MenuItem, url: string): boolean {
  return item.url !== undefined && withoutHash(item.url) === withoutHash(url);
}

/**
 * 項目か、その子孫が、開いているページを指すかを確かめる (開いておく項目を決める).
 *
 * @param item 項目
 * @param url 開いているページの URL
 * @returns 含んでいれば true
 */
export function containsCurrent(item: MenuItem, url: string): boolean {
  return isCurrent(item, url) || item.children.some((child) => containsCurrent(child, url));
}

/**
 * 木の、全ての名前 (重複なし) を集める.
 *
 * @param items 項目
 * @returns 名前
 */
export function collectTitles(items: readonly MenuItem[]): string[] {
  const titles = new Set<string>();
  const visit = (list: readonly MenuItem[]) =>
    list.forEach((item) => {
      titles.add(item.title);
      visit(item.children);
    });
  visit(items);
  return [...titles];
}

/**
 * 木の名前を、表で置き換える (表にない名前は、そのまま).
 *
 * @param items 項目
 * @param titles 元の名前から、置き換える名前への表
 * @returns 名前を置き換えた木
 */
export function withTitles(
  items: readonly MenuItem[],
  titles: ReadonlyMap<string, string>,
): MenuItem[] {
  return items.map((item) => ({
    ...item,
    title: titles.get(item.title) ?? item.title,
    children: withTitles(item.children, titles),
  }));
}

/**
 * 翻訳サービスが返した HTML の断片を、プレーンテキストにする (文字参照を戻す).
 *
 * @param html HTML の断片
 * @returns テキスト
 */
export function htmlToText(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").body.textContent as string;
}

/**
 * 名前を翻訳する (文章を、1 回の依頼に入る大きさに分けて、順に翻訳する).
 *
 * @param titles 名前
 * @param translate 翻訳する関数
 * @returns 元の名前から、翻訳した名前への表
 */
export async function translateTitles(
  titles: readonly string[],
  translate: TranslateFn,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const part of chunk([...titles])) {
    const translated = await translate(part);
    part.forEach((title, index) => result.set(title, htmlToText(translated[index] ?? title)));
  }
  return result;
}
