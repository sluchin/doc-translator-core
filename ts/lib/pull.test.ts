/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { PULL_MAX, PULL_THRESHOLD, pullDistance, shouldRefresh } from "./pull";

describe("pullDistance", () => {
  it("一番上で下へ引くと、指の動きの半分だけ動き、上限で止まる", () => {
    expect(pullDistance(100, 180, true)).toBe(40);
    expect(pullDistance(100, 1000, true)).toBe(PULL_MAX);
  });

  it("上へ動かしたときと、一番上でないときは、0", () => {
    expect(pullDistance(100, 50, true)).toBe(0);
    expect(pullDistance(100, 300, false)).toBe(0);
  });
});

describe("shouldRefresh", () => {
  it("決めた距離以上引いていれば、更新する", () => {
    expect(shouldRefresh(PULL_THRESHOLD)).toBe(true);
    expect(shouldRefresh(PULL_THRESHOLD - 1)).toBe(false);
  });
});
