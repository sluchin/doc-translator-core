/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "react";
import "./App.css";
import { Doc } from "./Doc";
import { SettingsDialog } from "./SettingsDialog";
import { isDocUrl } from "../lib/docUrl";
import type { SiteProfile } from "../lib/profile";
import { useViewer } from "./useViewer";

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
        <button onClick={viewer.goBack} disabled={!viewer.canBack} aria-label="戻る">
          ←
        </button>
        <button onClick={viewer.goForward} disabled={!viewer.canForward} aria-label="進む">
          →
        </button>
        <button onClick={() => viewer.open(profile.homeUrl)} aria-label="トップ">
          ⌂
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
        <button onClick={viewer.toggleLang} aria-pressed={viewer.lang === "ja"}>
          {viewer.lang === "ja" ? "原文に戻す" : "日本語に翻訳"}
        </button>
        <button onClick={() => setSettings(true)} aria-label="設定">
          ⚙
        </button>
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
      <main className="content">
        <Doc
          site={profile}
          url={viewer.url}
          html={viewer.html}
          anchor={viewer.anchor}
          onOpen={viewer.open}
        />
      </main>
      {settings && <SettingsDialog onClose={() => setSettings(false)} onSaved={viewer.retry} />}
    </div>
  );
}
