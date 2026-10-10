use crate::model::{Entry, Failure, Kind, Outcome};
use crate::ops::split_name;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

const EDGE: u64 = 64 * 1024;
const BUF: usize = 1024 * 1024;

type Key = (String, u64, i64);

#[derive(Default, Clone, Copy)]
pub struct Hashes {
    quick: Option<[u8; 32]>,
    full: Option<[u8; 32]>,
}

pub type Cache = Mutex<HashMap<Key, Hashes>>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupGroup {
    pub id: String,
    pub size: u64,
    pub files: Vec<Entry>,
    pub keep: String,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub done: u64,
    pub total: u64,
}

fn key(e: &Entry) -> Key {
    (e.path.clone(), e.size, e.modified)
}

pub fn find(
    entries: &[Entry],
    cache: &Cache,
    cancel: &AtomicBool,
    progress: impl Fn(Progress),
) -> Outcome<Vec<DupGroup>> {
    let mut by_size: HashMap<u64, Vec<&Entry>> = HashMap::new();
    for e in entries
        .iter()
        .filter(|e| !e.package && e.size > 0 && e.kind != Kind::Partial && e.project.is_none())
    {
        by_size.entry(e.size).or_default().push(e);
    }
    let candidates: Vec<&Entry> = by_size
        .into_values()
        .filter(|v| v.len() > 1)
        .flatten()
        .collect();

    let quick_bytes: u64 = candidates.iter().map(|e| e.size.min(2 * EDGE)).sum();
    let mut total = quick_bytes
        + candidates
            .iter()
            .filter(|e| e.size > 2 * EDGE)
            .map(|e| e.size)
            .sum::<u64>();
    let mut done = 0u64;
    progress(Progress { done, total });

    let mut by_quick: HashMap<(u64, [u8; 32]), Vec<&Entry>> = HashMap::new();
    for e in &candidates {
        if cancel.load(Ordering::Relaxed) {
            return Err(Failure::new("cancelled", ""));
        }
        if let Some(h) = hash_with(cache, e, false) {
            by_quick.entry((e.size, h)).or_default().push(e);
        }
        done += e.size.min(2 * EDGE);
        progress(Progress { done, total });
    }

    let survivors: Vec<Vec<&Entry>> = by_quick.into_values().filter(|v| v.len() > 1).collect();
    total = quick_bytes
        + survivors
            .iter()
            .flatten()
            .filter(|e| e.size > 2 * EDGE)
            .map(|e| e.size)
            .sum::<u64>();
    progress(Progress { done, total });

    let mut groups = Vec::new();
    for bucket in survivors {
        let mut by_full: HashMap<[u8; 32], Vec<&Entry>> = HashMap::new();
        for e in bucket {
            if cancel.load(Ordering::Relaxed) {
                return Err(Failure::new("cancelled", ""));
            }
            let h = if e.size <= 2 * EDGE {
                hash_with(cache, e, false)
            } else {
                hash_with(cache, e, true)
            };
            if e.size > 2 * EDGE {
                done += e.size;
                progress(Progress { done, total });
            }
            if let Some(h) = h {
                by_full.entry(h).or_default().push(e);
            }
        }
        for (h, files) in by_full.into_iter().filter(|(_, v)| v.len() > 1) {
            let mut files: Vec<Entry> = files.into_iter().cloned().collect();
            files.sort_by_key(keeper_rank);
            groups.push(DupGroup {
                id: h.iter().take(8).map(|b| format!("{b:02x}")).collect(),
                size: files[0].size,
                keep: files[0].path.clone(),
                files,
            });
        }
    }
    groups.sort_by_key(|g| std::cmp::Reverse(g.size * (g.files.len() as u64 - 1)));
    Ok(groups)
}

fn hash_with(cache: &Cache, e: &Entry, full: bool) -> Option<[u8; 32]> {
    let k = key(e);
    if let Some(h) = cache
        .lock()
        .ok()?
        .get(&k)
        .and_then(|h| if full { h.full } else { h.quick })
    {
        return Some(h);
    }
    let path = Path::new(&e.path);
    let h = if full || e.size <= 2 * EDGE {
        hash_full(path).ok()?
    } else {
        hash_quick(path, e.size).ok()?
    };
    let mut c = cache.lock().ok()?;
    let slot = c.entry(k).or_default();
    if full || e.size <= 2 * EDGE {
        slot.full = Some(h);
    }
    if !full {
        slot.quick = Some(h);
    }
    Some(h)
}

fn hash_full(path: &Path) -> std::io::Result<[u8; 32]> {
    let mut f = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buf = vec![0u8; BUF];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(*hasher.finalize().as_bytes())
}

fn hash_quick(path: &Path, size: u64) -> std::io::Result<[u8; 32]> {
    let mut f = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    hasher.update(&size.to_le_bytes());
    let mut buf = vec![0u8; EDGE as usize];
    f.read_exact(&mut buf)?;
    hasher.update(&buf);
    f.seek(SeekFrom::Start(size - EDGE))?;
    f.read_exact(&mut buf)?;
    hasher.update(&buf);
    Ok(*hasher.finalize().as_bytes())
}

fn keeper_rank(e: &Entry) -> (bool, bool, i64, usize) {
    (is_copy_name(&e.name), e.top_level(), e.added, e.name.len())
}

pub fn is_copy_name(name: &str) -> bool {
    let (stem, _) = split_name(name);
    let lower = stem.to_lowercase();
    if lower.starts_with("copy of ") || lower.ends_with(" copy") {
        return true;
    }
    let trimmed = lower.trim_end_matches(|c: char| c.is_ascii_digit());
    let digits = lower.len() - trimmed.len();
    if digits == 0 || digits > 3 {
        return lower.ends_with(')') && paren_number(&lower);
    }
    trimmed.ends_with(" copy ")
        || trimmed.ends_with(' ')
        || trimmed.ends_with('-')
        || trimmed.ends_with('_')
}

fn paren_number(s: &str) -> bool {
    s.rfind('(').is_some_and(|i| {
        let inner = &s[i + 1..s.len() - 1];
        !inner.is_empty() && inner.len() <= 3 && inner.chars().all(|c| c.is_ascii_digit())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan::{scan, Options};
    use crate::testutil::TempDir;

    #[test]
    fn copy_names() {
        assert!(is_copy_name("report (1).pdf"));
        assert!(is_copy_name("report(2).pdf"));
        assert!(is_copy_name("report copy.pdf"));
        assert!(is_copy_name("report copy 2.pdf"));
        assert!(is_copy_name("report 2.pdf"));
        assert!(is_copy_name("report-1.pdf"));
        assert!(!is_copy_name("report.pdf"));
        assert!(!is_copy_name("IMG_2024.jpg"));
        assert!(!is_copy_name("Annual report (draft).pdf"));
    }

    #[test]
    fn finds_identical_files_only() {
        let t = TempDir::new("dupes");
        let big: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
        let mut big_changed = big.clone();
        big_changed[150_000] ^= 1;
        t.file("report.pdf", b"%PDF same content");
        t.file("report (1).pdf", b"%PDF same content");
        t.file("Documents/report.pdf", b"%PDF same content");
        t.file("other.pdf", b"%PDF diff content");
        t.file("video.mov", &big);
        t.file("video copy.mov", &big);
        t.file("video edit.mov", &big_changed);
        t.file("empty1", b"");
        t.file("empty2", b"");

        let snap = scan(
            t.path(),
            Options {
                hidden: false,
                recursive: true,
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        let cache = Cache::default();
        let groups = find(&snap.entries, &cache, &AtomicBool::new(false), |_| {}).unwrap();
        assert_eq!(groups.len(), 2);
        let video = groups.iter().find(|g| g.size == 300_000).unwrap();
        assert_eq!(video.files.len(), 2);
        assert!(video.keep.ends_with("/video.mov"));
        let report = groups.iter().find(|g| g.files.len() == 3).unwrap();
        assert!(report.keep.ends_with("Documents/report.pdf"));
        assert_eq!(report.files.last().unwrap().name, "report (1).pdf");

        let again = find(&snap.entries, &cache, &AtomicBool::new(false), |_| {}).unwrap();
        assert_eq!(again.len(), 2);
    }
}
