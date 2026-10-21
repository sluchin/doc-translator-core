/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { invoke } from "@tauri-apps/api/core";
import type { LogLevel } from "../lib/log";
import { exportStamp } from "../lib/stamp";

/** API キーがないときの、翻訳のエラー (Rust 側と合わせる). */
export const NO_API_KEY = "NO_API_KEY";

/**
 * Zephyr のドキュメントのページの HTML を、Rust 側で取得する.
 *
 * @param url ページの URL
 * @returns HTML
 */
export function fetchPage(url: string): Promise<string> {
  return invoke<string>("fetch_page", { url });
}

/**
 * サイトの JSON ファイル (メニューなど) を、Rust 側で取得する.
 *
 * @param url JSON の URL
 * @returns JSON の文字列
 */
export function fetchJson(url: string): Promise<string> {
  return invoke<string>("fetch_json", { url });
}

/**
 * サイトの CSS を、Rust 側で取得する (サイトの見た目で表示するため. ページと同じホストのものだけ).
 *
 * @param url CSS の URL
 * @returns CSS
 */
export function fetchCss(url: string): Promise<string> {
  return invoke<string>("fetch_css", { url });
}

/**
 * ML Kit が動くかを確かめる (翻訳のモデルを取得して、短い文章を翻訳する).
 *
 * @returns 翻訳の結果 (失敗したら、例外)
 */
export function checkMlkit(): Promise<string> {
  return invoke<string>("check_mlkit");
}

/**
 * 文章 (HTML の断片) を、Rust 側で日本語に翻訳する.
 *
 * @param texts 文章
 * @param scope キャッシュを分ける範囲 (ドキュメントの版. なければ、分けない)
 * @param fresh キャッシュにある文章も、翻訳し直すか (「翻訳し直す」のとき)
 * @returns 翻訳 (同じ数、同じ順)
 */
export function translate(texts: string[], scope?: string, fresh = false): Promise<string[]> {
  return invoke<string[]>("translate", { texts, scope, fresh });
}

/**
 * 翻訳済みの文章を, 今のサービスのキャッシュから探す (通信しない).
 *
 * @param texts 文章 (HTML の断片)
 * @param scope キャッシュを分ける範囲 (ドキュメントの版. なければ、分けない)
 * @returns 翻訳 (同じ数, 同じ順. ない文章は null)
 */
export function lookupCache(texts: string[], scope?: string): Promise<(string | null)[]> {
  return invoke<(string | null)[]>("lookup_cache", { texts, scope });
}

/** 翻訳に使うサービス. */
export type Provider = "google" | "gemini" | "mlkit" | "googlefree";

/** 設定 (API キーそのものは、含まれない). */
export interface SettingsView {
  /** 翻訳に使うサービス. */
  provider: Provider;
  /** Google の API キーが設定されているか. */
  hasGoogleKey: boolean;
  /** Gemini の API キーが設定されているか. */
  hasGeminiKey: boolean;
  /** Gemini のモデル. */
  geminiModel: string;
  /** 無料の Google 翻訳に、同時に送る依頼の数. */
  freeParallel: number;
  /** ML Kit が使えるか (Android だけ). */
  mlkitAvailable: boolean;
}

/** 設定の変更. キーは、undefined なら変えず、空の文字列なら消す. */
export interface SettingsUpdate {
  /** 翻訳に使うサービス. */
  provider: Provider;
  /** Google の API キー. */
  googleKey?: string;
  /** Gemini の API キー. */
  geminiKey?: string;
  /** Gemini のモデル (空なら既定). */
  geminiModel: string;
  /** 無料の Google 翻訳に、同時に送る依頼の数 (undefined なら変えない). */
  freeParallel?: number;
}

/**
 * 設定を取得する.
 *
 * @returns 設定
 */
export function getSettings(): Promise<SettingsView> {
  return invoke<SettingsView>("get_settings");
}

/**
 * 設定を変えて保存する.
 *
 * @param update 変更
 * @returns 変えたあとの設定
 */
export function setSettings(update: SettingsUpdate): Promise<SettingsView> {
  return invoke<SettingsView>("set_settings", { update });
}

/** 書き出しの結果: 保存した (PC)、Google Drive に渡した (Android)、やめた. */
export type Exported = "saved" | "shared" | "cancelled";

/**
 * 翻訳のキャッシュを書き出す (Android は Google Drive のアプリに渡す. PC は保存の画面を開く).
 *
 * @returns 書き出しの結果
 */
export function exportCache(): Promise<Exported> {
  return invoke<Exported>("export_cache", { stamp: exportStamp(new Date()) });
}

/**
 * 書き出したキャッシュを読み込んで、端末のキャッシュに足し合わせる (選択の画面を開く).
 *
 * @returns 新しく足した翻訳の数 (選ぶのをやめたら null)
 */
export function importCache(): Promise<number | null> {
  return invoke<number | null>("import_cache");
}

/**
 * フロントエンドのログを, Rust 側のログ (標準エラー出力とログファイル) へ送る.
 *
 * @param level ログの重大度
 * @param message ログ
 * @returns 送り終えたとき
 */
export function logToBackend(level: LogLevel, message: string): Promise<void> {
  return invoke<void>("log_frontend_message", { level, message });
}

/**
 * アプリのログの末尾を返す (古いログファイルも含めて, 新しい方から約 512 KB).
 *
 * @returns ログファイルの文字列
 */
export function readLog(): Promise<string> {
  return invoke<string>("read_log");
}

/**
 * アプリのログを消す.
 *
 * @returns 消し終えたとき
 */
export function clearLog(): Promise<void> {
  return invoke<void>("clear_log");
}

/**
 * アプリのログを書き出す (書き出し方は, 翻訳のキャッシュと同じ).
 *
 * @returns 書き出しの結果
 */
export function exportLog(): Promise<Exported> {
  return invoke<Exported>("export_log", { stamp: exportStamp(new Date()) });
}
