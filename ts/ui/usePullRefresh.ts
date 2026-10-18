/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type RefObject, useEffect, useRef, useState } from "react";
import { pullDistance, shouldRefresh } from "../lib/pull";

/**
 * 本文を、一番上で下に引いて離すと、更新する (タッチの画面. スマホなど).
 *
 * @param box 本文のスクロールする要素
 * @param onRefresh 更新する
 * @param enabled 引けるか (取得や翻訳の最中は、引けない)
 * @returns 今、引いている距離 [px] (引いていなければ 0)
 */
export function usePullRefresh(
  box: RefObject<HTMLElement | null>,
  onRefresh: () => void,
  enabled: boolean,
): number {
  const [distance, setDistance] = useState(0);
  // 触れ始めた位置と、そのとき一番上にあったか (触れていなければ undefined)
  const start = useRef<{ y: number; atTop: boolean }>(undefined);
  // タッチの処理から読む、最新の値 (処理を付け直さずに済むように)
  const latest = useRef({ distance: 0, onRefresh, enabled });

  useEffect(() => {
    latest.current.onRefresh = onRefresh;
    latest.current.enabled = enabled;
  }, [onRefresh, enabled]);

  useEffect(() => {
    const element = box.current;
    if (!element) {
      return;
    }
    const set = (next: number) => {
      latest.current.distance = next;
      setDistance(next);
    };
    const begin = (event: TouchEvent) => {
      start.current = {
        y: event.touches[0].clientY,
        atTop: latest.current.enabled && element.scrollTop <= 0,
      };
    };
    const move = (event: TouchEvent) => {
      const from = start.current;
      if (from) {
        set(pullDistance(from.y, event.touches[0].clientY, from.atTop));
      }
    };
    const end = () => {
      if (shouldRefresh(latest.current.distance)) {
        latest.current.onRefresh();
      }
      start.current = undefined;
      set(0);
    };
    element.addEventListener("touchstart", begin, { passive: true });
    element.addEventListener("touchmove", move, { passive: true });
    element.addEventListener("touchend", end);
    element.addEventListener("touchcancel", end);
    return () => {
      element.removeEventListener("touchstart", begin);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", end);
    };
  }, [box]);

  return distance;
}
