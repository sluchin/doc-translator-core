/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { DocPage } from "./extract";
import { sanitize } from "./sanitize";
import { collectSegments, keepsStructure, markAtomic } from "./segments";

/** 文章を翻訳する関数 (HTML の断片の一覧を受け取り, 同じ数の翻訳を同じ順で返す). */
export type TranslateFn = (texts: string[]) => Promise<string[]>;

/** 1 回の翻訳の依頼の大きさの上限 (1 つの文章が超えるときは, それだけで 1 回). */
export interface Limits {
  /** 文章の数. */
  readonly items: number;
  /** 文字数. */
  readonly chars: number;
}

/** 既定の上限 (クラウドの翻訳サービス). */
export const DEFAULT_LIMITS: Limits = { items: 40, chars: 8000 };

/** 端末の中で翻訳する (ML Kit) ときの上限. 小さくして、経過が、こまめに進むようにする. */
export const MLKIT_LIMITS: Limits = { items: 10, chars: 2000 };

/** 1 回の翻訳の依頼に入れる, 文章の数の上限 (既定). */
export const MAX_ITEMS = DEFAULT_LIMITS.items;

/** 1 回の翻訳の依頼に入れる, 文字数の上限 (既定). */
export const MAX_CHARS = DEFAULT_LIMITS.chars;

/** 翻訳をやめるときに投げる例外. */
export class AbortedError extends Error {
  /** 作る. */
  constructor() {
    super("Translation was aborted");
    this.name = "AbortedError";
  }
}

/** 翻訳の経過. */
export interface Progress {
  /** 翻訳が終わった文章の数. */
  done: number;
  /** 翻訳する文章の数. */
  total: number;
}

/** 翻訳したページ. */
export interface TranslatedPage {
  /** 翻訳したタイトル. */
  readonly title: string;
  /** 翻訳した本文の HTML (安全にしてある). */
  readonly html: string;
  /** 元の構造が崩れたので, 英語のまま残した文章の数. */
  readonly kept: number;
}

/**
 * 文章を, 1 回の依頼に入る大きさに分ける.
 *
 * @param texts 文章
 * @param limits 1 回の大きさの上限
 * @returns 分けた文章 (順は変えない)
 */
export function chunk(texts: string[], limits: Limits = DEFAULT_LIMITS): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const text of texts) {
    if (
      current.length > 0 &&
      (current.length >= limits.items || chars + text.length > limits.chars)
    ) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(text);
    chars += text.length;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

/**
 * ページを翻訳する.
 *
 * 段落などの単位ごとに, 文中のコードに「翻訳しない」印を付けて翻訳に渡す. 同じ文章は 1 回だけ
 * 渡す. 翻訳の結果で、コードの印やリンクの数が変わったものは, 英語のまま残す.
 *
 * @param page 取り出したページ
 * @param translate 翻訳する関数
 * @param onProgress 経過を受け取る関数
 * @param signal 中止の指示 (aborted が true になったら, 次の依頼の前にやめる)
 * @param limits 1 回の依頼の大きさの上限
 * @returns 翻訳したページ
 * @throws AbortedError 中止されたとき
 */
export async function translatePage(
  page: DocPage,
  translate: TranslateFn,
  onProgress: (progress: Progress) => void = () => undefined,
  signal: { aborted: boolean } = { aborted: false },
  limits: Limits = DEFAULT_LIMITS,
): Promise<TranslatedPage> {
  const container = document.createElement("div");
  container.innerHTML = page.html;
  const segments = collectSegments(container);
  const sources = segments.map(markAtomic);
  const unique = [...new Set([page.title, ...sources])];
  const translations = new Map<string, string>();
  let done = 0;

  for (const part of chunk(unique, limits)) {
    if (signal.aborted) {
      throw new AbortedError();
    }
    const results = await translate(part);
    part.forEach((text, index) => translations.set(text, results[index] ?? text));
    done += part.length;
    onProgress({ done, total: unique.length });
  }

  let kept = 0;
  segments.forEach((segment, index) => {
    const translated = translations.get(sources[index]) as string;
    if (keepsStructure(sources[index], translated)) {
      segment.innerHTML = sanitize(translated);
    } else {
      kept += 1;
    }
  });

  return {
    title: translations.get(page.title) as string,
    html: sanitize(container.innerHTML),
    kept,
  };
}
