/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { LogLevel } from "./log";

/** ログファイルの 1 件. */
export interface LogEntry {
  /** 日時 (ログファイルのまま. UTC). 形が分からない行は空. */
  time: string;
  /** 重大度 (trace は, debug にする). */
  level: LogLevel;
  /** 出したところ (Rust のモジュール. 画面のログは `frontend`). */
  target: string;
  /** 内容 (スタックトレースなど, 複数の行のこともある). */
  message: string;
}

/** ログファイルの 1 件の, 最初の行 (env_logger の形: `[日時 重大度 出したところ] 内容`). */
const HEAD = /^\[(\S+) (TRACE|DEBUG|INFO|WARN|ERROR)\s+([^\]]*)\] ?(.*)$/;

/** 重大度の順 (低い順). */
const ORDER: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/**
 * ログファイルの文字列を, 1 件ずつに分ける. 形の合わない行は, 前の件の続き (スタックトレースなど) にする.
 *
 * @param text ログファイルの文字列
 * @returns ログ (古い順)
 */
export function parseLog(text: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of text.split("\n")) {
    const head = HEAD.exec(line);
    if (head) {
      const [, time, level, target, message] = head;
      entries.push({
        time,
        level: level === "TRACE" ? "debug" : (level.toLowerCase() as LogLevel),
        target: target.trim(),
        message,
      });
      continue;
    }
    const last = entries.at(-1);
    if (last) {
      last.message += `\n${line}`;
    } else if (line !== "") {
      // ファイルの最初が, 前の件の続きのとき (読む量の上限で, 切れたとき)
      entries.push({ time: "", level: "info", target: "", message: line });
    }
  }
  // 最後の改行で付いた, 空の行を除く
  for (const entry of entries) {
    entry.message = entry.message.replace(/\n+$/, "");
  }
  return entries;
}

/**
 * 重大度で, ログを絞り込む.
 *
 * @param entries ログ
 * @param minimum 出す, 最も低い重大度
 * @returns 絞り込んだログ (順は変えない)
 */
export function filterLog(entries: readonly LogEntry[], minimum: LogLevel): LogEntry[] {
  const lowest = ORDER.indexOf(minimum);
  return entries.filter((entry) => ORDER.indexOf(entry.level) >= lowest);
}

/**
 * ログの日時 (UTC) を, 端末の時刻の `YYYY-MM-DD HH:mm:ss.SSS` にする.
 *
 * @param time ログの日時
 * @returns 端末の時刻 (日時でなければ, そのまま)
 */
export function localTime(time: string): string {
  const date = new Date(time);
  if (time === "" || Number.isNaN(date.getTime())) {
    return time;
  }
  const two = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.` +
    String(date.getMilliseconds()).padStart(3, "0")
  );
}
