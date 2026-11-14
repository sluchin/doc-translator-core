# TODO

今は実装しない。やるときに、先に「確認すること」を調べる。

## 翻訳のキャッシュ

- **クラウドに保存する**: 今は端末の中のファイルにだけ保存している (キャッシュの名前は、サービスごとと、Gemini ではモデルごとに分けている)。クラウドに置いて、端末をまたいで (zephyr-doc-trans と kotlin-doc-trans の間でも) 使えるようにする。
  - **確認すること**: 置き場所 (どのサービスか。費用)。原文のハッシュと翻訳を預けるので、ドキュメントの文章を第三者に置く権利 (ドキュメントの文章をリポジトリに置かない決まりと、同じ考えで確かめる)。認証 (誰でも書けると、翻訳を書き換えられる)。オフラインのときは、端末のキャッシュだけを使うこと。
- **20,000 件の上限をなくす**: 今は、全てのサービスを合わせて 20,000 件を超えると、古いものから消える (`rust/src/translate.rs` の `CACHE_CAPACITY`)。クラウドに保存するときに、端末の上限もなくす (または、クラウドのほうを正として、端末には最近使ったものだけを持つ)。
  - **確認すること**: 上限をなくすと、端末のキャッシュのファイル (JSON) が大きくなり続ける。読み込みと書き込みの時間と、容量。クラウドに置くなら、ファイルの全体を書き直さずに、1 件ずつ足す作りにする。

## デバッグビルドとリリースビルドを分ける

- **アプリ (zephyr-doc-trans、kotlin-doc-trans、react-doc-ja、typescript-doc-trans) のビルドが、デバッグとリリースで分かれていない**: `docker-compose.yml` の `build-desktop` (`tauri build --debug --no-bundle`) と `build-android` (`tauri android build --debug --apk`) は、デバッグビルドだけ。`release.yml` では、PC はリリースビルドだが、Android の APK はデバッグ鍵で署名したデバッグ版 (`app-universal-debug.apk`)。
  - **やること**: 各アプリの `docker-compose.yml` に、リリースビルドのサービス (`build-desktop-release` と `build-android-release` など) を足す。`release.yml` の Android をリリースビルド (`--debug` を外す) にして、リリースの鍵で署名する。手順を各アプリの `README.md` に書く。
  - **確認すること**: リリースの鍵 (keystore) の作り方と置き場所 (リポジトリに置かない。CI では GitHub の Secrets から読む)。`src-tauri/gen/android` の署名の設定 (`build.gradle.kts` の `signingConfigs`)。デバッグ版を入れた端末には、リリース版を上書きで入れられないこと (署名が違うので、一度アンインストールが要る。そのとき、端末の翻訳のキャッシュと設定が消える)。リリースビルドで、Rust の panic や開発者ツールの扱いが変わらないか。

## 文書の翻訳アプリ全体

- [ ] Python の文書の日本語訳のアプリ (python-doc-ja) を、ほかのアプリと同じ作りで作る。
- [x] 文書のアプリ (`*-doc`) の画面を見やすくする (画面の上のボタンを 1 段に収める)。
- [x] react-doc-trans の名前を react-doc-ja に変える。
