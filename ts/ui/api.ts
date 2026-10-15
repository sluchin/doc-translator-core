/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { invoke } from "@tauri-apps/api/core";

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
 * @returns 翻訳 (同じ数、同じ順)
 */
export function translate(texts: string[]): Promise<string[]> {
  return invoke<string[]>("translate", { texts });
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
