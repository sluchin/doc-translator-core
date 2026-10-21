//! 標準エラー出力とログファイルの両方へ出力するログの初期化, ログファイルのローテーション, および
//! フロントエンドから転送されたログの記録を行うモジュール.
//!
//! レベルは, デバッグ版はデバッグ以上, リリース版は情報 (最低限), 警告, エラー ([`default_level`]).
//! 環境変数 `RUST_LOG` で上書きできます.

use std::any::Any;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Stderr, Write};
use std::path::{Path, PathBuf};

use serde::Deserialize;

/// 1 つのログファイルの最大サイズ (バイト). これを超える書き込みの前に, ローテートします.
pub const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
/// 保持する, ローテート済みログファイルの世代数 (`app.log.1` 〜 `.<この数>`).
pub const MAX_BACKUPS: u32 = 3;
/// 画面に返す, ログの末尾の最大サイズ (バイト). 画面で読める量にする.
pub const MAX_READ_BYTES: u64 = 512 * 1024;

/// ローテート済みファイルの世代を表す, パスの末尾 (`<path>.<generation>`) を返します.
///
/// # Arguments
///
/// * `path` - 元のログファイルのパス.
/// * `generation` - 世代 (1 が最新, 数が大きいほど古い).
///
/// # Returns
///
/// ローテート済みファイルのパス.
pub fn backup_path(path: &Path, generation: u32) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(".{}", generation));
    PathBuf::from(name)
}

/// サイズが上限を超えたらローテートしながら書き込む, ログファイルの書き込み先.
pub struct RotatingFile {
    /// ログファイル本体のパス (ローテートしても変わらない).
    path: PathBuf,
    /// ローテートする最大サイズ (バイト).
    max_bytes: u64,
    /// 保持するローテート済みファイルの世代数.
    max_backups: u32,
    /// 開いているログファイル.
    file: File,
    /// 現在のログファイルへ, これまでに書き込んだバイト数.
    size: u64,
}

impl RotatingFile {
    /// 指定したパスのログファイルを, 追記モードで開きます. 親ディレクトリが無ければ作成します.
    ///
    /// # Arguments
    ///
    /// * `path` - ログファイルのパス.
    /// * `max_bytes` - ローテートする最大サイズ (バイト).
    /// * `max_backups` - 保持するローテート済みファイルの世代数.
    ///
    /// # Returns
    ///
    /// 成功した場合は [`Ok`]. 親ディレクトリの作成やファイルを開くのに失敗した場合は [`Err`].
    pub fn open(path: &Path, max_bytes: u64, max_backups: u32) -> io::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        let size = file.metadata()?.len();
        Ok(Self {
            path: path.to_path_buf(),
            max_bytes,
            max_backups,
            file,
            size,
        })
    }

    /// 現在のログファイルを世代送りし (`.1` を `.2` に, というように), 新しい空のログファイルを開きます.
    ///
    /// # Returns
    ///
    /// 成功した場合は [`Ok`]. ファイルの移動や作成に失敗した場合は [`Err`].
    fn rotate(&mut self) -> io::Result<()> {
        // 最も古い世代から消す. 先に消しておかないと, 直後の世代送りで移動先が衝突する.
        let oldest = backup_path(&self.path, self.max_backups);
        if oldest.exists() {
            fs::remove_file(&oldest)?;
        }
        for generation in (1..self.max_backups).rev() {
            let from = backup_path(&self.path, generation);
            if from.exists() {
                fs::rename(&from, backup_path(&self.path, generation + 1))?;
            }
        }
        if self.max_backups > 0 {
            fs::rename(&self.path, backup_path(&self.path, 1))?;
        }
        self.file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        self.size = 0;
        Ok(())
    }
}

impl RotatingFile {
    /// 今のログファイルへ, これまでに書き込んだバイト数を返します.
    ///
    /// # Returns
    ///
    /// バイト数.
    pub fn size(&self) -> u64 {
        self.size
    }
}

impl Write for RotatingFile {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if self.size + buf.len() as u64 > self.max_bytes {
            self.rotate()?;
        }
        let written = self.file.write(buf)?;
        self.size += written as u64;
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

/// 2 つの書き込み先へ, 同じ内容を書き込む出力先. 一方が失敗しても, もう一方への書き込みは続けます.
pub struct Tee<A: Write, B: Write> {
    /// 1 つ目の書き込み先.
    pub first: A,
    /// 2 つ目の書き込み先.
    pub second: B,
}

impl<A: Write, B: Write> Write for Tee<A, B> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        // ログの出力先の一方が失敗しても (ディスクが一杯など), もう一方は出力を続けたいので,
        // 個別のエラーは無視し, 呼び出し元には常に成功として返す.
        let _ = self.first.write_all(buf);
        let _ = self.second.write_all(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        let _ = self.first.flush();
        let _ = self.second.flush();
        Ok(())
    }
}

/// アプリのデータのディレクトリから, ログファイルのパスを求めます.
///
/// # Arguments
///
/// * `app_dir` - アプリのデータのディレクトリ (Tauri の `app_data_dir`).
///
/// # Returns
///
/// `<アプリのデータのディレクトリ>/logs/app.log`.
pub fn log_path(app_dir: &Path) -> PathBuf {
    app_dir.join("logs").join("app.log")
}

/// 環境変数 `RUST_LOG` がないときの, ログレベルを返します.
///
/// デバッグ版 (`debug_assertions`) はデバッグ以上, リリース版は情報以上 (最低限の情報, 警告, エラー) を出します.
///
/// # Arguments
///
/// * `debug` - デバッグ版か.
///
/// # Returns
///
/// ログレベル.
pub fn default_level(debug: bool) -> log::LevelFilter {
    if debug {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    }
}

/// ログ出力を初期化します. 標準エラー出力と, ローテートするログファイルの両方へ出力します.
///
/// ログレベルは環境変数 `RUST_LOG` で変更できます (既定は, デバッグ版はデバッグ以上, リリース版は情報以上).
/// ログファイルを開けない場合 (権限が無いなど) は, 標準エラー出力のみへ出力します.
/// すでに初期化してあれば, 何もしません.
///
/// # Arguments
///
/// * `path` - ログファイルのパス ([`log_path`]).
// グローバルなロガーを 1 度だけ初期化するもので, cargo test では検証できない
// (ロジックは RotatingFile / Tee / log_path / default_level で検証する).
#[cfg(not(tarpaulin_include))]
pub fn init_logging(path: &Path) {
    let mut builder = env_logger::Builder::new();
    builder.filter_level(default_level(cfg!(debug_assertions)));
    // ログの画面で, 同じ秒のログの順が分かるように, ミリ秒まで書く
    builder.format_timestamp_millis();
    // RUST_LOG があれば, 既定のレベルを上書きする
    builder.parse_env(env_logger::Env::default());
    if let Ok(file) = RotatingFile::open(path, MAX_LOG_BYTES, MAX_BACKUPS) {
        builder.target(env_logger::Target::Pipe(Box::new(Tee {
            first: io::stderr() as Stderr,
            second: file,
        })));
    }
    // 2 回目の初期化は, 失敗するだけで, ログは前のまま出る
    let _ = builder.try_init();
    install_panic_hook();
}

/// panic を, ログ (ログファイル) に残すようにします. 元の処理 (標準エラー出力への表示) も, そのあとで呼びます.
///
/// 落ちた原因を, あとからアプリのログの画面で見られるようにするためです.
// グローバルな panic の処理を差し替えるもので, cargo test では検証できない
// (文字列にするのは panic_text で検証する).
#[cfg(not(tarpaulin_include))]
fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info.location().map(|l| l.to_string());
        log::error!(
            "{}\n{}",
            panic_text(info.payload(), location.as_deref()),
            std::backtrace::Backtrace::force_capture()
        );
        previous(info);
    }));
}

/// panic の内容と場所を, 1 行の文字列にします.
///
/// # Arguments
///
/// * `payload` - panic の値 (`panic!` のメッセージ. 文字列でなければ, 内容は分からない).
/// * `location` - panic した場所 (`ファイル:行:列`).
///
/// # Returns
///
/// 文字列 (例: `Panicked at src/lib.rs:1:2: boom`).
pub fn panic_text(payload: &(dyn Any + Send), location: Option<&str>) -> String {
    let message = payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "(not a string)".to_string());
    format!("Panicked at {}: {}", location.unwrap_or("unknown"), message)
}

/// ログファイルの末尾を返します. ローテート済みのファイルも, 古いものから順に, つなげて読みます.
///
/// 上限を超える分は, 古い方から捨てます. 途中で切った最初の行は, 行の途中からになるので, 捨てます.
/// UTF-8 でないバイトは, 置き換え文字にします.
///
/// # Arguments
///
/// * `path` - ログファイルのパス ([`log_path`]).
/// * `max_backups` - ローテート済みファイルの世代数.
/// * `max_bytes` - 返す最大のバイト数.
///
/// # Returns
///
/// 成功した場合は, ログの文字列 (ファイルがなければ空). 読めない場合は [`Err`].
pub fn read_tail(path: &Path, max_backups: u32, max_bytes: u64) -> io::Result<String> {
    // 新しいファイルから読み, 上限に達したら止める
    let mut files = vec![path.to_path_buf()];
    files.extend((1..=max_backups).map(|generation| backup_path(path, generation)));
    let mut chunks: Vec<Vec<u8>> = Vec::new();
    let mut remaining = max_bytes;
    let mut truncated = false;
    for file in files {
        if remaining == 0 {
            break;
        }
        let mut handle = match File::open(&file) {
            Ok(handle) => handle,
            Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e),
        };
        let size = handle.metadata()?.len();
        let start = size.saturating_sub(remaining);
        // 途中から読むのは, 上限に達した, 最後に読むファイルだけ
        truncated = start > 0;
        handle.seek(SeekFrom::Start(start))?;
        let mut chunk = Vec::new();
        handle.read_to_end(&mut chunk)?;
        remaining -= chunk.len() as u64;
        chunks.push(chunk);
    }
    let mut bytes: Vec<u8> = chunks.into_iter().rev().flatten().collect();
    if truncated {
        let cut = bytes
            .iter()
            .position(|&b| b == b'\n')
            .map_or(bytes.len(), |i| i + 1);
        bytes.drain(..cut);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// ログを消します. ローテート済みのファイルを消し, 今のログファイルを空にします.
///
/// 今のログファイルは, ロガーが開いたままなので, 消さないで, 空にします (追記で開いているので, 続きは先頭から書かれます).
///
/// # Arguments
///
/// * `path` - ログファイルのパス ([`log_path`]).
/// * `max_backups` - ローテート済みファイルの世代数.
///
/// # Returns
///
/// 成功した場合は [`Ok`]. 消せない場合は [`Err`].
pub fn clear_logs(path: &Path, max_backups: u32) -> io::Result<()> {
    for generation in 1..=max_backups {
        match fs::remove_file(backup_path(path, generation)) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
            _ => {}
        }
    }
    match OpenOptions::new().write(true).truncate(true).open(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// フロントエンドから送られる, ログの重大度.
#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    /// 詳細なデバッグ情報.
    Debug,
    /// 通常の操作の記録.
    Info,
    /// 警告.
    Warn,
    /// エラー.
    Error,
}

impl From<LogLevel> for log::Level {
    fn from(level: LogLevel) -> Self {
        match level {
            LogLevel::Debug => log::Level::Debug,
            LogLevel::Info => log::Level::Info,
            LogLevel::Warn => log::Level::Warn,
            LogLevel::Error => log::Level::Error,
        }
    }
}

/// フロントエンドのログメッセージを, バックエンドのログ (標準エラー出力とログファイル) へ記録します.
///
/// フロントエンドの `loglevel` の出力を, ブラウザの開発者ツールでしか見られないコンソールだけでなく,
/// バックエンドのログファイルにも残すために使います. ログの記録自体は失敗しないため, 戻り値はありません.
///
/// # Arguments
///
/// * `level` - ログの重大度.
/// * `message` - ログの内容.
#[tauri::command]
pub fn log_frontend_message(level: LogLevel, message: String) {
    log::log!(target: "frontend", level.into(), "{}", message);
}
