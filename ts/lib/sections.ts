/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { hashOf, withoutHash } from "./docUrl";
import type { DocPage } from "./extract";
import type { MenuItem, SectionSource } from "./profile";
import { sanitize } from "./sanitize";

/** 分けたページの URL で, 部分の見出しの id を入れるクエリの名前. */
export const SECTION_PARAM = "section";

/** 大きなページを分けた, 1 つの部分. */
export interface Section {
  /** 部分の id (見出しの id. 見出しのないページは空). */
  readonly id: string;
  /** 部分のタイトル (見出しの文字). */
  readonly title: string;
  /** 部分の本文の HTML (安全にしてある). */
  readonly html: string;
}

/** 見出しごとに分けた, 大きなページ. */
export interface SectionedPage {
  /** 分ける前のページ (URL は, 元のページ). */
  readonly page: DocPage;
  /** 分けた部分 (ページの順. 少なくとも 1 つ). */
  readonly sections: readonly Section[];
  /** リンクの移り先の名前 (id) から, それがある部分の id への表. */
  readonly anchors: ReadonlyMap<string, string>;
  /** 見出しから作ったメニュー (目次). */
  readonly menu: readonly MenuItem[];
}

/** 作っている途中の, メニューの項目. */
interface Item {
  title: string;
  url: string;
  children: Item[];
}

/**
 * URL から, クエリとフラグメントを除く (分ける前の, 元のページの URL).
 *
 * @param url URL
 * @returns 元のページの URL (URL として読めなければ, そのまま)
 */
export function baseUrlOf(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * 分けたページの URL を作る.
 *
 * @param base 元のページの URL
 * @param id 部分の id
 * @param anchor 部分の中で移る名前 (なければ, 付けない)
 * @returns 分けたページの URL
 */
export function sectionUrl(base: string, id: string, anchor = ""): string {
  const parsed = new URL(baseUrlOf(base));
  parsed.searchParams.set(SECTION_PARAM, id);
  parsed.hash = anchor;
  return parsed.href;
}

/**
 * 要素の文字を, 空白をまとめて返す (見出しの名前に使う).
 *
 * @param element 要素
 * @returns 文字
 */
function textOf(element: Element): string {
  return (element.textContent as string).replace(/\s+/g, " ").trim();
}

/**
 * `<a name="...">` に, 同じ値の id を付ける (リンクの移り先を, id で探せるように. id がすでにあれば, 付けない).
 *
 * @param container 本文
 */
function nameAnchorsToIds(container: Element): void {
  const ids = new Set(Array.from(container.querySelectorAll("[id]"), (element) => element.id));
  container.querySelectorAll("a[name]").forEach((a) => {
    const name = a.getAttribute("name") as string;
    if (a.id === "" && name !== "" && !ids.has(name)) {
      a.id = name;
      ids.add(name);
    }
  });
}

/**
 * 本文の直下の要素を, 見出しごとの組に分ける (最初の見出しより前は, 最初の組に入れる).
 *
 * @param container 本文
 * @param split 分ける見出しの CSS セレクタ
 * @param title 見出しがないときの, タイトル
 * @returns 組 (少なくとも 1 つ)
 */
function groupNodes(
  container: Element,
  split: string,
  title: string,
): { id: string; title: string; nodes: Node[] }[] {
  const groups: { id: string; title: string; nodes: Node[] }[] = [];
  const used = new Set<string>();
  let lead: Node[] = [];
  for (const node of Array.from(container.childNodes)) {
    if (node instanceof Element && node.matches(split)) {
      // id がないか, 重なる見出しは, 順番の id にする
      const id = node.id !== "" && !used.has(node.id) ? node.id : `section-${groups.length + 1}`;
      used.add(id);
      groups.push({ id, title: textOf(node), nodes: [...lead, node] });
      lead = [];
    } else if (groups.length === 0) {
      lead.push(node);
    } else {
      groups[groups.length - 1].nodes.push(node);
    }
  }
  return groups.length > 0 ? groups : [{ id: "", title, nodes: lead }];
}

/**
 * 見出しから, メニューを作る (見出しの階層で, 入れ子にする).
 *
 * @param container 本文
 * @param levels メニューに出す見出しの CSS セレクタ (上の階層から順に)
 * @param urlOf 見出しを開く URL を返す関数
 * @returns メニュー
 */
function buildMenu(
  container: Element,
  levels: readonly string[],
  urlOf: (heading: Element) => string,
): Item[] {
  const roots: Item[] = [];
  const stack: { level: number; item: Item }[] = [];
  if (levels.length === 0) {
    return roots;
  }
  container.querySelectorAll(levels.join(", ")).forEach((heading) => {
    const level = levels.findIndex((selector) => heading.matches(selector));
    const item: Item = { title: textOf(heading), url: urlOf(heading), children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    (stack.length > 0 ? stack[stack.length - 1].item.children : roots).push(item);
    stack.push({ level, item });
  });
  return roots;
}

/**
 * 大きなページを, 見出しごとの部分に分ける.
 *
 * `<a name>` に id を付けてから, ページの中のリンク (元のページの `#名前`) を, その名前がある部分の URL に
 * 書き換える. 部分の最後には, 次の部分へのリンクを足す.
 *
 * @param page 取り出したページ (URL は, 元のページ)
 * @param source 分け方
 * @returns 分けたページ
 */
export function splitSections(page: DocPage, source: SectionSource): SectionedPage {
  const base = baseUrlOf(page.url);
  const container = document.createElement("div");
  container.innerHTML = page.html;
  nameAnchorsToIds(container);
  const groups = groupNodes(container, source.split, page.title);

  const anchors = new Map<string, string>();
  groups.forEach((group) => {
    group.nodes.forEach((node) => {
      if (node instanceof Element) {
        [node, ...Array.from(node.querySelectorAll("[id]"))].forEach((element) => {
          if (element.id !== "" && !anchors.has(element.id)) {
            anchors.set(element.id, group.id);
          }
        });
      }
    });
  });

  // ページの中のリンクを, 移り先がある部分の URL にする (移り先が分からなければ, そのまま)
  container.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") as string;
    const anchor = hashOf(href);
    const id = anchors.get(anchor);
    if (withoutHash(href) === base && id !== undefined) {
      a.setAttribute("href", sectionUrl(base, id, anchor));
    }
  });

  // 本文の直下の要素から, それが入っている部分の id への表 (見出しが, どの部分にあるかを調べる)
  const groupOf = new Map<Node, string>();
  groups.forEach((group) => group.nodes.forEach((node) => groupOf.set(node, group.id)));
  const menu = buildMenu(container, source.menuLevels, (heading) => {
    let top: Node = heading;
    while (top.parentNode !== container) {
      top = top.parentNode as Node;
    }
    const id = groupOf.get(top) as string;
    // 分ける見出しと, id のない見出しは, 部分の先頭を開く
    return top === heading && heading.matches(source.split)
      ? sectionUrl(base, id)
      : sectionUrl(base, id, heading.id);
  });

  const sections = groups.map((group, index) => {
    const box = document.createElement("div");
    group.nodes.forEach((node) => box.append(node));
    const next = groups[index + 1];
    if (next !== undefined) {
      // 次の部分へのリンク (分けたページを, 順に読み進めるため)
      const p = document.createElement("p");
      p.className = "section-next";
      const a = document.createElement("a");
      a.href = sectionUrl(base, next.id);
      a.textContent = `→ ${next.title}`;
      p.append(a);
      box.append(p);
    }
    return { id: group.id, title: group.title, html: sanitize(box.innerHTML) };
  });

  return { page: { ...page, url: base }, sections, anchors, menu };
}

/**
 * 開く URL を, 分けたページの URL にする (リンクの移り先の名前があれば, その名前がある部分).
 *
 * 移り先の名前がない (分からない) ときは, クエリの部分. それもなければ, 最初の部分.
 *
 * @param sectioned 分けたページ
 * @param url 開く URL (元のページの URL か, 分けたページの URL. フラグメントがあってもよい)
 * @returns 分けたページの URL (フラグメントは, そのまま残す)
 */
export function resolveSectionUrl(sectioned: SectionedPage, url: string): string {
  const anchor = hashOf(url);
  const requested = new URL(url).searchParams.get(SECTION_PARAM);
  const ids = sectioned.sections.map((section) => section.id);
  const id =
    sectioned.anchors.get(anchor) ??
    (requested !== null && ids.includes(requested) ? requested : ids[0]);
  return sectionUrl(sectioned.page.url, id, anchor);
}

/**
 * 分けたページの 1 つを, 取り出したページの形にする.
 *
 * @param sectioned 分けたページ
 * @param url 分けたページの URL ({@link resolveSectionUrl} の結果. フラグメントは, 除く)
 * @returns ページ (部分がなければ, 最初の部分)
 */
export function sectionPage(sectioned: SectionedPage, url: string): DocPage {
  const requested = new URL(url).searchParams.get(SECTION_PARAM);
  const section =
    sectioned.sections.find((candidate) => candidate.id === requested) ?? sectioned.sections[0];
  return {
    ...sectioned.page,
    url: withoutHash(url),
    title: section.title || sectioned.page.title,
    html: section.html,
    menu: sectioned.menu,
  };
}
