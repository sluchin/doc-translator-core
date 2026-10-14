/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { MenuItem, SiteProfile } from "../lib/profile";
import * as api from "./api";
import { hashOf, withoutHash } from "../lib/docUrl";
import { type DocPage, extractPage } from "../lib/extract";
import {
  EMPTY_NAV,
  type Nav,
  back,
  canGoBack,
  canGoForward,
  current,
  forward,
  push,
} from "../lib/history";
import {
  AbortedError,
  type Progress,
  type TranslatedPage,
  translatePage,
} from "../lib/translatePage";

/** 表示の言語: 日本語 (翻訳) か、英語 (原文). */
export type Lang = "ja" | "en";

/** 開いたページと、その翻訳. */
interface Entry {
  page: DocPage;
  translated?: TranslatedPage;
}

/** 覚えておくページの数 (多いものから、古い順に捨てる). */
const CACHE_PAGES = 30;

/** 画面に出す、ビューアの状態と操作. */
export interface Viewer {
  /** 表示するタイトル. */
  title: string;
  /** 表示する本文の HTML. */
  html: string;
  /** 今のページの URL. */
  url: string;
  /** 表示の言語. */
  lang: Lang;
  /** 取得中か. */
  loading: boolean;
  /** 翻訳の経過 (翻訳中でなければ undefined). */
  progress?: Progress;
  /** エラーのメッセージ. */
  error?: string;
  /** API キーがなくて、翻訳できなかったか. */
  needsKey: boolean;
  /** 英語のまま残した文章の数. */
  kept: number;
  /** 表示してから,移動するフラグメント (#以降の名前). */
  anchor: string;
  /** メニュー (目次). */
  menu: readonly MenuItem[];
  /** 戻れるか. */
  canBack: boolean;
  /** 進めるか. */
  canForward: boolean;
  /** ページを開く. */
  open: (url: string) => void;
  /** 戻る. */
  goBack: () => void;
  /** 進む. */
  goForward: () => void;
  /** 言語を切り替える. */
  toggleLang: () => void;
  /** 翻訳をやり直す (API キーを設定したあとなど). */
  retry: () => void;
}

/**
 * ドキュメントを開いて、翻訳して表示する、状態と操作.
 *
 * ページを開いたとき (リンクのクリック) に、取得して,翻訳する. 開いたページは覚えておき、
 * 戻ったり,原文に切り替えたりするときは、取り直さない.
 *
 * @param profile サイトの設定
 * @returns ビューア
 */
export function useViewer(profile: SiteProfile): Viewer {
  const [nav, setNav] = useState<Nav>(() => push(EMPTY_NAV, profile.homeUrl));
  const [lang, setLang] = useState<Lang>("ja");
  const [entry, setEntry] = useState<Entry>();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState<string>();
  const [needsKey, setNeedsKey] = useState(false);
  const [anchor, setAnchor] = useState("");
  const [htmlMenu, setHtmlMenu] = useState<readonly MenuItem[]>([]);
  const [jsonMenu, setJsonMenu] = useState<readonly MenuItem[]>([]);
  const cache = useRef(new Map<string, Entry>());
  const job = useRef({ aborted: false });

  const show = useCallback(
    async (url: string, language: Lang) => {
      job.current.aborted = true;
      const signal = { aborted: false };
      job.current = signal;
      const key = withoutHash(url);
      setError(undefined);
      setNeedsKey(false);
      setProgress(undefined);
      setAnchor(hashOf(url));
      try {
        let found = cache.current.get(key);
        if (!found) {
          setLoading(true);
          found = { page: extractPage(await api.fetchPage(key), key, profile) };
          cache.current.set(key, found);
          if (cache.current.size > CACHE_PAGES) {
            cache.current.delete(cache.current.keys().next().value as string);
          }
        }
        setEntry(found);
        if (found.page.menu.length > 0) {
          setHtmlMenu(found.page.menu);
        }
        setLoading(false);
        if (language === "ja" && !found.translated) {
          const translated = await translatePage(found.page, api.translate, setProgress, signal);
          found.translated = translated;
          if (!signal.aborted) {
            setEntry({ ...found });
          }
        }
      } catch (e) {
        if (!(e instanceof AbortedError) && !signal.aborted) {
          const message = String(e);
          if (message.includes(api.NO_API_KEY)) {
            setNeedsKey(true);
          } else {
            setError(message);
          }
        }
      } finally {
        if (!signal.aborted) {
          setLoading(false);
          setProgress(undefined);
        }
      }
    },
    [profile],
  );

  useEffect(() => {
    // 起動したときに、最初のページを取得して翻訳する (外部への通信を始める処理)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void show(profile.homeUrl, "ja");
  }, [show, profile.homeUrl]);

  useEffect(() => {
    const source = profile.menu;
    if (source?.type !== "json") {
      return;
    }
    // メニューの JSON を取得する (失敗しても、メニューが出ないだけ)
    api
      .fetchJson(source.url)
      .then((text) => setJsonMenu(source.parse(JSON.parse(text), source.url)))
      .catch(() => undefined);
  }, [profile]);

  const open = useCallback(
    (url: string) => {
      setNav((n) => push(n, url));
      void show(url, lang);
    },
    [lang, show],
  );

  const move = (target: Nav) => {
    setNav(target);
    void show(current(target) as string, lang);
  };

  const toggleLang = () => {
    const next: Lang = lang === "ja" ? "en" : "ja";
    setLang(next);
    void show(current(nav) as string, next);
  };

  const showTranslation = lang === "ja" && entry?.translated;

  return {
    title: (showTranslation ? entry.translated?.title : entry?.page.title) ?? "",
    html: (showTranslation ? entry.translated?.html : entry?.page.html) ?? "",
    url: current(nav) ?? profile.homeUrl,
    lang,
    loading,
    progress,
    error,
    needsKey,
    kept: showTranslation ? (entry.translated?.kept ?? 0) : 0,
    anchor,
    menu: profile.menu?.type === "json" ? jsonMenu : htmlMenu,
    canBack: canGoBack(nav),
    canForward: canGoForward(nav),
    open,
    goBack: () => move(back(nav)),
    goForward: () => move(forward(nav)),
    toggleLang,
    retry: () => void show(current(nav) as string, lang),
  };
}
