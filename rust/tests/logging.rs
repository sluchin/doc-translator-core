//! ログ (`logging`) のテスト.

use std::fs;
use std::io::{self, Write};
use std::path::Path;

use tempfile::tempdir;

use doc_translator_core::logging::{
    LogLevel, RotatingFile, Tee, backup_path, default_level, log_frontend_message, log_path,
};

#[test]
fn test_default_level_by_build() {
    assert_eq!(default_level(true), log::LevelFilter::Debug);
    assert_eq!(default_level(false), log::LevelFilter::Info);
}

#[test]
fn test_backup_path_success() {
    assert_eq!(
        backup_path(Path::new("/logs/a.log"), 2),
        Path::new("/logs/a.log.2")
    );
}

#[test]
fn test_log_path_success() {
    assert_eq!(
        log_path(Path::new("/data/app")),
        Path::new("/data/app/logs/app.log")
    );
}

#[test]
fn test_rotating_file_open_creates_parent_and_resumes_size() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("sub/app.log");

    let mut file = RotatingFile::open(&path, 1024, 3).unwrap();
    file.write_all(b"hello").unwrap();
    drop(file);

    let reopened = RotatingFile::open(&path, 1024, 3).unwrap();
    assert_eq!(reopened.size(), 5);
    assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
}

#[test]
fn test_rotating_file_rotates_and_keeps_max_backups() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("app.log");
    let mut file = RotatingFile::open(&path, 10, 3).unwrap();

    // 1 回目のローテート: 現在のログが .1 になる.
    file.write_all(b"aaaaaaaaaaa").unwrap();
    assert_eq!(fs::read_to_string(backup_path(&path, 1)).unwrap(), "");
    assert_eq!(fs::read_to_string(&path).unwrap(), "aaaaaaaaaaa");

    // 2 回目: 直前の .1 が .2 になり, 現在のログが新しい .1 になる.
    file.write_all(b"bbbbbbbbbbb").unwrap();
    assert_eq!(fs::read_to_string(backup_path(&path, 2)).unwrap(), "");
    assert_eq!(
        fs::read_to_string(backup_path(&path, 1)).unwrap(),
        "aaaaaaaaaaa"
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), "bbbbbbbbbbb");

    // 3 回目: .1 → .2, .2 → .3.
    file.write_all(b"ccccccccccc").unwrap();
    assert_eq!(
        fs::read_to_string(backup_path(&path, 1)).unwrap(),
        "bbbbbbbbbbb"
    );
    assert_eq!(
        fs::read_to_string(backup_path(&path, 2)).unwrap(),
        "aaaaaaaaaaa"
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), "ccccccccccc");

    // 4 回目: 最大世代数 (3) を超える最も古い世代 (直前の空の .3) が消え, 世代が 1 つずつ進む.
    file.write_all(b"ddddddddddd").unwrap();
    assert_eq!(
        fs::read_to_string(backup_path(&path, 3)).unwrap(),
        "aaaaaaaaaaa"
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), "ddddddddddd");
}

#[test]
fn test_rotating_file_small_writes_do_not_rotate() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("app.log");
    let mut file = RotatingFile::open(&path, 1024, 3).unwrap();

    file.write_all(b"a").unwrap();
    file.write_all(b"b").unwrap();

    assert_eq!(fs::read_to_string(&path).unwrap(), "ab");
    assert!(!backup_path(&path, 1).exists());
}

#[test]
fn test_tee_writes_to_both_and_tolerates_failure() {
    struct Failing;
    impl Write for Failing {
        fn write(&mut self, _buf: &[u8]) -> io::Result<usize> {
            Err(io::Error::other("boom"))
        }
        fn flush(&mut self) -> io::Result<()> {
            Err(io::Error::other("boom"))
        }
    }

    let mut ok = Vec::new();
    {
        let mut tee = Tee {
            first: &mut ok,
            second: Failing,
        };
        tee.write_all(b"hello").unwrap();
        tee.flush().unwrap();
    }
    assert_eq!(ok, b"hello");

    let mut a = Vec::new();
    let mut b = Vec::new();
    {
        let mut tee = Tee {
            first: &mut a,
            second: &mut b,
        };
        tee.write_all(b"hi").unwrap();
    }
    assert_eq!(a, b"hi");
    assert_eq!(b, b"hi");
}

#[test]
fn test_log_level_into_success() {
    assert_eq!(log::Level::from(LogLevel::Debug), log::Level::Debug);
    assert_eq!(log::Level::from(LogLevel::Info), log::Level::Info);
    assert_eq!(log::Level::from(LogLevel::Warn), log::Level::Warn);
    assert_eq!(log::Level::from(LogLevel::Error), log::Level::Error);
}

#[test]
fn test_log_frontend_message_does_not_panic() {
    log_frontend_message(LogLevel::Info, "test".to_string());
}
