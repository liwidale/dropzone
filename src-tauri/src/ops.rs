use crate::rules::new_id;
use crate::scan::TEMP_PREFIX;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const COMPOUND: &[&str] = &[".tar.gz", ".tar.bz2", ".tar.xz", ".tar.zst"];

pub fn split_name(name: &str) -> (&str, &str) {
    let lower = name.to_lowercase();
    if let Some(c) = COMPOUND
        .iter()
        .find(|c| lower.ends_with(*c) && lower.len() > c.len())
    {
        let i = name.len() - c.len();
        return name.split_at(i);
    }
    match name.rfind('.') {
        Some(i) if i > 0 => name.split_at(i),
        _ => (name, ""),
    }
}

pub fn numbered(name: &str, n: u32) -> String {
    let (stem, ext) = split_name(name);
    format!("{stem} {n}{ext}")
}

pub fn exists(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok()
}

pub fn free_path(dir: &Path, name: &str, taken: impl Fn(&str) -> bool) -> PathBuf {
    if !taken(name) && !exists(&dir.join(name)) {
        return dir.join(name);
    }
    (2..u32::MAX)
        .map(|n| numbered(name, n))
        .find(|candidate| !taken(candidate) && !exists(&dir.join(candidate)))
        .map(|candidate| dir.join(candidate))
        .unwrap_or_else(|| dir.join(format!("{} {}", name, new_id(""))))
}

#[cfg(target_os = "macos")]
fn rename_exclusive(from: &Path, to: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    extern "C" {
        fn renamex_np(
            from: *const libc::c_char,
            to: *const libc::c_char,
            flags: libc::c_uint,
        ) -> libc::c_int;
    }
    const RENAME_EXCL: libc::c_uint = 0x0000_0004;
    let a = CString::new(from.as_os_str().as_bytes())
        .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
    let b = CString::new(to.as_os_str().as_bytes())
        .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
    if unsafe { renamex_np(a.as_ptr(), b.as_ptr(), RENAME_EXCL) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(target_os = "macos"))]
fn rename_exclusive(from: &Path, to: &Path) -> io::Result<()> {
    if exists(to) {
        return Err(io::Error::from(io::ErrorKind::AlreadyExists));
    }
    fs::rename(from, to)
}

pub fn move_item(src: &Path, dst: &Path) -> io::Result<()> {
    match rename_exclusive(src, dst) {
        Err(e) if e.raw_os_error() == Some(libc::EXDEV) => move_across_volumes(src, dst),
        other => other,
    }
}

fn move_across_volumes(src: &Path, dst: &Path) -> io::Result<()> {
    let parent = dst
        .parent()
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    let tmp = parent.join(format!("{TEMP_PREFIX}{}", new_id("")));
    let staged = copy_tree(src, &tmp).and_then(|_| {
        if tree_size(src)? == tree_size(&tmp)? {
            Ok(())
        } else {
            Err(io::Error::other("copy is incomplete"))
        }
    });
    if let Err(e) = staged.and_then(|_| rename_exclusive(&tmp, dst)) {
        let _ = remove_tree(&tmp);
        return Err(e);
    }
    if let Err(e) = remove_tree(src) {
        if exists(src) {
            let _ = remove_tree(dst);
        }
        return Err(e);
    }
    Ok(())
}

fn copy_tree(src: &Path, dst: &Path) -> io::Result<()> {
    let md = fs::symlink_metadata(src)?;
    if md.file_type().is_symlink() {
        std::os::unix::fs::symlink(fs::read_link(src)?, dst)
    } else if md.is_dir() {
        fs::create_dir(dst)?;
        for item in fs::read_dir(src)? {
            let item = item?;
            copy_tree(&item.path(), &dst.join(item.file_name()))?;
        }
        fs::set_permissions(dst, md.permissions())
    } else {
        fs::copy(src, dst).map(|_| ())
    }
}

fn tree_size(p: &Path) -> io::Result<u64> {
    let md = fs::symlink_metadata(p)?;
    if !md.is_dir() {
        return Ok(if md.file_type().is_symlink() {
            0
        } else {
            md.len()
        });
    }
    let mut total = 0;
    for item in fs::read_dir(p)? {
        total += tree_size(&item?.path())?;
    }
    Ok(total)
}

fn remove_tree(p: &Path) -> io::Result<()> {
    if fs::symlink_metadata(p)?.is_dir() {
        fs::remove_dir_all(p)
    } else {
        fs::remove_file(p)
    }
}

pub fn remove_if_empty(dir: &Path) -> bool {
    let Ok(read) = fs::read_dir(dir) else {
        return false;
    };
    let names: Vec<_> = read.flatten().map(|e| e.file_name()).collect();
    if names.iter().any(|n| n != ".DS_Store") {
        return false;
    }
    if !names.is_empty() {
        let _ = fs::remove_file(dir.join(".DS_Store"));
    }
    fs::remove_dir(dir).is_ok()
}

pub fn create_dirs(dir: &Path, created: &mut Vec<PathBuf>) -> io::Result<()> {
    let mut missing = Vec::new();
    let mut cur = Some(dir);
    while let Some(d) = cur {
        if exists(d) {
            break;
        }
        missing.push(d.to_path_buf());
        cur = d.parent();
    }
    for d in missing.into_iter().rev() {
        match fs::create_dir(&d) {
            Ok(()) => created.push(d),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e),
        }
    }
    if fs::metadata(dir)?.is_dir() {
        Ok(())
    } else {
        Err(io::Error::from(io::ErrorKind::NotADirectory))
    }
}

#[cfg(target_os = "macos")]
pub fn trash(path: &Path) -> io::Result<Option<PathBuf>> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    fs::symlink_metadata(path)?;
    objc2::rc::autoreleasepool(|_| {
        let fm = NSFileManager::defaultManager();
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let mut out = None;
        match fm.trashItemAtURL_resultingItemURL_error(&url, Some(&mut out)) {
            Ok(()) => Ok(out
                .and_then(|u| u.path())
                .map(|p| PathBuf::from(p.to_string()))),
            Err(err) => {
                let kind = match err.code() {
                    4 => io::ErrorKind::NotFound,
                    257 | 513 => io::ErrorKind::PermissionDenied,
                    _ => io::ErrorKind::Other,
                };
                Err(io::Error::new(kind, err.localizedDescription().to_string()))
            }
        }
    })
}

#[cfg(not(target_os = "macos"))]
pub fn trash(_: &Path) -> io::Result<Option<PathBuf>> {
    Err(io::Error::from(io::ErrorKind::Unsupported))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    #[test]
    fn names() {
        assert_eq!(numbered("photo.jpg", 2), "photo 2.jpg");
        assert_eq!(numbered("archive.tar.gz", 3), "archive 3.tar.gz");
        assert_eq!(numbered("README", 2), "README 2");
        assert_eq!(numbered(".env", 2), ".env 2");
    }

    #[test]
    fn free_paths_skip_existing_and_reserved() {
        let t = TempDir::new("free");
        t.file("a.txt", b"1");
        t.file("a 2.txt", b"2");
        let p = free_path(t.path(), "a.txt", |n| n == "a 3.txt");
        assert_eq!(p, t.path().join("a 4.txt"));
        assert_eq!(
            free_path(t.path(), "b.txt", |_| false),
            t.path().join("b.txt")
        );
    }

    #[test]
    fn move_never_overwrites() {
        let t = TempDir::new("move");
        let a = t.file("a.txt", b"one");
        let b = t.file("b.txt", b"two");
        let err = move_item(&a, &b).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&b).unwrap(), b"two");
        let c = t.path().join("sub/c.txt");
        let mut created = Vec::new();
        create_dirs(c.parent().unwrap(), &mut created).unwrap();
        assert_eq!(created, vec![t.path().join("sub")]);
        move_item(&a, &c).unwrap();
        assert!(!a.exists());
        assert_eq!(fs::read(&c).unwrap(), b"one");
    }

    #[test]
    fn copies_trees() {
        let t = TempDir::new("copy");
        t.file("Pkg.app/Contents/MacOS/bin", b"binary");
        t.file("Pkg.app/Contents/Info.plist", b"<plist/>");
        let dst = t.path().join("out");
        fs::create_dir(&dst).unwrap();
        move_across_volumes(&t.path().join("Pkg.app"), &dst.join("Pkg.app")).unwrap();
        assert!(!t.path().join("Pkg.app").exists());
        assert_eq!(
            fs::read(dst.join("Pkg.app/Contents/MacOS/bin")).unwrap(),
            b"binary"
        );
        assert!(fs::read_dir(&dst)
            .unwrap()
            .flatten()
            .all(|e| !e.file_name().to_string_lossy().starts_with(TEMP_PREFIX)));
    }

    #[test]
    fn empty_dirs_with_ds_store() {
        let t = TempDir::new("empty");
        t.file("d/.DS_Store", b"x");
        assert!(remove_if_empty(&t.path().join("d")));
        t.file("e/file", b"x");
        assert!(!remove_if_empty(&t.path().join("e")));
    }
}
