//! JSON 持久化的统一读写：原子写入 + 损坏文件保全。
//!
//! 两条硬性规则：
//! 1. 解析失败绝不静默返回默认值 —— 调用方一旦带着默认值再保存，就会把可恢复的
//!    损坏文件覆盖成空集。这里先把原文件改名保全，再把错误上抛。
//! 2. 临时文件必须唯一 —— data.json 与 pricing_overrides.json 都存在并发保存，
//!    共用 `xxx.json.tmp` 会让两个写入互相截断后 rename 出半截文件。

use serde::{de::DeserializeOwned, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// 读取 JSON。文件不存在返回 `Ok(None)`；内容损坏则保全原文件并返回 Err。
pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("读取 {} 失败: {e}", path.display())),
    };
    match serde_json::from_str::<T>(&text) {
        Ok(value) => Ok(Some(value)),
        Err(e) => {
            let preserved = preserve_corrupt(path);
            Err(match preserved {
                Some(p) => format!(
                    "{} 内容已损坏: {e}（原文件已保全为 {}）",
                    path.display(),
                    p.display()
                ),
                None => format!(
                    "{} 内容已损坏且无法保全: {e}（请勿保存以免覆盖）",
                    path.display()
                ),
            })
        }
    }
}

/// 原子写入：唯一临时文件 → 写满并 fsync → rename 覆盖。
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("无法创建目录 {}: {e}", dir.display()))?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| format!("序列化失败: {e}"))?;
    let tmp = unique_tmp_path(path);

    let write_result = (|| -> io::Result<()> {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&tmp)?;
        file.write_all(text.as_bytes())?;
        file.flush()?;
        // 落盘后再 rename：崩溃/断电不会留下「rename 成功但内容为空」的文件
        file.sync_all()?;
        fs::rename(&tmp, path)?;
        sync_parent_dir(path)
    })();

    match write_result {
        Ok(()) => Ok(()),
        Err(e) => {
            fs::remove_file(&tmp).ok();
            Err(format!("写入 {} 失败: {e}", path.display()))
        }
    }
}

/// rename 后同步父目录：只 fsync 文件不足以保证目录项本身落盘（Unix）。
#[cfg(unix)]
fn sync_parent_dir(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn sync_parent_dir(_path: &Path) -> io::Result<()> {
    Ok(())
}

/// 把损坏文件挪成 `.corrupt-<时间戳>`，返回新路径；挪不动（被占用）返回 None。
fn preserve_corrupt(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_string_lossy().to_string();
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let target = path.with_file_name(format!("{name}.corrupt-{stamp}"));
    if fs::rename(path, &target).is_ok() {
        log::error!("数据文件损坏，已保全为 {}", target.display());
        return Some(target);
    }
    if fs::copy(path, &target).is_ok() {
        log::error!(
            "数据文件损坏，已复制保全为 {}（原文件仍在，勿直接保存）",
            target.display()
        );
        return Some(target);
    }
    log::error!("数据文件损坏且无法保全: {}", path.display());
    None
}

fn unique_tmp_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "data".to_string());
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    path.with_file_name(format!(".{name}.{}.{seq}.tmp", std::process::id()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Serialize, Deserialize, PartialEq, Debug, Default)]
    struct Doc {
        items: Vec<String>,
        count: u32,
    }

    fn tmp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wb-json-store-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn missing_file_reads_as_none_not_error() {
        let path = tmp_file("definitely-absent.json");
        fs::remove_file(&path).ok();
        assert_eq!(read_json::<Doc>(&path).unwrap(), None);
    }

    #[test]
    fn round_trip_writes_and_reads() {
        let path = tmp_file("round-trip.json");
        let doc = Doc {
            items: vec!["a".into(), "b".into()],
            count: 2,
        };
        write_json_atomic(&path, &doc).unwrap();
        assert_eq!(read_json::<Doc>(&path).unwrap(), Some(doc));
        fs::remove_file(&path).ok();
    }

    #[test]
    fn corrupt_file_is_preserved_and_reported_not_silently_defaulted() {
        let path = tmp_file("corrupt.json");
        fs::write(&path, "{ this is not json ").unwrap();
        let err = read_json::<Doc>(&path).unwrap_err();
        assert!(err.contains("已损坏"), "got: {err}");
        // 原路径不再持有损坏字节：后续保存不会覆盖可恢复数据
        assert!(!path.exists(), "损坏文件应已被挪走");
        let backup = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .find(|n| n.starts_with("corrupt.json.corrupt-"));
        assert!(backup.is_some(), "应存在 .corrupt- 备份文件");
        if let Some(n) = backup {
            fs::remove_file(path.parent().unwrap().join(n)).ok();
        }
    }

    #[test]
    fn concurrent_writes_use_distinct_temp_files_and_leave_valid_json() {
        let path = tmp_file("concurrent.json");
        let mut handles = Vec::new();
        for i in 0..8 {
            let p = path.clone();
            handles.push(std::thread::spawn(move || {
                let doc = Doc {
                    items: vec![format!("thread-{i}")],
                    count: i,
                };
                write_json_atomic(&p, &doc)
            }));
        }
        for h in handles {
            assert!(h.join().unwrap().is_ok());
        }
        // 结果必须是 8 个完整写入之一，而不是半截 JSON
        let read = read_json::<Doc>(&path).unwrap().expect("文件应可读且完整");
        assert_eq!(read.items.len(), 1);
        let leftovers = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with(".concurrent.json.")
            })
            .count();
        assert_eq!(leftovers, 0, "不应残留临时文件");
        fs::remove_file(&path).ok();
    }
}
