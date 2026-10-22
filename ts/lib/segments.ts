/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { KeepTerms } from "./profile";

/** 段落などの, ブロックの要素 (この中の文章は, 子のブロックとは別に翻訳する). */
const BLOCK = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "CAPTION",
  "CENTER",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

/** 中の文章に触れない要素. */
const SKIP = new Set(["PRE", "SCRIPT", "STYLE", "TEXTAREA", "SVG", "MATH"]);

/** 文の中にあっても, 翻訳しない (そのまま残す) 要素. */
const ATOMIC = new Set(["CODE", "KBD", "SAMP", "TT", "VAR", "SVG", "MATH", "IMG", "BR", "WBR"]);

/**
 * 翻訳しない要素の class (Sphinx の `highlight` `sig` と, Kotlin のドキュメントの `code-block`
 * `code-collapse` (畳めるコード. 練習の答えなど) など).
 */
const SKIP_CLASSES = [
  "notranslate",
  "highlight",
  "literal-block",
  "code-block",
  "code-collapse",
  "sig",
  "headerlink",
];

/** 「翻訳しない」印の class. */
const MARK_CLASS = "notranslate";

/** 文章の連なりを包む要素の属性. */
const RUN_ATTRIBUTE = "data-zd-run";

/** 翻訳に渡すときに, 前に付ける言葉を持つ属性 (翻訳しない言葉で始まる要素). */
const LEAD_ATTRIBUTE = "data-zd-lead";

/**
 * 要素が, 翻訳しない (そのまま残す) ものかを確かめる.
 *
 * @param element 要素
 * @returns 翻訳しないなら true
 */
function isAtomic(element: Element): boolean {
  return (
    ATOMIC.has(element.tagName.toUpperCase()) ||
    element.getAttribute("translate") === "no" ||
    SKIP_CLASSES.some((name) => element.classList.contains(name))
  );
}

/**
 * ノードに, 翻訳する英文が含まれるかを確かめる (翻訳しない要素の中は見ない).
 *
 * @param node ノード
 * @returns 英字を含む文章があれば true
 */
function hasTranslatableText(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    return /[A-Za-z]/.test(node.textContent as string);
  }
  if (node.nodeType !== Node.ELEMENT_NODE || isAtomic(node as Element)) {
    return false;
  }
  return Array.from(node.childNodes).some(hasTranslatableText);
}

/**
 * ノードが, ブロックの要素かを確かめる.
 *
 * @param node ノード
 * @returns ブロックの要素なら true
 */
function isBlock(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE && BLOCK.has((node as Element).tagName.toUpperCase());
}

/**
 * ブロックの中の, 文章の連なりを 1 つの要素に包んで, 翻訳する単位に加える.
 *
 * @param run 連なっているノード
 * @param found 翻訳する単位の一覧 (ここに加える)
 */
function flushRun(run: Node[], found: Element[]): void {
  if (!run.some(hasTranslatableText)) {
    return;
  }
  const wrapper = (run[0].ownerDocument as Document).createElement("span");
  wrapper.setAttribute(RUN_ATTRIBUTE, "");
  run[0].parentNode?.insertBefore(wrapper, run[0]);
  run.forEach((node) => wrapper.appendChild(node));
  found.push(wrapper);
}

/**
 * 要素の中を歩いて, 翻訳する単位を集める.
 *
 * @param element 要素
 * @param found 翻訳する単位の一覧 (ここに加える)
 */
function walk(element: Element, found: Element[]): void {
  if (SKIP.has(element.tagName.toUpperCase()) || isAtomic(element)) {
    return;
  }
  if (!Array.from(element.children).some(isBlock)) {
    if (hasTranslatableText(element)) {
      found.push(element);
    }
    return;
  }
  let run: Node[] = [];
  for (const child of Array.from(element.childNodes)) {
    if (isBlock(child)) {
      flushRun(run, found);
      run = [];
      walk(child, found);
    } else {
      run.push(child);
    }
  }
  flushRun(run, found);
}

/**
 * 翻訳する単位 (段落, 見出し, 項目など) を集める.
 *
 * コードのブロック, シグネチャ, 英字のない要素は, 含めない. ブロックの子と, 文章が並んでいる
 * ときは, 文章の連なりを `span` に包んで, 1 つの単位にする (このとき, 要素を書き換える).
 *
 * @param root 本文の要素
 * @returns 翻訳する単位の要素 (文書の順)
 */
export function collectSegments(root: Element): Element[] {
  const found: Element[] = [];
  walk(root, found);
  return found;
}

/**
 * 翻訳の前に, 文中のコードなどに「翻訳しない」印 (`translate="no"` と `notranslate`) を付ける.
 *
 * @param segment 翻訳する単位の要素
 * @returns 翻訳に渡す HTML
 */
export function markAtomic(segment: Element): string {
  segment.querySelectorAll("*").forEach((element) => {
    if (isAtomic(element)) {
      element.setAttribute("translate", "no");
      element.classList.add(MARK_CLASS);
    }
  });
  const lead = segment.getAttribute(LEAD_ATTRIBUTE);
  return lead ? `${lead} ${segment.innerHTML}` : segment.innerHTML;
}

/**
 * ノードが, 翻訳しない要素の中 (`root` まで) にあるかを確かめる.
 *
 * @param node ノード
 * @param root 探すのを止める要素
 * @returns 翻訳しない要素の中なら true
 */
function insideAtomic(node: Node, root: Element): boolean {
  for (
    let element = node.parentElement;
    element && element !== root;
    element = element.parentElement
  ) {
    if (isAtomic(element)) {
      return true;
    }
  }
  return false;
}

/**
 * 見出しなどの中の, 翻訳しない言葉 (プログラムの予約語など) を, 「翻訳しない」印の `span` で包む.
 *
 * @param root 本文の要素 (書き換える)
 * @param terms 言葉を探す要素と, 言葉に合わせる正規表現
 */
export function markTerms(root: Element, terms: KeepTerms): void {
  const pattern = new RegExp(terms.pattern.source, `${terms.pattern.flags.replace("g", "")}g`);
  const marks = new Set<Node>();
  root.querySelectorAll(terms.selector).forEach((element) => {
    const doc = element.ownerDocument;
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) {
      texts.push(walker.currentNode as Text);
    }
    texts
      .filter((text) => !insideAtomic(text, element))
      .forEach((text) => {
        const value = text.data;
        const parts: Node[] = [];
        let last = 0;
        for (const match of value.matchAll(pattern)) {
          if (match[0] === "") {
            continue;
          }
          if (match.index > last) {
            parts.push(doc.createTextNode(value.slice(last, match.index)));
          }
          const span = doc.createElement("span");
          span.className = MARK_CLASS;
          span.textContent = match[0];
          marks.add(span);
          parts.push(span);
          last = match.index + match[0].length;
        }
        if (parts.length === 0) {
          return;
        }
        if (last < value.length) {
          parts.push(doc.createTextNode(value.slice(last)));
        }
        text.replaceWith(...parts);
      });
    if (terms.lead && startsWithMark(element, marks)) {
      element.setAttribute(LEAD_ATTRIBUTE, terms.lead);
    }
  });
}

/**
 * 要素の文章が, 付けた「翻訳しない」印で始まるかを確かめる (空白だけの文字は飛ばす).
 *
 * @param element 要素
 * @param marks 付けた印
 * @returns 印で始まれば true
 */
function startsWithMark(element: Element, marks: ReadonlySet<Node>): boolean {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode as Text;
    if (text.data.trim() !== "") {
      // 要素の中の文字なので, 親はある
      return marks.has(text.parentNode as Node);
    }
  }
  return false;
}

/**
 * HTML の中の, 「翻訳しない」印とリンクの数を数える.
 *
 * @param html HTML
 * @returns 印とリンクの数
 */
function countMarks(html: string): number {
  return (html.match(/notranslate|<a[\s>]/gi) ?? []).length;
}

/**
 * 翻訳した HTML が, 元と同じ構造 (コードの印とリンクの数) を保っているかを確かめる.
 *
 * @param original 翻訳に渡した HTML
 * @param translated 翻訳された HTML
 * @returns 保っていれば true
 */
export function keepsStructure(original: string, translated: string): boolean {
  return translated.trim() !== "" && countMarks(original) === countMarks(translated);
}
