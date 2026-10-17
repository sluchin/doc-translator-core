/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type RefObject, useEffect } from "react";
import { scrollRatio, scrollTopFor } from "../lib/progress";
import { type Block, syncedTop } from "../lib/syncScroll";

/** 位置を合わせるブロック (原文と翻訳で, 数と順番が同じ要素). */
const BLOCKS = "h1, h2, h3, h4, h5, h6, p, li, pre, table, dt, dd, blockquote, figure";

/**
 * スクロールする要素の中の, ブロックの位置を集める.
 *
 * @param box スクロールする要素
 * @returns ブロックの位置 (上から順)
 */
export function blocksOf(box: HTMLElement): Block[] {
  const base = box.getBoundingClientRect().top - box.scrollTop;
  return Array.from(box.querySelectorAll(BLOCKS)).map((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top - base, height: rect.height };
  });
}

/**
 * 2 つの本文 (原文と翻訳) のスクロールを連動させる. 片方をスクロールすると, もう片方の同じ段落に合わせる.
 *
 * @param left 左の本文 (原文) のスクロールする要素
 * @param right 右の本文 (翻訳) のスクロールする要素
 * @param enabled 連動させるか (並べて表示しているとき)
 * @param html 右の本文の HTML (変わったら, 合わせ直す)
 */
export function useSyncScroll(
  left: RefObject<HTMLElement | null>,
  right: RefObject<HTMLElement | null>,
  enabled: boolean,
  html: string,
): void {
  useEffect(() => {
    const a = left.current;
    const b = right.current;
    if (!enabled || !a || !b) {
      return;
    }
    // 合わせるために動かした側の、次のスクロールの知らせは、無視する (合わせ返して、揺れないように)
    let skip: HTMLElement | undefined;
    let frame = 0;
    const align = (from: HTMLElement, to: HTMLElement) => {
      const top =
        syncedTop(blocksOf(from), blocksOf(to), from.scrollTop) ??
        scrollTopFor(
          scrollRatio(from.scrollTop, from.scrollHeight, from.clientHeight),
          to.scrollHeight,
          to.clientHeight,
        );
      const before = to.scrollTop;
      to.scrollTop = top;
      if (to.scrollTop !== before) {
        skip = to;
      }
    };
    const follow = (from: HTMLElement, to: HTMLElement) => () => {
      if (skip === from) {
        skip = undefined;
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => align(from, to));
    };
    const onLeft = follow(a, b);
    const onRight = follow(b, a);
    a.addEventListener("scroll", onLeft, { passive: true });
    b.addEventListener("scroll", onRight, { passive: true });
    // 並べたときと、本文が変わったときは、原文を、翻訳の位置に合わせる
    frame = requestAnimationFrame(() => align(b, a));
    return () => {
      cancelAnimationFrame(frame);
      a.removeEventListener("scroll", onLeft);
      b.removeEventListener("scroll", onRight);
    };
  }, [left, right, enabled, html]);
}
