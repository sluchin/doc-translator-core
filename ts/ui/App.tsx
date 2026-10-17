/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef, useState } from "react";
import "./App.css";
import { Doc } from "./Doc";
import { Drawer } from "./Drawer";
import { ScrollBar } from "./ScrollBar";
import { SettingsDialog } from "./SettingsDialog";
import { isDocUrl, switchedUrl } from "../lib/docUrl";
import type { SiteProfile } from "../lib/profile";
import { useSyncScroll } from "./useSyncScroll";
import { useViewer } from "./useViewer";

/** 原文と翻訳を並べられる、画面の幅 (PC など). 狭い画面 (スマホ) では、並べない. */
const WIDE = "(min-width: 900px)";

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
  const wide = useMedia(WIDE);
  const [sideBySide, setSideBySide] = useState(loadSideBySide);
  // 原文と翻訳を並べるのは、広い画面で、翻訳を表示しているときだけ
  const split = wide && sideBySide && profile.japanese !== true && viewer.lang === "ja";
  useSyncScroll(sourceBox, box, split, viewer.html);

  const toggleSideBySide = () => {
    const next = !sideBySide;
    setSideBySide(next);
    try {
      window.localStorage.setItem(SIDE_BY_SIDE_KEY, next ? "1" : "0");
    } catch {
      // 覚えられなくても、今の表示は切り替える
    }
  };
  const [address, setAddress] = useState<string>();

  useEffect(() => {
    document.title = viewer.title ? `${viewer.title} - ${profile.name}` : profile.name;
  }, [viewer.title, profile.name]);

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
        {viewer.hasMenu && (
          <button onClick={() => setDrawer(true)} aria-label="メニュー">
            ☰
          </button>
        )}
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
          <button onClick={toggleSideBySide} aria-pressed={sideBySide}>
            {sideBySide ? "原文を閉じる" : "原文を並べる"}
          </button>
        )}
        {profile.japanese !== true && (
          <button onClick={viewer.toggleLang} aria-pressed={viewer.lang === "ja"}>
            {viewer.lang === "ja" ? "原文に戻す" : "日本語に翻訳"}
          </button>
        )}
        {profile.japanese !== true && (
          <button onClick={() => setSettings(true)} aria-label="設定">
            ⚙
          </button>
        )}
      </header>
      {viewer.tabs.length > 0 && (
        <nav className="tabs" role="tablist" aria-label="ドキュメント">
          {viewer.tabs.map((label, index) => (
            <button
              key={label}
              role="tab"
              aria-selected={index === viewer.tab}
              onClick={() => viewer.selectTab(index)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      {(viewer.loading || viewer.progress) && (
        <div className="status" role="status">
          {viewer.loading
            ? "取得しています…"
            : `翻訳しています… ${viewer.progress?.done} / ${viewer.progress?.total}`}
          <progress
            value={viewer.progress?.done ?? undefined}
            max={viewer.progress?.total ?? undefined}
          />
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
        <main className="content" ref={box}>
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
        </main>
        <ScrollBar
          box={box}
          metrics={viewer.metrics}
          position={viewer.position}
          ratio={viewer.scroll}
        />
      </div>
      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        menu={viewer.menu}
        currentUrl={viewer.url}
        lang={profile.japanese === true ? "en" : viewer.lang}
        bookmarks={viewer.bookmarks}
        onRemoveBookmark={viewer.removeBookmark}
        onHome={viewer.home}
        onOpen={viewer.open}
        translate={viewer.translate}
      />
      {settings && <SettingsDialog onClose={() => setSettings(false)} onSaved={viewer.retry} />}
    </div>
  );
}
