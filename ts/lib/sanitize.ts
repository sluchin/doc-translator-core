/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import DOMPurify from "dompurify";

/**
 * HTML から, スクリプト, フォーム, インラインのスタイルなど, 危ないものを取り除く.
 *
 * サイトから取得した HTML も, 翻訳サービスが返した HTML も, 表示の前に必ずこれを通す.
 *
 * @param html HTML
 * @returns 安全な HTML
 */
export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed", "link"],
    FORBID_ATTR: ["style", "srcset"],
  });
}
