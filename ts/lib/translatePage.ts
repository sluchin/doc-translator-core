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

/**
 * 翻訳済みの文章を探す関数 (通信しない. 同じ数を同じ順で返し, 翻訳がない文章は null).
 */
export type LookupFn = (texts: string[]) => Promise<(string | null)[]>;

/** 翻訳済みの文章がない (探さない) ときの {@link LookupFn}. */
export const noLookup: LookupFn = async (texts) => texts.map(() => null);

/** 1 回の翻訳の依頼の大きさの上限 (1 つの文章が超えるときは, それだけで 1 回). */
export interface Limits {
  /** 文章の数. */
  readonly items: number;
  /** 文字数. */
  readonly chars: number;
  /** 同時に送る依頼の数 (既定は 1. 順に 1 つずつ送る). */
  readonly parallel?: number;
}

/** 既定の上限 (クラウドの翻訳サービス). */
export const DEFAULT_LIMITS: Limits = { items: 40, chars: 8000 };

/** Google Cloud Translation の上限 (速く, 断られにくいので, 3 つまで同時に送る). */
export const GOOGLE_LIMITS: Limits = { ...DEFAULT_LIMITS, parallel: 3 };

/** Gemini の上限 (Rust の側でも, 1 つの依頼を分けて同時に送るので, 2 つまで). */
export const GEMINI_LIMITS: Limits = { ...DEFAULT_LIMITS, parallel: 2 };

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
 * 初めに `lookup` で, 翻訳済みの文章 (キャッシュ) を探して, あれば, 先に `onProgress` と `onPartial` に渡す.
 * 翻訳に渡すのは, 残りの文章だけ (やり直したときは, 続きから翻訳する). 探せなかったときは, 全部を翻訳に渡す.
 *
 * 上から順に翻訳し, 1 回の依頼が終わるたびに, そこまでの翻訳を `onPartial` に渡す (まだ翻訳していない
 * 文章は, 英語のまま). 全部が終わるのを待たずに, 先に翻訳した上のほうから読める.
 *
 * @param page 取り出したページ
 * @param translate 翻訳する関数
 * @param onProgress 経過を受け取る関数
 * @param signal 中止の指示 (aborted が true になったら, 次の依頼の前にやめる)
 * @param limits 1 回の依頼の大きさの上限
 * @param onPartial 途中までの翻訳を受け取る関数 (最後の依頼のあとは, 呼ばない. 戻り値が完成した翻訳)
 * @param lookup 翻訳済みの文章を探す関数
 * @returns 翻訳したページ
 * @throws AbortedError 中止されたとき
 */
export async function translatePage(
  page: DocPage,
  translate: TranslateFn,
  onProgress: (progress: Progress) => void = () => undefined,
  signal: { aborted: boolean } = { aborted: false },
  limits: Limits = DEFAULT_LIMITS,
  onPartial: (partial: TranslatedPage) => void = () => undefined,
  lookup: LookupFn = noLookup,
): Promise<TranslatedPage> {
  const container = document.createElement("div");
  container.innerHTML = page.html;
  const segments = collectSegments(container);
  const sources = segments.map(markAtomic);
  const unique = [...new Set([page.title, ...sources])];
  const translations = new Map<string, string>();
  const applied = new Set<number>();
  let kept = 0;

  /** 翻訳が届いた文章を, 本文に差し込む (差し込み済みのものは, 飛ばす). */
  const apply = (): TranslatedPage => {
    segments.forEach((segment, index) => {
      const translated = translations.get(sources[index]);
      if (translated === undefined || applied.has(index)) {
        return;
      }
      applied.add(index);
      if (keepsStructure(sources[index], translated)) {
        segment.innerHTML = sanitize(translated);
      } else {
        kept += 1;
      }
    });
    return {
      // タイトルは, 翻訳が届くまで, 英語のまま (翻訳済みの文章だけを先に表示するとき)
      title: translations.get(page.title) ?? page.title,
      html: sanitize(container.innerHTML),
      kept,
    };
  };

  // 翻訳済みの文章を先に差し込む (探せなくても, 翻訳は続ける)
  const cached = await lookup(unique).catch(() => [] as (string | null)[]);
  unique.forEach((text, at) => {
    const hit = cached[at];
    if (hit !== null && hit !== undefined) {
      translations.set(text, hit);
    }
  });
  const pending = unique.filter((text) => !translations.has(text));
  let done = unique.length - pending.length;
  // 最初の依頼が終わるのを待たずに、経過を出す (翻訳済みの数から. 遅いサービスでも、始まったことが分かる)
  onProgress({ done, total: unique.length });
  if (done > 0 && pending.length > 0) {
    onPartial(apply());
  }

  // 上から順に, `limits.parallel` 個まで, 同時に送る (1 つ終わるたびに, 次を送る)
  const parts = chunk(pending, limits);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (next < parts.length && !failed) {
      if (signal.aborted) {
        throw new AbortedError();
      }
      const part = parts[next];
      next += 1;
      try {
        const results = await translate(part);
        part.forEach((text, at) => translations.set(text, results[at] ?? text));
      } catch (error) {
        // ほかの依頼が終わっても, 途中の翻訳を渡さない (失敗を, そのまま伝える)
        failed = true;
        throw error;
      }
      done += part.length;
      onProgress({ done, total: unique.length });
      if (done < unique.length && !failed) {
        onPartial(apply());
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limits.parallel ?? 1), parts.length) }, worker),
  );

  return apply();
}
