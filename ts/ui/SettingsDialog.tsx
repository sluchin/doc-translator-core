/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "react";
import * as api from "./api";
import { LogDialog } from "./LogDialog";

/** 無料の Google 翻訳に、同時に送る依頼の数の選択肢 (Rust の `free::MAX_PARALLEL` までの数). */
const PARALLEL_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];

/** 設定の画面の引数. */
interface Props {
  /** 閉じる. */
  onClose: () => void;
  /** 設定を保存したときに呼ぶ. */
  onSaved: () => void;
}

/**
 * 翻訳サービス (無料の Google 翻訳, Google Cloud Translation, Gemini, ML Kit) と、API キーを設定する画面.
 *
 * @param props 引数
 * @returns 画面
 */
export function SettingsDialog({ onClose, onSaved }: Props) {
  const [view, setView] = useState<api.SettingsView>();
  const [provider, setProvider] = useState<api.Provider>("googlefree");
  const [googleKey, setGoogleKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [model, setModel] = useState("");
  const [parallel, setParallel] = useState(4);
  const [message, setMessage] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string>();
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    void api.getSettings().then((loaded) => {
      setView(loaded);
      setProvider(loaded.provider);
      setModel(loaded.geminiModel);
      setParallel(loaded.freeParallel);
    });
  }, []);

  const save = async (clear?: "google" | "gemini") => {
    setNotice(undefined);
    try {
      const saved = await api.setSettings({
        provider,
        googleKey: clear === "google" ? "" : googleKey || undefined,
        geminiKey: clear === "gemini" ? "" : geminiKey || undefined,
        geminiModel: model,
        freeParallel: parallel,
      });
      setView(saved);
      setGoogleKey("");
      setGeminiKey("");
      setMessage(undefined);
      setNotice(clear === undefined ? "保存しました。" : "キーを消しました。");
      onSaved();
    } catch (e) {
      setMessage(String(e));
    }
  };

  const [cacheMessage, setCacheMessage] = useState<string>();
  const [moving, setMoving] = useState(false);

  /** キャッシュを書き出す、または、読み込む (画面を開いている間は、ボタンを押せない). */
  const moveCache = async (kind: "export" | "import") => {
    setMoving(true);
    setCacheMessage(undefined);
    try {
      if (kind === "export") {
        const exported = await api.exportCache();
        setCacheMessage(
          exported === "saved"
            ? "書き出しました。"
            : exported === "shared"
              ? "Google Drive を開きました。保存先のフォルダを選んで、保存してください。"
              : undefined,
        );
      } else {
        const added = await api.importCache();
        setCacheMessage(added === null ? undefined : `読み込みました (新しい翻訳 ${added} 件)。`);
        if (added !== null && added > 0) {
          // 開いているページに、読み込んだ翻訳を使う
          onSaved();
        }
      }
    } catch (e) {
      setCacheMessage(`失敗しました: ${String(e)}`);
    } finally {
      setMoving(false);
    }
  };

  const check = async () => {
    setChecking(true);
    setCheckResult(undefined);
    try {
      setCheckResult(`動きました: "Hello, world" → ${await api.checkMlkit()}`);
    } catch (e) {
      setCheckResult(`失敗しました: ${String(e)}`);
    } finally {
      setChecking(false);
    }
  };

  if (!view) {
    return null;
  }
  if (showLog) {
    return <LogDialog onClose={() => setShowLog(false)} />;
  }
  const status = (has: boolean) => (has ? "(設定済み)" : "(未設定)");

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="dialog">
        <h2 id="settings-title">設定</h2>
        <fieldset>
          <legend>翻訳サービス</legend>
          <label className="choice">
            <input
              type="radio"
              checked={provider === "googlefree"}
              onChange={() => setProvider("googlefree")}
            />
            Google 翻訳（無料。キー不要・非公式）
          </label>
          <label className="choice">
            <input
              type="radio"
              checked={provider === "google"}
              onChange={() => setProvider("google")}
            />
            Google Cloud Translation
          </label>
          <label className="choice">
            <input
              type="radio"
              checked={provider === "gemini"}
              onChange={() => setProvider("gemini")}
            />
            Gemini API
          </label>
          <label className="choice">
            <input
              type="radio"
              checked={provider === "mlkit"}
              disabled={!view.mlkitAvailable}
              onChange={() => setProvider("mlkit")}
            />
            ML Kit（端末の中で翻訳。Android のみ）
          </label>
        </fieldset>
        {provider === "google" && (
          <label>
            Google の API キー {status(view.hasGoogleKey)}
            <input
              type="password"
              value={googleKey}
              autoComplete="off"
              placeholder={view.hasGoogleKey ? "変えるときだけ入力" : "AIza..."}
              onChange={(event) => setGoogleKey(event.target.value)}
            />
          </label>
        )}
        {provider === "gemini" && (
          <>
            <label>
              Gemini の API キー {status(view.hasGeminiKey)}
              <input
                type="password"
                value={geminiKey}
                autoComplete="off"
                placeholder={view.hasGeminiKey ? "変えるときだけ入力" : "AIza..."}
                onChange={(event) => setGeminiKey(event.target.value)}
              />
            </label>
            <label>
              モデル
              <input value={model} spellCheck={false} onChange={(e) => setModel(e.target.value)} />
            </label>
          </>
        )}
        {provider === "googlefree" && (
          <p>
            キーは要りません。Google の Web の翻訳と同じ入口を使います（公式の API
            ではありません）。仕様が変わったり、短い時間に多く送ると、断られたりすることがあります。個人が読むために使ってください。文章は、Google
            に送られます。
          </p>
        )}
        {provider === "googlefree" && (
          <label>
            同時に送る数（少ないほど遅く、断られにくい）
            <select value={parallel} onChange={(event) => setParallel(Number(event.target.value))}>
              {PARALLEL_CHOICES.map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
        )}
        {provider === "mlkit" && (
          <p>
            キーは要りません。初めて使うときに、翻訳のモデル（約 30 MB）を取得します。2
            回目からは、通信しないで翻訳します。品質は、クラウドの翻訳より低めです。
          </p>
        )}
        {provider === "mlkit" && (
          <>
            <button onClick={() => void check()} disabled={checking}>
              {checking ? "確認しています (モデルを取得中)…" : "動作を確認する (モデルを取得)"}
            </button>
            {checkResult && <p className="hint">{checkResult}</p>}
          </>
        )}
        <p className="hint">
          キーは、この端末のアプリ専用の場所に保存して、翻訳の依頼だけに使います。
        </p>
        <fieldset>
          <legend>翻訳のキャッシュ</legend>
          <p className="hint">
            書き出したファイルを Google Drive
            などに保存して、別の端末で読み込むと、翻訳を引き継げます（その端末の翻訳に足し合わせます）。
          </p>
          <div className="actions">
            <button onClick={() => void moveCache("export")} disabled={moving}>
              書き出す
            </button>
            <button onClick={() => void moveCache("import")} disabled={moving}>
              読み込む
            </button>
          </div>
          {cacheMessage && (
            <p className="hint" role="status">
              {cacheMessage}
            </p>
          )}
        </fieldset>
        <fieldset>
          <legend>ログ</legend>
          <p className="hint">
            アプリの動き（エラーなど）の記録です。うまく動かないときに見たり、書き出したりできます。
          </p>
          <div className="actions">
            <button onClick={() => setShowLog(true)}>ログを見る</button>
          </div>
        </fieldset>
        {message && <p className="error">{message}</p>}
        {notice && (
          <p className="hint" role="status">
            {notice}
          </p>
        )}
        <div className="actions">
          {provider === "google" && view.hasGoogleKey && (
            <button onClick={() => void save("google")}>キーを消す</button>
          )}
          {provider === "gemini" && view.hasGeminiKey && (
            <button onClick={() => void save("gemini")}>キーを消す</button>
          )}
          <button onClick={() => void save()}>保存</button>
          <button onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
