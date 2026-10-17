/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * 書き出すファイルの名前に入れる日時 (端末の時刻. 例: `20261017-1530`).
 *
 * Google Drive は, 同じ名前でも上書きしないので, 名前に日時を入れて, どれが新しいか分かるようにする.
 *
 * @param date 日時
 * @returns 日時の文字列 (年月日と, 時分)
 */
export function exportStamp(date: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}` +
    `-${two(date.getHours())}${two(date.getMinutes())}`
  );
}
