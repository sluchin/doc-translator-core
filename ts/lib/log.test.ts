/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { captureErrors, formatLog, isLogEnabled, log, setupLog } from "./log";

describe("log", () => {
  afterEach(() => {
    setupLog(false);
    vi.restoreAllMocks();
  });

  it("開発版はデバッグ以上, リリース版は情報以上を出す", () => {
    setupLog(true);
    expect(isLogEnabled("debug")).toBe(true);

    setupLog(false);
    expect(isLogEnabled("debug")).toBe(false);
    expect(isLogEnabled("info")).toBe(true);
    expect(isLogEnabled("error")).toBe(true);
  });

  it("コンソールに出して, バックエンドへ送る", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const sink = vi.fn().mockResolvedValue(undefined);
    setupLog(false, sink);

    log.info("loaded", 3);
    log.debug("hidden");

    expect(info).toHaveBeenCalledWith("loaded", 3);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith("info", "loaded 3");
  });

  it("全ての重大度で出せて, 送れなくても例外にならない", async () => {
    for (const level of ["debug", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation(() => undefined);
    }
    const sink = vi.fn().mockRejectedValue(new Error("offline"));
    setupLog(true, sink);

    log.debug("a");
    log.warn("b");
    log.error("c");
    await Promise.resolve();

    expect(sink.mock.calls.map((call) => call[0])).toEqual(["debug", "warn", "error"]);
  });

  it("送る関数がなければ, コンソールだけに出す", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setupLog(false);

    log.warn("only console");

    expect(warn).toHaveBeenCalledWith("only console");
  });

  it("例外は, スタックトレースか, メッセージにする. 文字列でないものは, JSON にする", () => {
    const withStack = new Error("boom");
    const withoutStack = new Error("plain");
    withoutStack.stack = undefined;

    expect(formatLog([withStack])).toBe(withStack.stack);
    expect(formatLog([withoutStack])).toBe("plain");
    expect(formatLog(["a", { b: 1 }])).toBe('a {"b":1}');
  });

  it("画面の予期しないエラーを, エラーのログに出す", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sink = vi.fn().mockResolvedValue(undefined);
    setupLog(false, sink);
    const target = new EventTarget() as unknown as Window;
    captureErrors(target);

    const error = new Error("boom");
    target.dispatchEvent(Object.assign(new Event("error"), { error, message: "boom" }));
    target.dispatchEvent(Object.assign(new Event("error"), { error: null, message: "script" }));
    const rejection = Object.assign(new Event("unhandledrejection"), { reason: "nope" });
    target.dispatchEvent(rejection);

    expect(sink.mock.calls.map((call) => call[1])).toEqual([
      `Uncaught error: ${String(error.stack)}`,
      "Uncaught error: script",
      "Unhandled rejection: nope",
    ]);
  });
});
