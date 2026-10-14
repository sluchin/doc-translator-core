/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** 本文の、スクロールの状態. */
export interface Metrics {
  /** 上から、スクロールした長さ. */
  readonly top: number;
  /** 本文の全体の長さ. */
  readonly height: number;
  /** 見えている長さ. */
  readonly view: number;
}

/** 本文の中の、読んでいる場所 (何画面目か). */
export interface Position {
  /** 見えている画面の下の端が、何画面目か (1 から). */
  readonly index: number;
  /** 本文の全体の画面の数 (1 画面に収まるなら 1). */
  readonly total: number;
}

/**
 * 読んでいる場所を、画面の数で表す (全体が 10 画面で、今 3 画面目まで来た、など).
 *
 * @param m スクロールの状態
 * @returns 位置
 */
export function screenPosition(m: Metrics): Position {
  if (m.view <= 0) {
    return { index: 1, total: 1 };
  }
  const total = Math.max(1, Math.ceil(m.height / m.view));
  return { index: Math.min(total, Math.max(1, Math.ceil((m.top + m.view) / m.view))), total };
}

/**
 * 本文の、読んだ位置を、割合にする.
 *
 * @param top 上から、スクロールした長さ
 * @param height 本文の全体の長さ
 * @param view 見えている長さ
 * @returns 0 (先頭) から 1 (末尾). 1 画面に収まるなら 0
 */
export function scrollRatio(top: number, height: number, view: number): number {
  const range = height - view;
  return range <= 0 ? 0 : Math.min(1, Math.max(0, top / range));
}

/**
 * 割合から、スクロールする長さを求める (`scrollRatio` の逆).
 *
 * @param ratio 0 から 1
 * @param height 本文の全体の長さ
 * @param view 見えている長さ
 * @returns 上から、スクロールする長さ
 */
export function scrollTopFor(ratio: number, height: number, view: number): number {
  return ratio * Math.max(0, height - view);
}

/** スクロールバーのつまみの、大きさと位置. */
export interface Thumb {
  /** つまみの長さ [px]. */
  readonly size: number;
  /** トラックの上端からの位置 [px]. */
  readonly offset: number;
}

/** つまみの最小の長さ [px] (本文が長くても、指でつかめるようにする). */
export const MIN_THUMB = 48;

/**
 * スクロールバーのつまみを求める.
 *
 * @param m スクロールの状態
 * @param track トラック (つまみが動ける長さ) [px]
 * @returns つまみ (1 画面に収まるなど、スクロールできないときは undefined)
 */
export function thumbOf(m: Metrics, track: number): Thumb | undefined {
  if (m.height <= m.view || m.view <= 0 || track <= 0) {
    return undefined;
  }
  const size = Math.min(track, Math.max(MIN_THUMB, (m.view / m.height) * track));
  return { size, offset: scrollRatio(m.top, m.height, m.view) * (track - size) };
}

/**
 * 指の位置から、つまみがあるべき割合を求める (つまみの中心が、指の位置にくる).
 *
 * @param y 指の位置 (トラックの上端から) [px]
 * @param track トラックの長さ [px]
 * @param size つまみの長さ [px]
 * @returns 0 から 1
 */
export function ratioFromPointer(y: number, track: number, size: number): number {
  const range = track - size;
  return range <= 0 ? 0 : Math.min(1, Math.max(0, (y - size / 2) / range));
}
