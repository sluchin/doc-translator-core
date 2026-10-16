/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { absoluteUrl } from "./docUrl";

/** ドキュメントの版の, 1 つの選択肢. */
export interface VersionChoice {
  /** 版 (URL のパスの中の名前. 例: `4.4.0`). */
  readonly version: string;
  /** 画面に出す名前 (例: `3.7.0 (LTS)`). */
  readonly label: string;
}

/**
 * URL から, ドキュメントの版を取り出す.
 *
 * @param url ページの URL
 * @param pattern パスに合わせる正規表現 (1 つ目のグループが版)
 * @returns 版 (合わないか, 読めない URL なら undefined)
 */
export function versionOf(url: string, pattern: RegExp): string | undefined {
  try {
    return pattern.exec(new URL(url).pathname)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * URL の版を, 別の版に替える (同じパスの, 別の版のページ).
 *
 * @param url ページの URL
 * @param pattern パスに合わせる正規表現 (1 つ目のグループが版)
 * @param version 替える版
 * @returns 版を替えた URL (版が見つからないか, 読めない URL なら, そのまま)
 */
export function withVersion(url: string, pattern: RegExp, version: string): string {
  try {
    const parsed = new URL(url);
    const match = pattern.exec(parsed.pathname);
    if (match?.[1] === undefined) {
      return url;
    }
    const start = match.index + match[0].indexOf(match[1]);
    parsed.pathname =
      parsed.pathname.slice(0, start) + version + parsed.pathname.slice(start + match[1].length);
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * ページの中の, 版の一覧のリンクから, 選択肢を作る (版は, リンクの URL のパスから取る. 重複は除く).
 *
 * @param root ページ (の要素)
 * @param selector 版の一覧のリンクの CSS セレクタ
 * @param pattern パスに合わせる正規表現 (1 つ目のグループが版)
 * @param base ページの URL (相対のリンクを, 絶対 URL にする)
 * @returns 選択肢 (ページの順)
 */
export function parseVersions(
  root: ParentNode,
  selector: string,
  pattern: RegExp,
  base: string,
): VersionChoice[] {
  const choices: VersionChoice[] = [];
  root.querySelectorAll(selector).forEach((link) => {
    const href = link.getAttribute("href");
    // リンクのない項目は、版ではない (空のリンクは、ページ自身の URL になってしまう)
    const version = href === null ? undefined : versionOf(absoluteUrl(href, base), pattern);
    if (version !== undefined && !choices.some((choice) => choice.version === version)) {
      choices.push({ version, label: (link.textContent as string).replace(/\s+/g, " ").trim() });
    }
  });
  return choices;
}

/**
 * ファイルの中身から, 版を読み取る.
 *
 * @param text ファイルの中身
 * @param pattern 中身に合わせる正規表現 (1 つ目のグループが版)
 * @returns 版 (合わなければ undefined)
 */
export function versionFromText(text: string, pattern: RegExp): string | undefined {
  return pattern.exec(text)?.[1];
}

/**
 * 選択肢に, 今の版がなければ, 先頭に足す (版の一覧のないページでも, 今の版を出す).
 *
 * @param choices 選択肢
 * @param current 今の版 (なければ undefined)
 * @returns 選択肢
 */
export function withCurrentVersion(
  choices: readonly VersionChoice[],
  current: string | undefined,
): readonly VersionChoice[] {
  if (current === undefined || choices.some((choice) => choice.version === current)) {
    return choices;
  }
  return [{ version: current, label: current }, ...choices];
}
