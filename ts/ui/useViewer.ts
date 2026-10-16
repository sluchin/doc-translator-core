/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { MenuItem, MenuSource, SiteProfile } from "../lib/profile";
import * as api from "./api";
import { hashOf, isDocUrl, tabIndexOf, withoutHash } from "../lib/docUrl";
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
import { parseHtmlMenu } from "../lib/menu";
import {
  type VersionChoice,
  versionFromText,
  versionOf,
  withCurrentVersion,
  withVersion,
} from "../lib/version";
import { type Metrics, type Position, screenPosition, scrollRatio } from "../lib/progress";
import {
  type Bookmark,
  type KeyValue,
  type Saved,
  isBookmarked,
  loadSaved,
  storeSaved,
  toggleBookmark,
  withLast,
  withScroll,
} from "../lib/saved";
import {
  AbortedError,
  GEMINI_LIMITS,
  GOOGLE_LIMITS,
  MLKIT_LIMITS,
  type Progress,
  type TranslateFn,
  type TranslatedPage,
  translatePage,
} from "../lib/translatePage";

/** 表示の言語: 日本語 (翻訳) か、英語 (原文). */
export type Lang = "ja" | "en";

/** 開いたページと、その翻訳. */
interface Entry {
  page: DocPage;
  /** 全部を翻訳したもの. */
  translated?: TranslatedPage;
  /** 翻訳の途中 (上から翻訳した分. 翻訳がまだ終わらないうちに、先に表示する). */
  partial?: TranslatedPage;
}

/** 覚えておくページの数 (多いものから、古い順に捨てる). */
const CACHE_PAGES = 30;

/** 位置を書き込むまでの待ち時間 [ms] (スクロールのたびには、書かない). */
const SAVE_DELAY_MS = 400;

/**
 * 覚えておく先 (端末の `localStorage`. 使えなければ undefined).
 *
 * @returns 保存先
 */
function storage(): KeyValue | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

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
  /** タブの名前 (タブがないサイトでは空). */
  tabs: readonly string[];
  /** 今のページのタブの番号. */
  tab: number;
  /** 今のタブにメニューがあるか. */
  hasMenu: boolean;
  /** タブを切り替える (そのタブで最後に開いたページ. なければ、最初のページ). */
  selectTab: (index: number) => void;
  /** 選べるドキュメントの版 (版のないサイトでは空). */
  versions: readonly VersionChoice[];
  /** 今のページの版 (版のないサイトでは undefined). */
  version?: string;
  /** 版を替える (同じパスの、別の版のページを開く). */
  selectVersion: (version: string) => void;
  /** 今の版のキャッシュで翻訳する関数 (メニューの名前の翻訳に使う). */
  translate: TranslateFn;
  /** 表示している本文のページの URL (フラグメントなし. 取得が終わるまでは、前のページ). */
  docUrl: string;
  /** 開いたときに戻す、読んだ位置 (0 から 1. 覚えていなければ undefined). */
  restore?: number;
  /** 本文のスクロールの状態 (スクロールバーに使う). */
  metrics: Metrics;
  /** 今のページの、読んでいる場所 (何画面目か / 全体で何画面か). */
  position: Position;
  /** 今のページを、どこまで読んだか (0 から 1). */
  scroll: number;
  /** しおり. */
  bookmarks: readonly Bookmark[];
  /** 今のページに、しおりがあるか. */
  bookmarked: boolean;
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
  /** トップのページを開く. */
  home: () => void;
  /** 本文をスクロールした (読んだ位置を、少し待って、覚える). */
  setScroll: (metrics: Metrics) => void;
  /** 今のページのしおりを、付ける (あれば外す). */
  toggleBookmark: () => void;
  /** しおりを外す. */
  removeBookmark: (url: string) => void;
  /** 言語を切り替える. */
  toggleLang: () => void;
  /** 翻訳をやり直す (翻訳サービスや API キーを変えたあとなど. 覚えていた翻訳は、捨てる). */
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
  const storeKey = `doc-translator:${profile.host}`;
  const [initial] = useState(() => {
    const store = storage();
    const saved = loadSaved(store, storeKey);
    const last = saved.last && isDocUrl(saved.last, profile) ? saved.last : profile.homeUrl;
    return { store, saved, start: last };
  });
  const savedRef = useRef<Saved>(initial.saved);
  const [nav, setNav] = useState<Nav>(() => push(EMPTY_NAV, initial.start));
  const [bookmarks, setBookmarks] = useState(initial.saved.bookmarks);
  const [restore, setRestore] = useState<number>();
  const [metrics, setMetrics] = useState<Metrics>({ top: 0, height: 0, view: 0 });
  const latest = useRef<{ url: string; ratio: number }>(undefined);
  const timer = useRef<number>(undefined);
  const [lang, setLang] = useState<Lang>("ja");
  const [entry, setEntry] = useState<Entry>();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState<string>();
  const [needsKey, setNeedsKey] = useState(false);
  const [anchor, setAnchor] = useState("");
  const [htmlMenu, setHtmlMenu] = useState<readonly MenuItem[]>([]);
  // ページから読んだ、版の一覧 (一覧のないページでは、前の一覧のまま)
  const [versionList, setVersionList] = useState<readonly VersionChoice[]>([]);
  // 別のファイルから読んだメニュー (ファイルの URL ごと)
  const [fileMenus, setFileMenus] = useState<Record<string, readonly MenuItem[]>>({});
  // タブごとに、最後に開いたページ
  const tabUrls = useRef<Record<number, string>>({});
  const cache = useRef(new Map<string, Entry>());
  const loaded = entry !== undefined;
  const docUrl = entry?.page.url ?? withoutHash(initial.start);

  const persist = useCallback(
    (next: Saved) => {
      savedRef.current = next;
      storeSaved(initial.store, storeKey, next);
    },
    [initial.store, storeKey],
  );

  /** 待っている位置を、すぐに書き込む. */
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const pending = latest.current;
    if (pending) {
      latest.current = undefined;
      persist(withScroll(savedRef.current, pending.url, pending.ratio));
    }
  }, [persist]);
  const job = useRef({ aborted: false });

  // URL に版がないサイトの、今の版 (起動のときに 1 回だけ読む. 読めなければ undefined)
  const autoVersion = useRef<Promise<string | undefined>>(undefined);
  const [autoVersionValue, setAutoVersionValue] = useState<string>();
  const loadAutoVersion = useCallback((): Promise<string | undefined> => {
    const source = profile.versionSource;
    if (source === undefined) {
      return Promise.resolve(undefined);
    }
    autoVersion.current ??= api
      .fetchPage(source.url)
      .then((text) => versionFromText(text, source.pattern))
      .catch(() => undefined);
    return autoVersion.current;
  }, [profile]);

  useEffect(() => {
    void loadAutoVersion().then(setAutoVersionValue);
  }, [loadAutoVersion]);

  useEffect(() => {
    const list = profile.versions?.list;
    if (list === undefined) {
      return;
    }
    // 版の一覧のファイルを取得する (失敗しても、今の版だけが出る)
    api
      .fetchPage(list.url)
      .then((text) => setVersionList(list.parse(text)))
      .catch(() => undefined);
  }, [profile]);

  const show = useCallback(
    async (url: string, language: Lang) => {
      job.current.aborted = true;
      const signal = { aborted: false };
      job.current = signal;
      const key = withoutHash(url);
      flush();
      persist(withLast(savedRef.current, key));
      setRestore(hashOf(url) ? undefined : savedRef.current.scroll[key]);
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
        if (found.page.versions.length > 0) {
          setVersionList(found.page.versions);
        }
        setLoading(false);
        if (language === "ja" && !found.translated && profile.japanese !== true) {
          found.partial = undefined;
          // 1 つずつ翻訳する (ML Kit と無料の Google 翻訳) ときは、小さい単位で依頼して、経過をこまめに進める
          const { provider } = await api.getSettings();
          // クラウドの翻訳は、いくつか同時に送る (速くなる). 無料の Google 翻訳は、断られないよう、1 つずつ
          const limits =
            provider === "google"
              ? GOOGLE_LIMITS
              : provider === "gemini"
                ? GEMINI_LIMITS
                : MLKIT_LIMITS;
          // 版のあるサイトは、版ごとに、別のキャッシュにする (URL に版がないサイトは、読み取った今の版)
          const scope = profile.versions
            ? versionOf(key, profile.versions.pattern)
            : await loadAutoVersion();
          const translated = await translatePage(
            found.page,
            (texts) => api.translate(texts, scope),
            // 別のページに移ったあとは、前のページの経過を出さない
            (next) => !signal.aborted && setProgress(next),
            signal,
            limits,
            (partial) => {
              // 先に翻訳した上のほうから、表示する
              if (!signal.aborted) {
                found.partial = partial;
                setEntry({ ...found });
              }
            },
            (texts) => api.lookupCache(texts, scope),
          );
          found.translated = translated;
          found.partial = undefined;
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
    [profile, flush, persist, loadAutoVersion],
  );

  useEffect(() => {
    // 起動したときに、前回読んだページ (なければ、トップ) を取得して翻訳する (外部への通信を始める処理)
    void show(initial.start, "ja");
  }, [show, initial.start]);

  useEffect(() => {
    // 画面が隠れたとき (アプリが裏に回ったとき) は、すぐに、読んだ位置を書き込む
    const hide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", flush);
    };
  }, [flush]);

  const url = current(nav) ?? profile.homeUrl;
  const versionPattern = profile.versions?.pattern;
  const version = versionPattern ? versionOf(url, versionPattern) : undefined;
  const tabs = profile.tabs ?? [];
  const tab = tabIndexOf(url, tabs, versionPattern);
  const source: MenuSource | undefined = tabs.length > 0 ? tabs[tab]?.menu : profile.menu;
  // 版のあるサイトは、今の版のメニューのファイルを読む (メニューのリンクも、今の版になる)
  const sourceUrl =
    source && source.type !== "html"
      ? versionPattern && version !== undefined
        ? withVersion(source.url, versionPattern, version)
        : source.url
      : undefined;

  useEffect(() => {
    if (
      source === undefined ||
      source.type === "html" ||
      sourceUrl === undefined ||
      fileMenus[sourceUrl] !== undefined
    ) {
      return;
    }
    // メニューのファイルを取得する (失敗しても、メニューが出ないだけ)
    const url = sourceUrl;
    const fetched =
      source.type === "json"
        ? api.fetchJson(url).then((text) => source.parse(JSON.parse(text) as unknown, url))
        : api.fetchPage(url).then((text) => {
            const root = new DOMParser()
              .parseFromString(text, "text/html")
              .querySelector(source.selector);
            return root ? parseHtmlMenu(root, url, source.list) : [];
          });
    fetched
      .then((items) => setFileMenus((menus) => ({ ...menus, [url]: items })))
      .catch(() => undefined);
    // source は、プロファイルの定数. ファイルの URL が変わったときだけ、取得する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUrl]);

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

  const setScroll = useCallback(
    (next: Metrics) => {
      setMetrics(next);
      if (!loaded) {
        // 本文を読み込む前は、位置を上書きしない (前回の位置を、これから戻すため)
        return;
      }
      const ratio = scrollRatio(next.top, next.height, next.view);
      if (latest.current && latest.current.url !== docUrl) {
        flush();
      }
      latest.current = { url: docUrl, ratio };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [docUrl, flush, loaded],
  );

  const translation = lang === "ja" ? (entry?.translated ?? entry?.partial) : undefined;
  const title = (lang === "ja" && translation?.title) || entry?.page.title || url;
  const changeBookmarks = (next: readonly Bookmark[]) => {
    persist({ ...savedRef.current, bookmarks: next });
    setBookmarks(next);
  };
  const menu = sourceUrl !== undefined ? (fileMenus[sourceUrl] ?? []) : htmlMenu;
  const scopeHere = version ?? autoVersionValue;
  const translateHere = useCallback<TranslateFn>(
    (texts) => api.translate(texts, scopeHere),
    [scopeHere],
  );

  useEffect(() => {
    // タブごとに、最後に開いたページを覚える (タブを切り替えて、戻ったとき)
    tabUrls.current[tab] = url;
  }, [tab, url]);

  return {
    title: (translation ? translation.title : entry?.page.title) ?? "",
    html: (translation ? translation.html : entry?.page.html) ?? "",
    url,
    lang,
    loading,
    progress,
    error,
    needsKey,
    kept: translation?.kept ?? 0,
    anchor,
    menu,
    tabs: tabs.map((t) => t.label),
    tab,
    hasMenu: source !== undefined,
    versions: versionPattern ? withCurrentVersion(versionList, version) : [],
    version,
    selectVersion: (next) => {
      if (versionPattern && next !== version) {
        open(withVersion(url, versionPattern, next));
      }
    },
    translate: translateHere,
    selectTab: (index) => {
      const target = tabs[index];
      if (target !== undefined && index !== tab) {
        const next = tabUrls.current[index] ?? target.homeUrl;
        // 版のあるサイトは、今の版のまま、タブを切り替える
        open(
          versionPattern && version !== undefined
            ? withVersion(next, versionPattern, version)
            : next,
        );
      }
    },
    docUrl,
    restore,
    metrics,
    position: screenPosition(metrics),
    scroll: scrollRatio(metrics.top, metrics.height, metrics.view),
    bookmarks,
    bookmarked: isBookmarked(bookmarks, withoutHash(url)),
    canBack: canGoBack(nav),
    canForward: canGoForward(nav),
    open,
    goBack: () => move(back(nav)),
    goForward: () => move(forward(nav)),
    home: () => {
      const homeUrl = tabs[tab]?.homeUrl ?? profile.homeUrl;
      // 版のあるサイトは、今の版のトップ
      open(
        versionPattern && version !== undefined
          ? withVersion(homeUrl, versionPattern, version)
          : homeUrl,
      );
    },
    setScroll,
    toggleBookmark: () => changeBookmarks(toggleBookmark(bookmarks, withoutHash(url), title)),
    removeBookmark: (target) => changeBookmarks(bookmarks.filter((b) => b.url !== target)),
    toggleLang,
    retry: () => {
      // 翻訳サービスや API キーを変えたので、覚えていた翻訳を捨てて、今のサービスで翻訳し直す
      // (サービスごとのキャッシュがあるので、前に翻訳した文章は、すぐに出る)
      cache.current.forEach((found) => {
        found.translated = undefined;
        found.partial = undefined;
      });
      void show(current(nav) as string, lang);
    },
  };
}
