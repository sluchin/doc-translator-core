/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";
import { isDocUrl, withoutHash } from "../lib/docUrl";
import { log } from "../lib/log";
import type { SiteProfile } from "../lib/profile";
import {
  type FrameNode,
  type SiteStyles,
  absoluteCssUrls,
  buildSiteDocument,
  cssImports,
  rewriteForSiteLook,
  withBodyClass,
  withMedia,
  withoutImports,
} from "../lib/siteLook";
import { fetchCss } from "./api";

/** `@import` をたどる深さの上限 (輪になっても, 止まる). */
const MAX_IMPORT_DEPTH = 2;

/** 取得した CSS (URL ごと. アプリを開いている間だけ, 覚えておく). */
const cssCache = new Map<string, Promise<string>>();

/**
 * サイトの CSS を取得して, `@import` を前に入れて, URL を絶対 URL にする (取得できなければ, 空).
 *
 * @param url CSS の URL
 * @param depth `@import` をたどった深さ
 * @returns CSS
 */
function loadCss(url: string, depth = 0): Promise<string> {
  const cached = cssCache.get(url);
  if (cached) {
    return cached;
  }
  const loading = fetchCss(url)
    .then(async (css) => {
      const imports =
        depth < MAX_IMPORT_DEPTH
          ? await Promise.all(cssImports(css, url).map((next) => loadCss(next, depth + 1)))
          : [];
      return [...imports, absoluteCssUrls(withoutImports(css), url)].join("\n");
    })
    .catch((e: unknown) => {
      // 別のホストの CSS などは, 取得しない (その分の見た目は, 崩れる)
      log.warn("Could not load the site CSS", e);
      return "";
    });
  cssCache.set(url, loading);
  return loading;
}

/** サイトの見た目で表示する本文の画面の引数. */
interface Props {
  /** サイトの設定 (ホストと, パスの先頭). */
  site: SiteProfile;
  /** 今のページの URL. */
  url: string;
  /** 本文を囲んでいた要素. */
  frame: readonly FrameNode[];
  /** サイトの CSS. */
  styles: SiteStyles;
  /** 表示する本文の HTML (安全にしてある. 翻訳したものか, 原文). */
  html: string;
  /** 表示してから, 移動するフラグメントの名前. */
  anchor: string;
  /** ドキュメントのリンクを開く. */
  onOpen: (url: string) => void;
}

/**
 * 本文を, サイトの見た目 (サイトの CSS と, 本文を囲んでいた要素) で表示する.
 *
 * サイトの CSS がアプリの画面に効かないように, 切り離した枠 (iframe) に表示する. 枠の中では,
 * スクリプトを動かさない (`sandbox` に `allow-scripts` を付けない). リンクのクリックは, 枠の外
 * (アプリ) で受けて, ドキュメントの中はアプリで開き, 外はブラウザで開く.
 *
 * @param props 引数
 * @returns 本文
 */
export function SiteDoc({ site, url, frame, styles, html, anchor, onOpen }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [css, setCss] = useState<{ url: string; text: string }>();

  useEffect(() => {
    let cancelled = false;
    // ページに書かれた順に入れる (後のものが勝つ). 条件 (明るい色と暗い色のテーマなど) は, @media にする
    void Promise.all(
      styles.sheets.map(async (sheet) =>
        withMedia(
          sheet.url ? await loadCss(sheet.url) : absoluteCssUrls(sheet.text, url),
          sheet.media,
        ),
      ),
    ).then((parts) => {
      if (!cancelled) {
        setCss({ url, text: parts.join("\n") });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [styles, url]);

  // サイトの JavaScript が組み直す本文は, 同じ形に組み直す (表示するたびには, 組み直さない)
  const body = useMemo(
    () => rewriteForSiteLook(html, site.siteLookRewrite),
    [html, site.siteLookRewrite],
  );

  const ready = css?.url === url;
  const srcDoc = ready
    ? buildSiteDocument({
        frame: withBodyClass(frame, site.siteLookBodyClass),
        css: css.text,
        html: body,
        url,
      })
    : undefined;

  const loaded = () => {
    const doc = ref.current?.contentDocument;
    if (!doc) {
      return;
    }
    const jump = (id: string) => doc.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView();
    if (anchor) {
      jump(anchor);
    }
    doc.addEventListener("click", (event) => {
      const link = (event.target as Element).closest("a[href]");
      if (!link) {
        return;
      }
      event.preventDefault();
      const href = link.getAttribute("href") as string;
      if (isDocUrl(href, site)) {
        if (withoutHash(href) === withoutHash(url)) {
          jump(decodeURIComponent(new URL(href).hash.slice(1)));
        } else {
          onOpen(href);
        }
      } else if (/^https?:/i.test(href)) {
        void openUrl(href);
      }
    });
  };

  return ready ? (
    <iframe
      ref={ref}
      className="site-doc"
      title="サイトの見た目"
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
      onLoad={loaded}
    />
  ) : (
    <p className="site-doc-loading">サイトの見た目を読み込んでいます…</p>
  );
}
