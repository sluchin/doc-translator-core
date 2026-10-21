/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** ログの重大度 (低い順). */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** ログを, バックエンドのログ (標準エラー出力とログファイル) へ送る関数. */
export type LogSink = (level: LogLevel, message: string) => Promise<void>;

/** 重大度の順. */
const ORDER: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/** 出す, 最も低い重大度 (setupLog の前は, 情報以上). */
let minimum: LogLevel = "info";

/** バックエンドへ送る関数 (setupLog の前は, 送らない). */
let sink: LogSink | undefined;

/**
 * ログの仕組みを設定する. アプリの起動のときに 1 度だけ呼ぶ.
 *
 * 開発版はデバッグ以上, リリース版は情報 (最低限), 警告, エラーを出す (判定は, この関数の中でする).
 * 出したログは, 開発者ツールのコンソールに加えて, バックエンドへも送る.
 *
 * @param dev 開発版か
 * @param send バックエンドへ送る関数 (なければ, 送らない)
 */
export function setupLog(dev: boolean, send?: LogSink): void {
  minimum = dev ? "debug" : "info";
  sink = send;
}

/**
 * 重大度のログを出すか.
 *
 * @param level 重大度
 * @returns 出すなら, true
 */
export function isLogEnabled(level: LogLevel): boolean {
  return ORDER.indexOf(level) >= ORDER.indexOf(minimum);
}

/**
 * ログの引数を, 1 行の文字列にする (例外は, スタックトレース. なければ, メッセージ).
 *
 * @param args ログの引数
 * @returns 文字列
 */
export function formatLog(args: readonly unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return arg.stack ?? arg.message;
      }
      return typeof arg === "string" ? arg : JSON.stringify(arg);
    })
    .join(" ");
}

/**
 * ログを出す (出さない重大度なら, 何もしない). バックエンドへ送れなくても, 例外にしない.
 *
 * @param level 重大度
 * @param args ログの引数
 */
function write(level: LogLevel, args: readonly unknown[]): void {
  if (!isLogEnabled(level)) {
    return;
  }
  console[level](...args);
  // 送れなくても, 画面には影響がないので, 無視する (ここで log を呼ぶと, 送るのが繰り返されるので, 呼ばない)
  sink?.(level, formatLog(args)).catch(() => undefined);
}

/** アプリのログ (`log.debug(...)` のように使う). */
export const log = {
  /**
   * デバッグのログ (開発版だけ).
   *
   * @param args ログの引数
   */
  debug: (...args: unknown[]) => write("debug", args),
  /**
   * 情報のログ (最低限にする).
   *
   * @param args ログの引数
   */
  info: (...args: unknown[]) => write("info", args),
  /**
   * 警告のログ (失敗したが, 続けられるとき).
   *
   * @param args ログの引数
   */
  warn: (...args: unknown[]) => write("warn", args),
  /**
   * エラーのログ (利用者の操作が, 失敗したとき).
   *
   * @param args ログの引数
   */
  error: (...args: unknown[]) => write("error", args),
};

/**
 * 画面の予期しないエラー (捕まえていない例外と, 拒否された Promise) を, エラーのログに出す.
 *
 * ログはバックエンドのログファイルにも残るので, あとからアプリのログの画面で見られる. アプリの起動のときに 1 度だけ呼ぶ.
 *
 * @param target エラーを受けるウィンドウ
 */
export function captureErrors(target: Window): void {
  target.addEventListener("error", (event) => {
    log.error("Uncaught error:", event.error ?? event.message);
  });
  target.addEventListener("unhandledrejection", (event) => {
    log.error("Unhandled rejection:", event.reason);
  });
}
