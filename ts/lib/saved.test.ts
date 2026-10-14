/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import {
  MIN_THUMB,
  ratioFromPointer,
  screenPosition,
  scrollRatio,
  scrollTopFor,
  thumbOf,
} from "./progress";
import {
  EMPTY_SAVED,
  MAX_SCROLL,
  type KeyValue,
  isBookmarked,
  loadSaved,
  parseSaved,
  storeSaved,
  toggleBookmark,
  withLast,
  withScroll,
} from "./saved";

describe("saved", () => {
  it("reads what was stored and ignores broken values", () => {
    const text = JSON.stringify({
      last: "https://a/b",
      scroll: { "https://a/b": 0.5, "https://a/c": "x" },
      bookmarks: [{ url: "https://a/b", title: "B" }, { url: 1 }, "x"],
    });
    expect(parseSaved(text)).toEqual({
      last: "https://a/b",
      scroll: { "https://a/b": 0.5 },
      bookmarks: [{ url: "https://a/b", title: "B" }],
    });
    expect(parseSaved(null)).toEqual({ last: undefined, scroll: {}, bookmarks: [] });
    expect(parseSaved("{")).toBe(EMPTY_SAVED);
    expect(parseSaved('{"last":1,"bookmarks":2}').last).toBeUndefined();
  });

  it("loads and stores through a storage that may be missing or broken", () => {
    const data = new Map<string, string>();
    const store: KeyValue = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
    };
    storeSaved(store, "k", withLast(EMPTY_SAVED, "https://a/b"));
    expect(loadSaved(store, "k").last).toBe("https://a/b");
    expect(loadSaved(undefined, "k")).toEqual({ last: undefined, scroll: {}, bookmarks: [] });
    const broken: KeyValue = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(loadSaved(broken, "k")).toBe(EMPTY_SAVED);
    expect(() => storeSaved(broken, "k", EMPTY_SAVED)).not.toThrow();
    expect(() => storeSaved(undefined, "k", EMPTY_SAVED)).not.toThrow();
  });

  it("remembers the position of each page and drops the oldest ones", () => {
    let saved = withScroll(EMPTY_SAVED, "u0", 0.12345);
    expect(saved.scroll).toEqual({ u0: 0.123 });
    for (let i = 1; i <= MAX_SCROLL; i++) {
      saved = withScroll(saved, `u${i}`, 0.5);
    }
    expect(Object.keys(saved.scroll)).toHaveLength(MAX_SCROLL);
    expect(saved.scroll.u0).toBeUndefined();
    saved = withScroll(saved, "u1", 0.9);
    expect(Object.keys(saved.scroll).at(-1)).toBe("u1");
    expect(saved.scroll.u1).toBe(0.9);
  });

  it("adds and removes a bookmark", () => {
    const one = toggleBookmark([], "u", "T");
    expect(one).toEqual([{ url: "u", title: "T" }]);
    expect(isBookmarked(one, "u")).toBe(true);
    expect(toggleBookmark(one, "u", "T")).toEqual([]);
    expect(isBookmarked([], "u")).toBe(false);
  });
});

describe("progress", () => {
  it("shows the position as the number of the screens", () => {
    expect(screenPosition({ top: 0, height: 2500, view: 1000 })).toEqual({ index: 1, total: 3 });
    expect(screenPosition({ top: 500, height: 2500, view: 1000 })).toEqual({ index: 2, total: 3 });
    expect(screenPosition({ top: 1500, height: 2500, view: 1000 })).toEqual({ index: 3, total: 3 });
    expect(screenPosition({ top: 9000, height: 2500, view: 1000 }).index).toBe(3);
    expect(screenPosition({ top: -9, height: 500, view: 1000 })).toEqual({ index: 1, total: 1 });
    expect(screenPosition({ top: 0, height: 500, view: 0 })).toEqual({ index: 1, total: 1 });
  });

  it("converts the scroll position to a ratio and back", () => {
    expect(scrollRatio(500, 1500, 500)).toBe(0.5);
    expect(scrollRatio(-5, 1500, 500)).toBe(0);
    expect(scrollRatio(2000, 1500, 500)).toBe(1);
    expect(scrollRatio(10, 400, 500)).toBe(0);
    expect(scrollTopFor(0.5, 1500, 500)).toBe(500);
    expect(scrollTopFor(0.5, 400, 500)).toBe(0);
  });

  it("places the thumb of the scroll bar and reads the finger", () => {
    expect(thumbOf({ top: 0, height: 1000, view: 500 }, 400)).toEqual({ size: 200, offset: 0 });
    expect(thumbOf({ top: 500, height: 1000, view: 500 }, 400)).toEqual({ size: 200, offset: 200 });
    expect(thumbOf({ top: 0, height: 100000, view: 500 }, 400)?.size).toBe(MIN_THUMB);
    expect(thumbOf({ top: 0, height: 1000, view: 500 }, 20)?.size).toBe(20);
    expect(thumbOf({ top: 0, height: 500, view: 500 }, 400)).toBeUndefined();
    expect(thumbOf({ top: 0, height: 500, view: 0 }, 400)).toBeUndefined();
    expect(thumbOf({ top: 0, height: 1000, view: 500 }, 0)).toBeUndefined();
    expect(ratioFromPointer(200, 400, 200)).toBe(0.5);
    expect(ratioFromPointer(-50, 400, 200)).toBe(0);
    expect(ratioFromPointer(900, 400, 200)).toBe(1);
    expect(ratioFromPointer(10, 200, 200)).toBe(0);
  });
});
