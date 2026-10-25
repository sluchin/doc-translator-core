/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "react";
import {
  containsCurrent,
  collectTitles,
  isCurrent,
  translateTitles,
  withTitles,
} from "../lib/menu";
import type { MenuItem } from "../lib/profile";
import type { Bookmark } from "../lib/saved";
import type { TranslateFn } from "../lib/translatePage";
import type { Lang } from "./useViewer";

/** メニューに置く, 表示を切り替えるボタン. */
export interface DrawerAction {
  /** ボタンの名前 (短く). */
  label: string;
  /** 読み上げの名前 (名前が記号だけのとき). */
  ariaLabel?: string;
  /** ボタンの説明. */
  title?: string;
  /** 切り替えのボタンなら, 今, 入っているか. */
  pressed?: boolean;
  /** 押したとき (メニューは閉じる). */
  onClick: () => void;
}

/** メニューの画面の引数. */
interface Props {
  /** 開いているか. */
  open: boolean;
  /** 閉じる. */
  onClose: () => void;
  /** メニュー (目次). */
  menu: readonly MenuItem[];
  /** メニュー (目次) があるか (無ければ, 目次のタブを出さない). */
  hasMenu: boolean;
  /** 表示を切り替えるボタン (サイト風, 原文, 設定など). */
  actions: readonly DrawerAction[];
  /** ドキュメントのタブの名前 (同じホストの, 別のドキュメント. 無ければ空). */
  docs: readonly string[];
  /** 選んでいるドキュメントのタブ. */
  doc: number;
  /** ドキュメントのタブを選ぶ. */
  onSelectDoc: (index: number) => void;
  /** 今のページの URL (開いておく項目と、印を付ける項目を決める). */
  currentUrl: string;
  /** 表示の言語 (日本語なら、メニューの名前も翻訳する). */
  lang: Lang;
  /** しおり. */
  bookmarks: readonly Bookmark[];
  /** しおりを外す. */
  onRemoveBookmark: (url: string) => void;
  /** ページを開く. */
  onOpen: (url: string) => void;
  /** メニューの名前を翻訳する関数 (今の版のキャッシュ). */
  translate: TranslateFn;
}

/** 項目の画面の引数. */
interface ItemProps {
  /** 項目. */
  item: MenuItem;
  /** 今のページの URL. */
  currentUrl: string;
  /** ページを開く. */
  onOpen: (url: string) => void;
}

/**
 * メニューの 1 つの項目 (子があれば、開閉できる. 今のページを含む枝は、開いておく).
 *
 * @param props 引数
 * @returns 項目
 */
function Item({ item, currentUrl, onOpen }: ItemProps) {
  const [expanded, setExpanded] = useState(() => containsCurrent(item, currentUrl));
  const { url } = item;
  return (
    <li>
      <div className={`menu-row${isCurrent(item, currentUrl) ? " current" : ""}`}>
        {item.children.length > 0 ? (
          <button
            className="menu-toggle"
            aria-expanded={expanded}
            aria-label={expanded ? "閉じる" : "開く"}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="menu-toggle" />
        )}
        {url ? (
          <button className="menu-link" onClick={() => onOpen(url)}>
            {item.title}
          </button>
        ) : (
          <button
            className="menu-link heading"
            onClick={() => setExpanded(!expanded)}
            disabled={item.children.length === 0}
          >
            {item.title}
          </button>
        )}
      </div>
      {expanded && item.children.length > 0 && (
        <ul>
          {item.children.map((child, index) => (
            <Item
              key={`${child.title}-${index}`}
              item={child}
              currentUrl={currentUrl}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * ナビゲーションドロワー: ドキュメントのメニュー (目次) と, 表示の切り替え (サイト風, 原文, 設定),
 * ドキュメントのタブを、横から出す.
 *
 * ページを進めても、いつでも、☰ のボタンで開ける. 日本語の表示のときは、開いたときに、
 * メニューの名前を翻訳する (翻訳は、キャッシュされる). 項目を押すと、ページを開いて、閉じる.
 *
 * @param props 引数
 * @returns 画面 (閉じているときは、何も出さない)
 */
export function Drawer({
  open,
  onClose,
  menu,
  hasMenu,
  actions,
  docs,
  doc,
  onSelectDoc,
  currentUrl,
  lang,
  bookmarks,
  onRemoveBookmark,
  onOpen,
  translate,
}: Props) {
  const [tab, setTab] = useState<"menu" | "bookmarks">("menu");
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || lang !== "ja") {
      return;
    }
    const missing = collectTitles(menu).filter((title) => !titles.has(title));
    if (missing.length === 0) {
      return;
    }
    let cancelled = false;
    // 翻訳を始める (外部への通信). 失敗したら、英語の名前のままにする
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(true);
    translateTitles(missing, translate)
      .then((map) => !cancelled && setTitles((old) => new Map([...old, ...map])))
      .catch(() => undefined)
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [open, lang, menu, titles, translate]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, onClose]);

  if (!open) {
    return null;
  }
  const shown = lang === "ja" ? withTitles(menu, titles) : menu;
  const choose = (url: string) => {
    onOpen(url);
    onClose();
  };
  const act = (action: DrawerAction) => {
    action.onClick();
    onClose();
  };
  const selectDoc = (index: number) => {
    onSelectDoc(index);
    onClose();
  };
  // 目次が無ければ, しおりを出す
  const shownTab = hasMenu ? tab : "bookmarks";

  return (
    <div className="drawer-layer">
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="メニュー">
        <div className="drawer-head">
          <strong>メニュー</strong>
          {busy && <span className="drawer-busy">翻訳しています…</span>}
          <button onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        {actions.length > 0 && (
          <div className="drawer-actions">
            {actions.map((action) => (
              <button
                key={action.label}
                aria-label={action.ariaLabel}
                aria-pressed={action.pressed}
                title={action.title}
                onClick={() => act(action)}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
        {docs.length > 0 && (
          <div className="drawer-docs" role="tablist" aria-label="ドキュメント">
            {docs.map((label, index) => (
              <button
                key={label}
                role="tab"
                aria-selected={index === doc}
                onClick={() => selectDoc(index)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="drawer-tabs" role="tablist">
          {hasMenu && (
            <button role="tab" aria-selected={tab === "menu"} onClick={() => setTab("menu")}>
              目次
            </button>
          )}
          <button
            role="tab"
            aria-selected={shownTab === "bookmarks"}
            onClick={() => setTab("bookmarks")}
          >
            しおり ({bookmarks.length})
          </button>
        </div>
        {shownTab === "bookmarks" ? (
          bookmarks.length === 0 ? (
            <p className="drawer-empty">しおりはありません。ツールバーの ☆ で付けられます。</p>
          ) : (
            <ul className="bookmarks">
              {bookmarks.map((b) => (
                <li key={b.url} className="menu-row">
                  <button className="menu-link" onClick={() => choose(b.url)}>
                    {b.title}
                  </button>
                  <button
                    className="menu-toggle"
                    aria-label="しおりを外す"
                    onClick={() => onRemoveBookmark(b.url)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : shown.length === 0 ? (
          <p className="drawer-empty">メニューを読み込んでいます…</p>
        ) : (
          <nav>
            <ul>
              {shown.map((item, index) => (
                <Item
                  key={`${item.title}-${index}`}
                  item={item}
                  currentUrl={currentUrl}
                  onOpen={choose}
                />
              ))}
            </ul>
          </nav>
        )}
      </aside>
    </div>
  );
}
