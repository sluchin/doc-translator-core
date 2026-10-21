/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useMemo, useState } from "react";
import type { LogLevel } from "../lib/log";
import { filterLog, localTime, type LogEntry, parseLog } from "../lib/logView";
import * as api from "./api";

/** 絞り込みの選択肢. */
const LEVELS: readonly { level: LogLevel; label: string }[] = [
  { level: "error", label: "エラー" },
  { level: "warn", label: "警告以上" },
  { level: "info", label: "情報以上" },
  { level: "debug", label: "全部" },
];

/**
 * ログファイルを読んで, 1 件ずつに分ける.
 *
 * @returns ログ (古い順) と, 読めなかったときの説明
 */
async function readEntries(): Promise<{ entries: LogEntry[]; error?: string }> {
  try {
    return { entries: parseLog(await api.readLog()) };
  } catch (e) {
    return { entries: [], error: `読めませんでした: ${String(e)}` };
  }
}

/** ログの画面の引数. */
interface Props {
  /** 閉じる. */
  onClose: () => void;
}

/**
 * アプリのログ (ログファイル) を見る画面. 新しい順に出す. 重大度で絞り込み, 書き出し, 消せる.
 *
 * @param props 引数
 * @returns 画面
 */
export function LogDialog({ onClose }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>();
  const [minimum, setMinimum] = useState<LogLevel>("info");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const show = (read: { entries: LogEntry[]; error?: string }) => {
    setEntries(read.entries);
    setMessage(read.error);
  };
  const load = async () => show(await readEntries());

  useEffect(() => {
    void readEntries().then(show);
  }, []);

  const shown = useMemo(
    () => (entries ? filterLog(entries, minimum).reverse() : []),
    [entries, minimum],
  );

  const exportLog = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const exported = await api.exportLog();
      setMessage(
        exported === "saved"
          ? "書き出しました。"
          : exported === "shared"
            ? "Google Drive を開きました。保存先のフォルダを選んで、保存してください。"
            : undefined,
      );
    } catch (e) {
      setMessage(`失敗しました: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setConfirming(false);
    setMessage(undefined);
    try {
      await api.clearLog();
      const read = await readEntries();
      show({ entries: read.entries, error: read.error ?? "消しました。" });
    } catch (e) {
      setMessage(`失敗しました: ${String(e)}`);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="log-title">
      <div className="dialog log-dialog">
        <h2 id="log-title">ログ</h2>
        <div className="log-tools">
          <select
            value={minimum}
            aria-label="表示する重大度"
            onChange={(event) => setMinimum(event.target.value as LogLevel)}
          >
            {LEVELS.map(({ level, label }) => (
              <option key={level} value={level}>
                {label}
              </option>
            ))}
          </select>
          <button onClick={() => void load()}>再読み込み</button>
        </div>
        <p className="hint">新しい順。API キーなどの秘密は書いていません。</p>
        {entries === undefined ? (
          <p className="hint">読んでいます…</p>
        ) : shown.length === 0 ? (
          <p className="hint">ログはありません。</p>
        ) : (
          <ol className="log-list">
            {shown.map((entry, index) => (
              <li key={index} className={`log-${entry.level}`}>
                <div className="log-head">
                  {localTime(entry.time)} {entry.level.toUpperCase()} {entry.target}
                </div>
                <pre>{entry.message}</pre>
              </li>
            ))}
          </ol>
        )}
        {message && (
          <p className="hint" role="status">
            {message}
          </p>
        )}
        <div className="actions">
          {confirming ? (
            <>
              <button onClick={() => void clear()}>本当に消す</button>
              <button onClick={() => setConfirming(false)}>やめる</button>
            </>
          ) : (
            <button onClick={() => setConfirming(true)}>消す</button>
          )}
          <button onClick={() => void exportLog()} disabled={busy}>
            書き出す
          </button>
          <button onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
