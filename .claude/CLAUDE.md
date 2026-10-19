# プロジェクト設定

ドキュメントを開いたときに翻訳して表示する Tauri アプリ (zephyr-doc、kotlin-doc) の、**共通のコード**。アプリはこのリポジトリをサブモジュール `shared/` として置く。**アプリごとの違いはここに書かない** (サイトの設定 `SiteProfile` と、Rust の `Site` でアプリが渡す)。

- `ts/lib/`: DOM に依存する処理。行と分岐のカバレッジ 100% (Vitest + jsdom)。サイトごとの違いは `SiteProfile` の引数で受ける (特定のサイトの名前を書かない)。テストの HTML は作り物 (ドキュメントの文章を置かない)。
- `ts/ui/`: React の画面。薄く保つ。テストは置かない。
- `rust/`: `docs.rs` (取得と URL の検査。ホストは `Site`)、`translate.rs` (`Backend`: Google, Gemini。キャッシュ)、`plain.rs` (ML Kit 用の HTML とテキストの変換)、`settings.rs`、`lib.rs` (`builder(site)`)。
- `plugins/tauri-plugin-mlkit/`: ML Kit の Kotlin のプラグイン。Rust から直接呼ぶ。Android のパッケージは `jp.sluchin.zephyrdoc.mlkit` (名前はアプリを問わない共通の識別子なので、変えない)。
- `docker/Dockerfile`: 開発用のイメージ。アプリの `docker-compose.yml` も、`shared/docker` をビルドのコンテキストにする。

## 守ること

- **共通のコードを変えるときは 2 つのアプリへの影響を考える。** 引数や型を変えたら、アプリ (`site.ts`、`lib.rs`) も、直す。変えたら、このリポジトリをコミットして push してから、各アプリで、サブモジュールの参照を更新する。
- セキュリティの決まり (取得はアプリが渡したホストだけ。HTML は必ず `sanitize()` を通す。API キーは画面に返さない) は zephyr-doc の `.claude/CLAUDE.md` と同じ。
- ドキュメントの文章をリポジトリに置かない。
- **ログ**: Rust は `log::debug!` / `info!` / `warn!` / `error!` (`rust/src/logging.rs`。標準エラー出力と、アプリのデータの `logs/app.log`)、TypeScript は `ts/lib/log.ts` の `log` (`console.*` を直接使わない。Rust へ送る)。デバッグ版はデバッグ以上、リリース版は情報以上 (判定は、`default_level` と `setupLog` の中)。API キーなどの秘密は書かない。ログの文字は英語。
- **サイトの見た目**: `ts/lib/siteLook.ts` (囲んでいた要素、CSS、ページの組み立て。テストあり) と `ts/ui/SiteDoc.tsx` (CSS の取得と iframe)。iframe は `sandbox="allow-same-origin"` (スクリプトは動かさない。リンクのクリックは、枠の外で受ける)。CSS は Rust の `fetch_css` で、ページと同じホストのものだけ取得する。本文の HTML は、今までどおり `sanitize()` を通す。サイトの JavaScript が組み直す本文は、アプリが `SiteProfile.siteLookRewrite` で組み直す (`rewriteForSiteLook`。組み直したあとも `sanitize()` を通す)。アプリの CSP の `font-src` に、サイトのホストを入れる。
- **API キーの初期値**: ビルドのときの環境変数 `GOOGLE_CLOUD_TRANSLATION_API_KEY` と `GEMINI_API_KEY` (`Settings::with_keys`。`option_env!`)。保存した設定の、まだ入れていないキー (null) にも使う (`Settings::load`)。画面で消したキーは、空の文字列で保存して、区別する。キーは実行ファイルに入るので、配るビルドや CI では設定しない。

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
