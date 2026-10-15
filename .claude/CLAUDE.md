# プロジェクト設定

ドキュメントを開いたときに翻訳して表示する Tauri アプリ (zephyr-doc、kotlin-doc) の、**共通のコード**。アプリは、このリポジトリを、サブモジュール `shared/` として置く。**アプリごとの違いは、ここに書かない** (サイトの設定 `SiteProfile` と、Rust の `Site` で、アプリが渡す)。

- `ts/lib/`: DOM に依存する処理。行と分岐のカバレッジ 100% (Vitest + jsdom)。サイトごとの違いは、`SiteProfile` の引数で受ける (特定のサイトの名前を、書かない)。テストの HTML は、作り物 (ドキュメントの文章を、置かない)。
- `ts/ui/`: React の画面。薄く保つ。テストは置かない。
- `rust/`: `docs.rs` (取得と URL の検査。ホストは `Site`)、`translate.rs` (`Backend`: Google, Gemini。キャッシュ)、`plain.rs` (ML Kit 用の HTML とテキストの変換)、`settings.rs`、`lib.rs` (`builder(site)`)。
- `plugins/tauri-plugin-mlkit/`: ML Kit の Kotlin のプラグイン。Rust から直接呼ぶ。Android のパッケージは `jp.sluchin.zephyrdoc.mlkit` (名前は、アプリを問わない共通の識別子なので、変えない)。
- `docker/Dockerfile`: 開発用のイメージ。アプリの `docker-compose.yml` も、`shared/docker` を、ビルドのコンテキストにする。

## 守ること

- **共通のコードを変えるときは、2 つのアプリへの影響を考える。** 引数や型を変えたら、アプリ (`site.ts`、`lib.rs`) も、直す。変えたら、このリポジトリをコミットして push してから、各アプリで、サブモジュールの参照を更新する。
- セキュリティの決まり (取得は、アプリが渡したホストだけ。HTML は、必ず `sanitize()` を通す。API キーは、画面に返さない) は、zephyr-doc の `.claude/CLAUDE.md` と同じ。
- ドキュメントの文章を、リポジトリに置かない。

## コマンド

`docker compose run --rm <install|test|coverage|format|format-fix|analyze>` (`--rm` を付ける。`UID` と `GID` をエクスポートしておく)。コードを修正したら、`format-fix` → `format` → `analyze` → `test` → `coverage` を、全て成功させる。ユーザーに依頼されない限り、`git commit` / `git push` は行わない。

## コーディング規約

- Prettier と rustfmt に従う。ESLint と Clippy の警告をゼロにする。
- ファイルの先頭に、著作権とライセンス (`Copyright (c) 2026 Tetsuya Higashi`、`SPDX-License-Identifier: GPL-3.0-or-later`) を書く。
- コメントは日本語。句読点は「, 」と「.」。ログとエラーのメッセージ、識別子は英語。関数には、TSDoc / rustdoc を付ける。
- **Rust のテストは、`rust/tests/` に、ファイルを分けて置く** (本番のソースの中に、`#[cfg(test)] mod tests` を書かない)。テストが呼ぶ関数と型は、`pub` にする (モジュールも、`lib.rs` で `pub mod`)。
- `!` (非 null の表明) と、テスト以外の `unwrap()` を使わない。

## コミットガイドライン

- 英語。件名は Conventional Commits (`type(scope): description`。scope: `ts` `rust` `mlkit` `docker`)。本文はハイフンで始まる箇条書き。
- `Co-Authored-By` と Claude 帰属行を含めない。
