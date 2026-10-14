/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type PointerEvent, type RefObject, useState } from "react";
import {
  type Metrics,
  type Position,
  ratioFromPointer,
  scrollTopFor,
  thumbOf,
} from "../lib/progress";

/** スクロールバーの画面の引数. */
interface Props {
  /** スクロールする本文の要素. */
  box: RefObject<HTMLElement | null>;
  /** 本文のスクロールの状態. */
  metrics: Metrics;
  /** 読んでいる場所 (何画面目か / 全体で何画面か). */
  position: Position;
  /** 読んだ割合 (0 から 1). */
  ratio: number;
}

/**
 * 本文の右に出す、スクロールバー. つまみを押している間 (動かしている間) は、
 * 「3 / 12 画面 (25%)」のように、読み進めた場所と、全体を、つまみの横に出す.
 *
 * @param props 引数
 * @returns スクロールバー (スクロールできないときは、何も出さない)
 */
export function ScrollBar({ box, metrics, position, ratio }: Props) {
  const [pressed, setPressed] = useState(false);
  const track = metrics.view;
  const thumb = thumbOf(metrics, track);
  if (!thumb) {
    return null;
  }

  const seek = (event: PointerEvent<HTMLDivElement>) => {
    const element = box.current;
    if (!element) {
      return;
    }
    const top = event.currentTarget.getBoundingClientRect().top;
    const at = ratioFromPointer(event.clientY - top, track, thumb.size);
    element.scrollTo({ top: scrollTopFor(at, element.scrollHeight, element.clientHeight) });
  };

  return (
    <div
      className={`scrollbar${pressed ? " pressed" : ""}`}
      role="scrollbar"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setPressed(true);
        seek(event);
      }}
      onPointerMove={(event) => pressed && seek(event)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
    >
      <div className="scrollbar-thumb" style={{ height: thumb.size, top: thumb.offset }} />
      {pressed && (
        <div className="scrollbar-bubble" style={{ top: thumb.offset + thumb.size / 2 }}>
          {position.index} / {position.total} 画面 ({Math.round(ratio * 100)}%)
        </div>
      )}
    </div>
  );
}
