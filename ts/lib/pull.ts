/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** 離すと更新する、引いた距離 [px]. */
export const PULL_THRESHOLD = 64;

/** 引いた距離の上限 [px] (それより引いても、表示は伸ばさない). */
export const PULL_MAX = 96;

/** 指の動きに対する、引いた距離の割合 (重く感じるように、指の動きの半分だけ動かす). */
const PULL_RESISTANCE = 0.5;

/**
 * 下に引いた距離を返す (本文が一番上にあって、下へ引いたときだけ).
 *
 * @param startY 触れ始めた位置 (画面の上から) [px]
 * @param y 今の指の位置 [px]
 * @param atTop 触れ始めたとき、本文が一番上にあったか
 * @returns 引いた距離 (0 から {@link PULL_MAX}) [px]
 */
export function pullDistance(startY: number, y: number, atTop: boolean): number {
  if (!atTop) {
    return 0;
  }
  return Math.min(PULL_MAX, Math.max(0, (y - startY) * PULL_RESISTANCE));
}

/**
 * 離したときに、更新するか.
 *
 * @param distance 引いた距離 [px]
 * @returns {@link PULL_THRESHOLD} 以上引いていれば true
 */
export function shouldRefresh(distance: number): boolean {
  return distance >= PULL_THRESHOLD;
}
