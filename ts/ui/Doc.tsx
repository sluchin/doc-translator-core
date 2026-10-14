/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import { type MouseEvent, useEffect, useRef } from "react";
import { isDocUrl, withoutHash } from "../lib/docUrl";

/** 本文の画面の引数. */
interface Props {
  /** ドキュメントのホスト. */
  host: string;
  /** 今のページの URL. */
  url: string;
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
export function Doc({ host, url, html, anchor, onOpen }: Props) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const target = anchor ? ref.current?.querySelector(`[id="${CSS.escape(anchor)}"]`) : undefined;
    if (target) {
      target.scrollIntoView();
    } else if (ref.current) {
      ref.current.parentElement?.scrollTo({ top: 0 });
    }
  }, [url, html, anchor]);

  const click = (event: MouseEvent<HTMLElement>) => {
    const link = (event.target as Element).closest("a[href]");
    if (!link) {
      return;
    }
    event.preventDefault();
    const href = link.getAttribute("href") as string;
    if (isDocUrl(href, host)) {
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
