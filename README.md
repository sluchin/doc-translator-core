# doc-translator-core

ドキュメントのサイトを、**リンクを開いたときに** 取得して、日本語に翻訳して表示する Tauri アプリ (PC と Android) の、**共通のコード**です。アプリごとに、このリポジトリを、サブモジュール (`shared/`) として置きます。

- [zephyr-doc](https://github.com/sluchin/zephyr-doc): Zephyr のドキュメント
- [kotlin-doc](https://github.com/sluchin/kotlin-doc): Kotlin のドキュメント

## 中身

| ディレクトリ                  | 内容                                                                                                                                                                                                                           |
| :---------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts/lib/`                     | HTML の取り出し (`extract`)、段落の分割 (`segments`)、翻訳の組み立て (`translatePage`)、履歴、URL、サニタイズ。テストあり (行と分岐が 100%)。                                                                                  |
| `ts/ui/`                      | React の画面 (`App`、`Doc`、`Drawer` (メニューとしおり)、`SettingsDialog`、`useViewer`、`api`、`App.css`)。                                                                                                                    |
| `rust/`                       | Tauri の Rust 側 (クレート `doc-translator-core`): ページの取得、翻訳 (Google Cloud Translation、Gemini、無料の Google 翻訳 (非公式)、ML Kit の目印の変換)、キャッシュ、設定。テストは、`rust/tests/` に、ソースと分けて置く。 |
| `plugins/tauri-plugin-mlkit/` | ML Kit (Android のオンデバイス翻訳) の Tauri プラグイン (Kotlin)。                                                                                                                                                             |
| `docker/Dockerfile`           | 開発用のイメージ (Node.js、Rust、Android の SDK と NDK)。アプリも、これを使う。                                                                                                                                                |

## アプリの作り方

アプリ (`zephyr-doc` を見本にする) に、次のものを置きます。

1. サブモジュール `shared/` (このリポジトリ)。
2. サイトの設定 `src/site.ts` (`SiteProfile`: ホスト、パスの先頭、最初のページ、本文のセレクタ、取り除く要素、タイトルの末尾、メニューの取り方)。
3. `src/main.tsx`: `<App profile={site} />` (`shared/ts/ui/App`) を表示する。
4. `src-tauri/`: `Cargo.toml` に、`doc-translator-core` と `tauri-plugin-mlkit` を、`../shared/...` のパスで書く。`lib.rs` で、`doc_translator_core::builder(Site { host, user_agent })` に、`tauri_plugin_mlkit::init()` を足して、`run(generate_context!())` する。
5. `tauri.conf.json`: 名前、識別子、CSP (画像は、サイトのホストだけ許す)。

ML Kit のプラグインは、Android のビルドが、**アプリの直接の依存**から見つけるので、アプリの `Cargo.toml` にも、書きます。

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
