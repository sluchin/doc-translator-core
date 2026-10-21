/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { filterLog, localTime, parseLog } from "./logView";

describe("parseLog", () => {
  it("1 件ずつに分けて, 続きの行は前の件に付ける", () => {
    const text =
      "[2026-10-21T08:12:03.123Z INFO  app_lib] Started\n" +
      "[2026-10-21T08:12:04.000Z ERROR frontend] Uncaught error: boom\n" +
      "    at f (a.js:1)\n" +
      "[2026-10-21T08:12:05Z TRACE x] fine\n" +
      "[2026-10-21T08:12:06Z WARN  y]\n";

    expect(parseLog(text)).toEqual([
      { time: "2026-10-21T08:12:03.123Z", level: "info", target: "app_lib", message: "Started" },
      {
        time: "2026-10-21T08:12:04.000Z",
        level: "error",
        target: "frontend",
        message: "Uncaught error: boom\n    at f (a.js:1)",
      },
      { time: "2026-10-21T08:12:05Z", level: "debug", target: "x", message: "fine" },
      { time: "2026-10-21T08:12:06Z", level: "warn", target: "y", message: "" },
    ]);
  });

  it("最初の行が続きなら, 日時のない件にする. 空なら, 何もない", () => {
    expect(parseLog("    at g (b.js:2)\n[2026-10-21T00:00:00Z DEBUG z] d")).toEqual([
      { time: "", level: "info", target: "", message: "    at g (b.js:2)" },
      { time: "2026-10-21T00:00:00Z", level: "debug", target: "z", message: "d" },
    ]);
    expect(parseLog("")).toEqual([]);
  });
});

describe("filterLog", () => {
  it("重大度で絞り込む", () => {
    const entries = parseLog("[t DEBUG a] 1\n[t INFO  a] 2\n[t WARN  a] 3\n[t ERROR a] 4\n");

    expect(filterLog(entries, "debug").map((e) => e.message)).toEqual(["1", "2", "3", "4"]);
    expect(filterLog(entries, "warn").map((e) => e.message)).toEqual(["3", "4"]);
    expect(filterLog(entries, "error").map((e) => e.message)).toEqual(["4"]);
  });
});

describe("localTime", () => {
  it("端末の時刻にする. 日時でなければ, そのまま", () => {
    const time = "2026-10-21T08:12:03.045Z";
    const date = new Date(time);
    const two = (value: number) => String(value).padStart(2, "0");

    expect(localTime(time)).toBe(
      `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ` +
        `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.045`,
    );
    expect(localTime("")).toBe("");
    expect(localTime("t")).toBe("t");
  });
});
