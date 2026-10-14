/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import { type MouseEvent, useEffect, useLayoutEffect, useRef } from "react";
import { isDocUrl, withoutHash } from "../lib/docUrl";
import type { SiteProfile } from "../lib/profile";
import { type Metrics, scrollRatio, scrollTopFor } from "../lib/progress";

/** 本文の画面の引数. */
interface Props {
  /** サイトの設定 (ホストと, パスの先頭). */
  site: SiteProfile;
  /** 今のページの URL. */
  url: string;
  /** 表示している本文のページの URL (取得が終わるまでは、前のページ). */
  docUrl: string;
  /** 開いたときに戻す、読んだ位置 (0 から 1). */
  restore?: number;
  /** スクロールしたとき (と、本文の長さが変わったとき) に、スクロールの状態を知らせる. */
  onScroll: (metrics: Metrics) => void;
  /** 表示する本文の HTML (安全にしてある). */
  html: string;
  /** 表示してから、移動するフラグメントの名前. */
  anchor: string;
  /** ドキュメントのリンクを開く. */
  onOpen: (url: string) => void;
}

/**
 * 本文を表示する. リンクのクリックを受けて、ドキュメントの中はアプリで開き、外はブラウザで開く.
 *
 * @param props 引数
 * @returns 本文
 */
export function Doc({ site, url, docUrl, restore, onScroll, html, anchor, onOpen }: Props) {
  const ref = useRef<HTMLElement>(null);
  const shown = useRef("");
  const ratio = useRef(0);

  useLayoutEffect(() => {
    const box = ref.current?.parentElement;
    if (!box) {
      return;
    }
    const target = anchor ? ref.current?.querySelector(`[id="${CSS.escape(anchor)}"]`) : undefined;
    if (target) {
      target.scrollIntoView();
    } else {
      // 別のページなら、覚えていた位置へ. 同じページの翻訳や原文への切り替えなら、読んでいた位置のまま
      const at = shown.current === docUrl ? ratio.current : (restore ?? 0);
      box.scrollTo({ top: scrollTopFor(at, box.scrollHeight, box.clientHeight) });
    }
    shown.current = docUrl;
    ratio.current = scrollRatio(box.scrollTop, box.scrollHeight, box.clientHeight);
    // restore は、ページを開いたときに決まる値. 変わっても、スクロールし直さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docUrl, html, anchor]);

  useEffect(() => {
    const box = ref.current?.parentElement;
    if (!box) {
      return;
    }
    const scrolled = () => {
      ratio.current = scrollRatio(box.scrollTop, box.scrollHeight, box.clientHeight);
      onScroll({ top: box.scrollTop, height: box.scrollHeight, view: box.clientHeight });
    };
    scrolled();
    box.addEventListener("scroll", scrolled, { passive: true });
    // 翻訳や画像で本文の長さが変わったときも、全体の長さを数え直す
    const observer = new ResizeObserver(scrolled);
    observer.observe(box);
    if (ref.current) {
      observer.observe(ref.current);
    }
    return () => {
      box.removeEventListener("scroll", scrolled);
      observer.disconnect();
    };
  }, [onScroll]);

  const click = (event: MouseEvent<HTMLElement>) => {
    const link = (event.target as Element).closest("a[href]");
    if (!link) {
      return;
    }
    event.preventDefault();
    const href = link.getAttribute("href") as string;
    if (isDocUrl(href, site)) {
      if (withoutHash(href) === withoutHash(url)) {
        const id = decodeURIComponent(new URL(href).hash.slice(1));
        ref.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView();
      } else {
        onOpen(href);
      }
    } else if (/^https?:/i.test(href)) {
      void openUrl(href);
    }
  };

  return (
    <article className="doc" ref={ref} onClick={click} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
