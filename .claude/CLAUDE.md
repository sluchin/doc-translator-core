# プロジェクト設定

ドキュメントを開いたときに翻訳して表示する Tauri アプリ (zephyr-doc-trans、kotlin-doc-trans など、`*-doc-trans` と react-doc-ja) の、**共通のコード**。アプリはこのリポジトリをサブモジュール `shared/` として置く。**アプリごとの違いはここに書かない** (サイトの設定 `SiteProfile` と、Rust の `Site` でアプリが渡す)。

- `ts/lib/`: DOM に依存する処理。行と分岐のカバレッジ 100% (Vitest + jsdom)。サイトごとの違いは `SiteProfile` の引数で受ける (特定のサイトの名前を書かない)。テストの HTML は作り物 (ドキュメントの文章を置かない)。
- `ts/ui/`: React の画面。薄く保つ。テストは置かない。
- `rust/`: `docs.rs` (取得と URL の検査。ホストは `Site`)、`translate.rs` (`Backend`: Google, Gemini。キャッシュ)、`plain.rs` (ML Kit 用の HTML とテキストの変換)、`settings.rs`、`commands.rs` (画面から呼ぶコマンドの本体。`AppState` を受け取る普通の関数)、`lib.rs` (`State` と `AppHandle` を `commands` に渡すだけの Tauri のコマンド、保存の画面、`builder(site)`)。行のカバレッジ 100% (cargo tarpaulin)。Tauri に依存して単体テストできない薄い部分だけを `#[cfg(not(tarpaulin_include))]` で外す。翻訳の API の送り先 (`Endpoints`) は差し替えられるので、通信のテストはテスト用の HTTP サーバー (mockito) を使う (本物の API は呼ばない)。
- `plugins/tauri-plugin-mlkit/`: ML Kit の Kotlin のプラグイン。Rust から直接呼ぶ。Android のパッケージは `jp.doctranslator.mlkit` (アプリを問わない共通の識別子。`build.gradle.kts` の `namespace`、`MlKitPlugin.kt` の `package`、`mobile.rs` の `register_android_plugin` をそろえる)。
- `docker/Dockerfile`: 開発用のイメージ。アプリの `docker-compose.yml` も、`shared/docker` をビルドのコンテキストにする。

## 守ること

- **共通のコードを変えるときは、全てのアプリ (`*-doc-trans` と react-doc-ja) への影響を考える。** 引数や型を変えたら、アプリ (`site.ts`、`lib.rs`) も、直す。変えたら、このリポジトリをコミットして push してから、各アプリで、サブモジュールの参照を更新する。
- セキュリティの決まり (取得はアプリが渡したホストだけ。HTML は必ず `sanitize()` を通す。API キーは画面に返さない) は zephyr-doc-trans の `.claude/CLAUDE.md` と同じ。
- ドキュメントの文章をリポジトリに置かない。
- **ログ**: Rust は `log::debug!` / `info!` / `warn!` / `error!` (`rust/src/logging.rs`。標準エラー出力と、アプリのデータの `logs/app.log`)、TypeScript は `ts/lib/log.ts` の `log` (`console.*` を直接使わない。Rust へ送る)。デバッグ版はデバッグ以上、リリース版は情報以上 (判定は、`default_level` と `setupLog` の中)。API キーなどの秘密は書かない。ログの文字は英語。設定の画面の「ログを見る」(`ts/ui/LogDialog.tsx`。Rust の `read_log`、`clear_log`、`export_log`) で、新しい順に見て、絞り込み、書き出し、消せる (分け方は `ts/lib/logView.ts`)。Rust の panic と、画面の予期しないエラー (`captureErrors`) も、ログファイルに残す。
- **サイトの見た目**: `ts/lib/siteLook.ts` (囲んでいた要素、CSS、ページの組み立て。テストあり) と `ts/ui/SiteDoc.tsx` (CSS の取得と iframe)。iframe は `sandbox="allow-same-origin"` (スクリプトは動かさない。リンクのクリックは、枠の外で受ける)。CSS は Rust の `fetch_css` で、ページと同じホストのものだけ取得する。本文の HTML は、今までどおり `sanitize()` を通す。サイトの JavaScript が組み直す本文は、アプリが `SiteProfile.siteLookRewrite` で組み直す (`rewriteForSiteLook`。組み直したあとも `sanitize()` を通す)。アプリの CSP の `font-src` に、サイトのホストを入れる。
- **API キー**: 使うキーは、設定の画面で入れたキー (空でなければ。優先)、空ならビルドのときの環境変数 `GOOGLE_CLOUD_TRANSLATION_API_KEY` と `GEMINI_API_KEY` (`option_env!`)、どちらもなければ設定が要る (`key_for_provider`)。ビルドのキーは設定のファイルに保存しない (`Settings::build_api_key`、`build_gemini_key`)。キーは実行ファイルに入るので、配るビルドや CI では設定しない。アプリの `docker-compose.yml` は、この環境変数をコンテナに渡す。

## コマンド

`docker compose run --rm <install|test|coverage|format|format-fix|analyze>` (`--rm` を付ける。`UID` と `GID` をエクスポートしておく)。コードを修正したら、`format-fix` → `format` → `analyze` → `test` → `coverage` を全て成功させる。ユーザーに依頼されない限り、`git commit` / `git push` は行わない。

## コーディング規約

- Prettier と rustfmt に従う。ESLint と Clippy の警告をゼロにする。
- ファイルの先頭に著作権とライセンス (`Copyright (c) 2026 Tetsuya Higashi`、`SPDX-License-Identifier: GPL-3.0-or-later`) を書く。
- コメントは日本語。句読点は「, 」と「.」。ログとエラーのメッセージ、識別子は英語。関数には TSDoc / rustdoc を付ける。
- **Rust のテストは `rust/tests/` にファイルを分けて置く** (本番のソースの中に `#[cfg(test)] mod tests` を書かない)。テストが呼ぶ関数と型は `pub` にする (モジュールも、`lib.rs` で `pub mod`)。
- `!` (非 null の表明) と、テスト以外の `unwrap()` を使わない。

## コミットガイドライン

- 英語。件名は Conventional Commits (`type(scope): description`。scope: `ts` `rust` `mlkit` `docker`)。本文はハイフンで始まる箇条書き。
- `Co-Authored-By` と Claude 帰属行を含めない。

## 開発ルール

- Markdown (`*.md`) の日本語の文章は、句読点に「、」「。」を使う (「,」「.」は使わない)。インラインコード・コードブロック・URL・ファイル名・数値 (`1.2.0`、`1,000`) は対象外。
- Markdown のコードブロック (3 つのバッククォートで囲んだ部分) の中の日本語は、ソースのコメントと同じく、句読点に「, 」「.」を使う。記号は、なるべく半角にする (`()` `""` `->` `<-` `~` `x` `>=` など)。罫線の図 (`─` `│` `▶` など) の中の矢印は、図がずれるので、そのままにする。見出しや番号付きリストの「1.」の形は変えない。`docs/` の生成物と、この `CLAUDE.md` は対象外。
- Markdown (`*.md`。この `CLAUDE.md` を除く) には、AI の目線の記述を書かない。読み手 (人) に向けて、事実、仕様、手順だけを書く。「承認されたら実装します」「教えてください」「提案します」のような、AI からの依頼や約束、作業の報告、「Claude が」のような書き手の記述は、会話で伝えて、ファイルには残さない。
- Markdown (`*.md`) を書く・直すときは、本多勝一著『日本語の作文技術』の原則 (修飾語の順序、ねじれのない係り受け、簡潔な一文一義など) を、厳密に守って、ドキュメントをブラッシュアップする。
  - 修飾語は、長いものを前に、短いものを後ろに置く。句点・読点は、係り受けを区切る所だけに打つ (余分な読点を入れない)。
  - 主語と述語を対応させて、ねじれをなくす。1 つの文には、1 つのことだけを書く (長い文は、分ける)。
  - 冗長な説明、くり返し、読み手の役に立たない補足は、削る。
