/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./App.css";
import { Doc } from "./Doc";
import { Drawer, type DrawerAction } from "./Drawer";
import { ScrollBar } from "./ScrollBar";
import { SettingsDialog } from "./SettingsDialog";
import { SiteDoc } from "./SiteDoc";
import { isDocUrl, switchedUrl } from "../lib/docUrl";
import { captureErrors, log, setupLog } from "../lib/log";
import { logToBackend } from "./api";
import type { SiteProfile } from "../lib/profile";
import { type Block, syncedTop } from "../lib/syncScroll";
import { blocksOf, useSyncScroll } from "./useSyncScroll";
import { usePullRefresh } from "./usePullRefresh";
import { useViewer } from "./useViewer";
import { PULL_THRESHOLD } from "../lib/pull";

// ログを設定する (開発版はデバッグ以上, リリース版は情報以上. Rust 側のログファイルにも残す)
setupLog(import.meta.env.DEV, logToBackend);
// 予期しないエラーも, ログファイルに残す (あとから, 設定の「ログを見る」で見る)
captureErrors(window);

/**
 * 今のページを, 端末のブラウザ (Chrome など, 既定のブラウザ) で開く (サイトの元の見た目で見るため).
 *
 * @param url ページの URL
 */
function openInBrowser(url: string): void {
  log.info("Opening in the browser");
  openUrl(url).catch((e: unknown) => log.warn("Could not open the browser", e));
}

/** 原文と翻訳を並べられる、画面の幅 (PC など). 狭い画面 (スマホ) では、並べない. */
const WIDE = "(min-width: 900px)";

/** サイトの見た目で表示するかを覚えておく、端末の保存のキー. */
const SITE_LOOK_KEY = "doc-translator:site-look";

/** 原文を並べるかを覚えておく、端末の保存のキー. */
const SIDE_BY_SIDE_KEY = "doc-translator:side-by-side";

/** 原文の側の本文は、読んだ位置を覚えない (翻訳の側が覚える). */
const ignoreScroll = () => undefined;

/**
 * 画面が広いか (メディアクエリに合うか) を返す. 画面の幅が変わったら、更新する.
 *
 * @param query メディアクエリ
 * @returns 合えば true
 */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const changed = () => setMatches(list.matches);
    list.addEventListener("change", changed);
    return () => list.removeEventListener("change", changed);
  }, [query]);
  return matches;
}

/**
 * 原文を並べるかを、端末から読む (読めなければ、並べない).
 *
 * @returns 並べるなら true
 */
function loadSideBySide(): boolean {
  try {
    return window.localStorage.getItem(SIDE_BY_SIDE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * サイトの見た目で表示するかを、端末から読む (読めなければ、アプリの見た目).
 *
 * @returns サイトの見た目なら true
 */
function loadSiteLook(): boolean {
  try {
    return window.localStorage.getItem(SITE_LOOK_KEY) === "1";
  } catch {
    return false;
  }
}

/** アプリの画面の引数. */
interface Props {
  /** サイトの設定. */
  profile: SiteProfile;
}

/**
 * アプリの画面: ツールバー、進み具合、本文.
 *
 * @param props 引数
 * @returns 画面
 */
export default function App({ profile }: Props) {
  const viewer = useViewer(profile);
  const [settings, setSettings] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const box = useRef<HTMLElement>(null);
  const sourceBox = useRef<HTMLElement>(null);
  // サイトの見た目のときに, 枠 (iframe) の中でスクロールする要素
  const siteBox = useRef<HTMLElement>(null);
  const wide = useMedia(WIDE);
  const [sideBySide, setSideBySide] = useState(loadSideBySide);
  const [siteLookOn, setSiteLookOn] = useState(loadSiteLook);
  // サイトの見た目で表示するのは、ページに、その材料 (囲んでいた要素と CSS) があるときだけ
  const siteLook = siteLookOn && viewer.frame !== undefined && viewer.styles !== undefined;
  // 原文と翻訳を並べるのは、広い画面で、翻訳を表示しているときだけ (サイトの見た目のときは、並べない)
  const split =
    wide && sideBySide && !siteLook && profile.japanese !== true && viewer.lang === "ja";
  useSyncScroll(sourceBox, box, split, viewer.html);
  // 並べる・閉じる前の、翻訳の側の段落の位置 (幅が変わって、折り返しが変わっても、同じ段落に戻すため)
  const beforeSplit = useRef<{ blocks: Block[]; top: number }>(undefined);

  useLayoutEffect(() => {
    const saved = beforeSplit.current;
    const element = box.current;
    beforeSplit.current = undefined;
    if (!saved || !element) {
      return;
    }
    const top = syncedTop(saved.blocks, blocksOf(element), saved.top);
    if (top !== undefined) {
      element.scrollTop = top;
    }
  }, [split]);

  const toggleSideBySide = () => {
    if (box.current) {
      beforeSplit.current = { blocks: blocksOf(box.current), top: box.current.scrollTop };
    }
    const next = !sideBySide;
    setSideBySide(next);
    try {
      window.localStorage.setItem(SIDE_BY_SIDE_KEY, next ? "1" : "0");
    } catch {
      // 覚えられなくても、今の表示は切り替える
    }
  };
  const toggleSiteLook = () => {
    const next = !siteLookOn;
    setSiteLookOn(next);
    try {
      window.localStorage.setItem(SITE_LOOK_KEY, next ? "1" : "0");
    } catch {
      // 覚えられなくても、今の表示は切り替える
    }
  };
  const [address, setAddress] = useState<string>();
  const busy = viewer.loading || viewer.progress !== undefined;
  // 本文を一番上で下に引いて離すと、取り直して、翻訳し直す (取得や翻訳の最中は、引けない)
  const pulled = usePullRefresh(box, viewer.reload, !busy);

  useEffect(() => {
    document.title = viewer.title ? `${viewer.title} - ${profile.name}` : profile.name;
  }, [viewer.title, profile.name]);

  // 表示の切り替えは, メニュー (ナビゲーションドロワー) に置く (ツールバーを狭い画面に収めるため)
  const actions: DrawerAction[] = [
    {
      // 切り替えのボタン (入っているときは, 押した見た目にする)
      label: "サイト風",
      pressed: siteLookOn,
      title: siteLookOn
        ? "アプリのシンプルな表示に戻します"
        : "サイトの CSS で表示します。見出し、コード、表などが、サイトと同じ見た目になります",
      onClick: toggleSiteLook,
    },
  ];
  if (profile.japanese !== true) {
    actions.push(
      {
        label: "原文",
        pressed: viewer.lang !== "ja",
        title: viewer.lang === "ja" ? "英語の原文を表示します" : "日本語に翻訳して表示します",
        onClick: viewer.toggleLang,
      },
      { label: "⚙", ariaLabel: "設定", onClick: () => setSettings(true) },
    );
  }

  const submit = () => {
    const value = (address ?? viewer.url).trim();
    if (isDocUrl(value, profile)) {
      viewer.open(value);
      setAddress(undefined);
    }
  };

  return (
    <div className="app">
      <header className="toolbar">
        <button onClick={() => setDrawer(true)} aria-label="メニュー">
          ☰
        </button>
        <button onClick={viewer.goBack} disabled={!viewer.canBack} aria-label="戻る">
          ←
        </button>
        <button onClick={viewer.goForward} disabled={!viewer.canForward} aria-label="進む">
          →
        </button>
        <button onClick={viewer.home} aria-label="トップ">
          ⌂
        </button>
        <button
          onClick={viewer.toggleBookmark}
          aria-pressed={viewer.bookmarked}
          aria-label="しおり"
        >
          {viewer.bookmarked ? "★" : "☆"}
        </button>
        <input
          className="address"
          value={address ?? viewer.url}
          aria-label="URL"
          spellCheck={false}
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && submit()}
          onBlur={() => setAddress(undefined)}
        />
        <button
          onClick={viewer.reload}
          disabled={busy}
          aria-label={profile.japanese === true ? "更新" : "翻訳し直す"}
          title={
            profile.japanese === true
              ? "ページを取り直す"
              : "ページを取り直して、翻訳し直す (翻訳のキャッシュも使わない)"
          }
        >
          ⟳
        </button>
        <button
          onClick={() => openInBrowser(viewer.url)}
          aria-label="Chrome で開く"
          title="Chrome (既定のブラウザ) で開く"
        >
          ↗
        </button>
        {viewer.versions.length > 0 && (
          <select
            className="version"
            aria-label="版"
            value={viewer.version}
            onChange={(event) => viewer.selectVersion(event.target.value)}
          >
            {viewer.versions.map((choice) => (
              <option key={choice.version} value={choice.version}>
                {choice.label}
              </option>
            ))}
          </select>
        )}
        {profile.alt && (
          <button onClick={() => viewer.open(switchedUrl(viewer.url, profile))}>
            {new URL(viewer.url).hostname === profile.alt.host
              ? profile.alt.backLabel
              : profile.alt.toLabel}
          </button>
        )}
        {profile.japanese !== true && wide && (
          <button onClick={toggleSideBySide}>{sideBySide ? "原文を閉じる" : "原文を並べる"}</button>
        )}
      </header>
      {(viewer.loading || viewer.progress) && (
        <div className="status" role="status">
          {viewer.loading
            ? "取得しています…"
            : `翻訳しています… ${viewer.progress?.done} / ${viewer.progress?.total}`}
          <progress
            value={viewer.progress?.done ?? undefined}
            max={viewer.progress?.total ?? undefined}
          />
          <button onClick={viewer.cancel}>中止</button>
        </div>
      )}
      {pulled > 0 && (
        <div className="pull" style={{ height: pulled }} aria-hidden="true">
          {pulled >= PULL_THRESHOLD
            ? "離すと更新します"
            : profile.japanese === true
              ? "↓ 引いて更新"
              : "↓ 引いて翻訳し直す"}
        </div>
      )}
      {viewer.needsKey && (
        <div className="banner">
          翻訳サービスの API キーが要ります。
          <button onClick={() => setSettings(true)}>設定を開く</button>
        </div>
      )}
      {viewer.error && (
        <div className="banner error" role="alert">
          {viewer.error}
          <button onClick={viewer.retry}>やり直す</button>
        </div>
      )}
      {viewer.kept > 0 && (
        <div className="banner note">構造が崩れる文章 {viewer.kept} 件は、英語のままです。</div>
      )}
      <div className={`content-wrap${split ? " split" : ""}`}>
        {split && (
          <main className="content source" ref={sourceBox} lang="en" aria-label="原文">
            <Doc
              site={profile}
              url={viewer.url}
              docUrl={viewer.docUrl}
              restore={viewer.restore}
              onScroll={ignoreScroll}
              html={viewer.sourceHtml}
              anchor={viewer.anchor}
              onOpen={viewer.open}
            />
          </main>
        )}
        <main className={`content${siteLook ? " site-look" : ""}`} ref={box}>
          {siteLook && viewer.frame && viewer.styles ? (
            <SiteDoc
              site={profile}
              url={viewer.url}
              frame={viewer.frame}
              styles={viewer.styles}
              html={viewer.html}
              anchor={viewer.anchor}
              onOpen={viewer.open}
              onScroll={viewer.setScroll}
              scrollerRef={siteBox}
            />
          ) : (
            <Doc
              site={profile}
              url={viewer.url}
              docUrl={viewer.docUrl}
              restore={viewer.restore}
              onScroll={viewer.setScroll}
              html={viewer.html}
              anchor={viewer.anchor}
              onOpen={viewer.open}
            />
          )}
        </main>
        <ScrollBar
          box={siteLook ? siteBox : box}
          metrics={viewer.metrics}
          position={viewer.position}
          ratio={viewer.scroll}
        />
      </div>
      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        menu={viewer.menu}
        hasMenu={viewer.hasMenu}
        actions={actions}
        docs={viewer.tabs}
        doc={viewer.tab}
        onSelectDoc={viewer.selectTab}
        currentUrl={viewer.url}
        lang={profile.japanese === true ? "en" : viewer.lang}
        bookmarks={viewer.bookmarks}
        onRemoveBookmark={viewer.removeBookmark}
        onOpen={viewer.open}
        translate={viewer.translate}
      />
      {settings && <SettingsDialog onClose={() => setSettings(false)} onSaved={viewer.retry} />}
    </div>
  );
}
