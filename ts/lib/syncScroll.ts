/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** 本文の中の, 1 つのブロック (段落や見出し) の位置. */
export interface Block {
  /** 本文の上端からの位置 [px]. */
  readonly top: number;
  /** 高さ [px]. */
  readonly height: number;
}

/**
 * 片方の本文のスクロールの位置から, もう片方の本文の, 同じ段落の位置を求める (原文と翻訳を並べるとき).
 *
 * 原文と翻訳は, 段落や見出しの数と順番が同じ (翻訳は, 段落の中身だけを置き換える). 片方の画面の上端にある
 * ブロックと, その中の割合を求めて, もう片方の同じブロックの, 同じ割合の位置にする (英語と日本語で,
 * 長さが違っても, ずれない).
 *
 * @param from スクロールした本文のブロック (上から順)
 * @param to 合わせる本文のブロック (上から順)
 * @param top スクロールした本文の, 上からスクロールした長さ [px]
 * @returns 合わせる本文の, スクロールする長さ [px] (ブロックがないか, 数が違えば undefined)
 */
export function syncedTop(
  from: readonly Block[],
  to: readonly Block[],
  top: number,
): number | undefined {
  if (from.length === 0 || from.length !== to.length) {
    return undefined;
  }
  // 画面の上端にある (上端より上から始まる, 最後の) ブロックを, 二分探索で探す
  let low = 0;
  let high = from.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (from[middle].top <= top) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (found < 0) {
    // 最初のブロックより上 (本文の初め): 最初のブロックまでの長さの割合で合わせる
    return (to[0].top * top) / Math.max(1, from[0].top);
  }
  const ratio = Math.min(1, (top - from[found].top) / Math.max(1, from[found].height));
  return to[found].top + ratio * to[found].height;
}
