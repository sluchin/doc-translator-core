/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** 開いたページの履歴 (戻る, 進む). */
export interface Nav {
  /** 履歴の URL. */
  readonly entries: readonly string[];
  /** 今のページの位置. entries が空なら -1. */
  readonly index: number;
}

/** 空の履歴. */
export const EMPTY_NAV: Nav = { entries: [], index: -1 };

/**
 * 今のページの URL を返す.
 *
 * @param nav 履歴
 * @returns URL (履歴が空なら undefined)
 */
export function current(nav: Nav): string | undefined {
  return nav.entries[nav.index];
}

/**
 * 新しいページを開いた履歴を返す (進む先の履歴は捨てる. 今と同じ URL なら変えない).
 *
 * @param nav 履歴
 * @param url 開いたページの URL
 * @returns 新しい履歴
 */
export function push(nav: Nav, url: string): Nav {
  if (current(nav) === url) {
    return nav;
  }
  const entries = [...nav.entries.slice(0, nav.index + 1), url];
  return { entries, index: entries.length - 1 };
}

/**
 * 戻れるかを返す.
 *
 * @param nav 履歴
 * @returns 戻れるなら true
 */
export function canGoBack(nav: Nav): boolean {
  return nav.index > 0;
}

/**
 * 進めるかを返す.
 *
 * @param nav 履歴
 * @returns 進めるなら true
 */
export function canGoForward(nav: Nav): boolean {
  return nav.index < nav.entries.length - 1;
}

/**
 * 1 つ戻った履歴を返す (戻れなければ, 変えない).
 *
 * @param nav 履歴
 * @returns 新しい履歴
 */
export function back(nav: Nav): Nav {
  return canGoBack(nav) ? { ...nav, index: nav.index - 1 } : nav;
}

/**
 * 1 つ進んだ履歴を返す (進めなければ, 変えない).
 *
 * @param nav 履歴
 * @returns 新しい履歴
 */
export function forward(nav: Nav): Nav {
  return canGoForward(nav) ? { ...nav, index: nav.index + 1 } : nav;
}
