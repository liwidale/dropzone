use crate::kinds;
use crate::meta;
use crate::model::{now_ms, time_ms, Entry, Failure, Kind, Outcome, Snapshot};
use crate::projects;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub const MAX_ENTRIES: usize = 200_000;
const MAX_DEPTH: usize = 16;
const PACKAGE_FILE_LIMIT: usize = 20_000;
pub const TEMP_PREFIX: &str = ".dropzone-partial-";

#[derive(Clone, Copy)]
pub struct Options {
    pub hidden: bool,
    pub recursive: bool,
}

pub fn scan(root: &Path, opts: Options, cancel: &AtomicBool) -> Outcome<Snapshot> {
    let meta = fs::metadata(root).map_err(|e| Failure::io(&e))?;
    if !meta.is_dir() {
        return Err(Failure::new("notfolder", root.display().to_string()));
    }
    fs::read_dir(root).map_err(|e| Failure::io(&e))?;

    let mut entries = Vec::new();
    let mut unreadable = 0u32;
    let mut truncated = false;
    let mut stack: Vec<(PathBuf, String, usize, Option<String>)> =
        vec![(root.to_path_buf(), String::new(), 0, None)];

    while let Some((dir, rel, depth, inherited)) = stack.pop() {
        if cancel.load(Ordering::Relaxed) {
            return Err(Failure::new("cancelled", ""));
        }
        let Ok(read) = fs::read_dir(&dir) else {
            unreadable += 1;
            continue;
        };
        let items: Vec<_> = read.flatten().collect();
        let project = if items
            .iter()
            .any(|i| projects::is_marker(&i.file_name().to_string_lossy()))
        {
            Some(rel.clone())
        } else {
            inherited
        };
        for item in items {
            let name = item.file_name().to_string_lossy().into_owned();
            if skip_name(&name, opts.hidden) {
                continue;
            }
            let Ok(ft) = item.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            let path = item.path();
            let ext = kinds::extension(&name);
            if ft.is_dir() && !kinds::is_package(&ext) {
                if opts.recursive && depth < MAX_DEPTH {
                    let child = if rel.is_empty() {
                        name.clone()
                    } else {
                        format!("{rel}/{name}")
                    };
                    stack.push((path, child, depth + 1, project.clone()));
                }
                continue;
            }
            if entries.len() >= MAX_ENTRIES {
                truncated = true;
                break;
            }
            if let Some(mut entry) = describe(&path, &name, &rel, &ext, ft.is_dir()) {
                entry.project = project.clone();
                entries.push(entry);
            }
        }
        if truncated {
            break;
        }
    }

    let total_size = entries.iter().map(|e| e.size).sum();
    Ok(Snapshot {
        root: root.display().to_string(),
        entries,
        total_size,
        truncated,
        unreadable,
        scanned_at: now_ms(),
    })
}

pub fn top_level(root: &Path, hidden: bool) -> Outcome<Vec<Entry>> {
    let read = fs::read_dir(root).map_err(|e| Failure::io(&e))?;
    let project = projects::marker_in(root).map(|_| String::new());
    let mut out = Vec::new();
    for item in read.flatten() {
        let name = item.file_name().to_string_lossy().into_owned();
        if skip_name(&name, hidden) {
            continue;
        }
        let Ok(ft) = item.file_type() else { continue };
        let ext = kinds::extension(&name);
        if ft.is_symlink() || (ft.is_dir() && !kinds::is_package(&ext)) {
            continue;
        }
        if let Some(mut entry) = describe(&item.path(), &name, "", &ext, ft.is_dir()) {
            entry.project = project.clone();
            out.push(entry);
        }
    }
    Ok(out)
}

fn skip_name(name: &str, hidden: bool) -> bool {
    name.starts_with(TEMP_PREFIX)
        || name == ".DS_Store"
        || name == "node_modules"
        || name == "Icon\r"
        || (!hidden && name.starts_with('.'))
}

pub fn describe(path: &Path, name: &str, rel: &str, ext: &str, is_dir: bool) -> Option<Entry> {
    let md = fs::symlink_metadata(path).ok()?;
    let modified = time_ms(md.modified());
    let size = if is_dir { package_size(path) } else { md.len() };
    let image_like = matches!(kinds::by_extension(ext), Some(Kind::Image)) || ext.is_empty();
    let extra = meta::read(path, image_like);
    let kind = kinds::classify(path, name, ext, is_dir, extra.screen_capture);
    let added = extra
        .added
        .unwrap_or_else(|| time_ms(md.created()).max(0))
        .max(0);
    Some(Entry {
        path: path.display().to_string(),
        name: name.to_string(),
        dir: rel.to_string(),
        ext: ext.to_string(),
        kind,
        size,
        modified,
        added: if added == 0 { modified } else { added },
        from: extra.from,
        package: is_dir,
        project: None,
    })
}

pub fn package_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let mut seen = 0usize;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(read) = fs::read_dir(&dir) else {
            continue;
        };
        for item in read.flatten() {
            seen += 1;
            if seen > PACKAGE_FILE_LIMIT {
                return total;
            }
            let Ok(md) = item.metadata() else { continue };
            if item.file_type().map(|t| t.is_symlink()).unwrap_or(true) {
                continue;
            }
            if md.is_dir() {
                stack.push(item.path());
            } else {
                total += md.len();
            }
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    #[test]
    fn scans_top_level_and_nested() {
        let t = TempDir::new("scan");
        t.file("a.pdf", b"%PDF-1.4");
        t.file(
            "Screenshot 2026-01-01 at 10.00.00.png",
            &[0x89, b'P', b'N', b'G'],
        );
        t.file(".hidden", b"x");
        t.file("Images/b.jpg", &[0xFF, 0xD8, 0xFF]);
        t.file("Thing.app/Contents/Info.plist", b"<plist/>");
        t.file("noext", b"%PDF-1.4");

        let snap = scan(
            t.path(),
            Options {
                hidden: false,
                recursive: true,
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        let find = |n: &str| snap.entries.iter().find(|e| e.name == n).unwrap();
        assert_eq!(snap.entries.len(), 5);
        assert_eq!(find("a.pdf").kind, Kind::Pdf);
        assert_eq!(
            find("Screenshot 2026-01-01 at 10.00.00.png").kind,
            Kind::Screenshot
        );
        assert_eq!(find("b.jpg").dir, "Images");
        assert!(find("Thing.app").package);
        assert_eq!(find("Thing.app").kind, Kind::Installer);
        assert_eq!(find("noext").kind, Kind::Pdf);

        let flat = scan(
            t.path(),
            Options {
                hidden: true,
                recursive: false,
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(flat.entries.iter().any(|e| e.name == ".hidden"));
        assert!(!flat.entries.iter().any(|e| e.name == "b.jpg"));
    }

    #[test]
    fn missing_root() {
        let err = scan(
            Path::new("/nonexistent/dropzone"),
            Options {
                hidden: false,
                recursive: true,
            },
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert_eq!(err.code, "missing");
    }
}
