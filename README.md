# doc-translator-core

ドキュメントのサイトを**リンクを開いたときに** 取得して、日本語に翻訳して表示する Tauri アプリ (PC と Android) の、**共通のコード**です。アプリごとに、このリポジトリをサブモジュール (`shared/`) として置きます。

- [zephyr-doc](https://github.com/sluchin/zephyr-doc): Zephyr のドキュメント
- [kotlin-doc](https://github.com/sluchin/kotlin-doc): Kotlin のドキュメント

## 中身

| ディレクトリ                  | 内容                                                                                                                                                                                                                        |
| :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts/lib/`                     | HTML の取り出し (`extract`)、段落の分割 (`segments`)、翻訳の組み立て (`translatePage`)、履歴、URL、サニタイズ。テストあり (行と分岐が 100%)。                                                                               |
| `ts/ui/`                      | React の画面 (`App`、`Doc`、`Drawer` (メニューとしおり)、`SettingsDialog`、`useViewer`、`api`、`App.css`)。                                                                                                                 |
| `rust/`                       | Tauri の Rust 側 (クレート `doc-translator-core`): ページの取得、翻訳 (Google Cloud Translation、Gemini、無料の Google 翻訳 (非公式)、ML Kit の目印の変換)、キャッシュ、設定。テストは `rust/tests/` にソースと分けて置く。 |
| `plugins/tauri-plugin-mlkit/` | ML Kit (Android のオンデバイス翻訳) の Tauri プラグイン (Kotlin)。                                                                                                                                                          |
| `docker/Dockerfile`           | 開発用のイメージ (Node.js、Rust、Android の SDK と NDK)。アプリも、これを使う。                                                                                                                                             |

## アプリの作り方

アプリ (`zephyr-doc` を見本にする) に次のものを置きます。

1. サブモジュール `shared/` (このリポジトリ)。
2. サイトの設定 `src/site.ts` (`SiteProfile`: ホスト、パスの先頭、最初のページ、本文のセレクタ、取り除く要素、タイトルの末尾、メニューの取り方、もう 1 つのサイトへ切り替える `alt` (Rust の `Site` の `alt_host` と同じにする)、サイトが日本語のときの `japanese`: 翻訳せずにそのまま表示する)。
3. `src/main.tsx`: `<App profile={site} />` (`shared/ts/ui/App`) を表示する。
4. `src-tauri/`: `Cargo.toml` に `doc-translator-core` と `tauri-plugin-mlkit` を `../shared/...` のパスで書く。`lib.rs` で `doc_translator_core::builder(Site { host, alt_host, user_agent })` に `tauri_plugin_mlkit::init()` を足して、`run(generate_context!())` する。
5. `tauri.conf.json`: 名前、識別子、CSP (画像はサイトのホストだけ許す)。

ML Kit のプラグインは Android のビルドが**アプリの直接の依存**から見つけるので、アプリの `Cargo.toml` にも、書きます。

## API キーの初期値 (ビルドのときの環境変数)

アプリをビルドするときに、環境変数に API キーが入っていれば、それを設定の初期値にします (`rust/src/settings.rs` の `Settings::with_keys`。Rust の `option_env!` で、ビルドのときに読みます)。

| 環境変数                           | キー                                 |
| :--------------------------------- | :----------------------------------- |
| `GOOGLE_CLOUD_TRANSLATION_API_KEY` | Google Cloud Translation の API キー |
| `GEMINI_API_KEY`                   | Gemini API のキー                    |

```bash
GEMINI_API_KEY=... npm run tauri:build
```

- 初期値になるのは、保存した設定に、キーがないときだけです。設定の画面で入れたキーや、消したキーは、そのままです。
- キーは、アプリの実行ファイルに入ります (取り出せます)。**自分で使うビルドだけで使い、配るビルド (公開するもの、CI の成果物) では、設定しないでください。**
- 環境変数を変えたら、Cargo が、作り直します。

## ログ

- Rust のログは、標準エラー出力と、アプリのデータのディレクトリの `logs/app.log` に出ます (5 MB を超えると世代送りして、3 世代を残します。`rust/src/logging.rs`)。画面 (TypeScript) のログ (`ts/lib/log.ts` の `log`) も、Rust へ送って (`log_frontend_message`)、同じファイルに残します。
- レベル: 開発版 (`npm run tauri:dev`) はデバッグ以上、リリース版は情報 (最低限)、警告、エラーを出します。判定は、ログの初期化の中でします (Rust は `default_level`、TypeScript は `setupLog`)。環境変数 `RUST_LOG` で、Rust のレベルを上書きできます。
- API キーなどの秘密は、ログに書きません。

## ブラウザで開く

ツールバーの ↗ (Chrome で開く) で、今のページを、端末の既定のブラウザ (Android では、ふつうは Chrome) で開きます。アプリは、ページの本文だけを取り出して、翻訳して、アプリの見た目で表示するので、サイトの元の見た目 (Chrome での表示) とは違います。元の見た目で見たいときに使います。

## サイトの見た目で表示する

ツールバーの「サイトの見た目」で、本文をサイトの CSS で表示します (もう一度押すと「アプリの見た目」に戻ります。選んだ方を覚えます)。翻訳しても、文字だけを入れ替えるので、見出し、コード、表などは、サイトと同じ見た目になります。

- ページを取り出すときに、本文を囲んでいた要素 (タグ、id、クラス) と、サイトの CSS (`<link rel="stylesheet">` と `<style>`。書かれた順と、`media` の条件) を残します (`ts/lib/siteLook.ts` の `collectFrame` と `collectStyles`)。
- 表示するときに、CSS を Rust 側で取得し (ページと同じホストのものだけ。`fetch_css`)、`@import` を入れて、`url(...)` を絶対 URL にして、本文の外側に囲んでいた要素を作り直したページを、切り離した枠 (iframe) に表示します (`ts/ui/SiteDoc.tsx`)。
- 枠の中では、サイトの JavaScript を動かしません (`sandbox` に `allow-scripts` を付けません)。JavaScript で描く部分 (タブの切り替え、コードの色づけ、ヘッダーや目次など本文の外の部分) は、出ないか、動きません。
- JavaScript が描き終えたときに付けるクラスがないと本文を隠すサイトは、サイトの設定の `siteLookBodyClass` で、`body` に足すクラスを書きます (Kotlin の Writerside は `app-render-failed`)。
- サイトのフォントを使うため、アプリの CSP の `font-src` に、サイトのホストを入れます。
- 原文と翻訳を並べる表示と、読んだ位置の記録とスクロールバーは、アプリの見た目のときだけです。

## 開発 (Docker)

```bash
export UID GID=$(id -g)
docker compose run --rm install    # npm ci
docker compose run --rm test       # Vitest と cargo test
docker compose run --rm coverage   # ts/lib の行と分岐が 100%
docker compose run --rm format     # 整形の確認 (format-fix で整形)
docker compose run --rm analyze    # tsc、ESLint、Clippy
```

## ライセンス

GPL-3.0-or-later。
