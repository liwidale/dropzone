use crate::model::{Entry, Kind};
use serde::Serialize;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io;
use std::path::{Component, Path, PathBuf};

const ZIP_CHECK_LIMIT: usize = 4000;

const NOISE: &[&str] = &[
    "setup",
    "installer",
    "install",
    "mac",
    "macos",
    "osx",
    "darwin",
    "universal",
    "arm",
    "arm64",
    "aarch64",
    "x64",
    "x86",
    "amd64",
    "intel",
    "win",
    "win32",
    "win64",
    "windows",
    "linux",
    "latest",
    "stable",
    "release",
    "beta",
    "full",
    "offline",
    "online",
    "update",
];

const INSTALLER_EXTENSIONS: &[&str] = &[
    "dmg", "pkg", "mpkg", "app", "exe", "msi", "deb", "rpm", "appimage", "xip",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Extracted {
    pub archive: String,
    pub folder: String,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub extracted: Vec<Extracted>,
    pub installed: Vec<String>,
}

pub fn analyze(entries: &[Entry]) -> Insights {
    let apps = installed_apps();
    let installed = entries
        .iter()
        .filter(|e| e.kind == Kind::Installer && e.project.is_none())
        .filter(|e| installer_token(&e.name).is_some_and(|t| apps.iter().any(|a| same_app(&t, a))))
        .map(|e| e.path.clone())
        .collect();
    let extracted = entries
        .iter()
        .filter(|e| e.ext == "zip" && e.project.is_none())
        .filter_map(|e| extracted_folder(Path::new(&e.path)).map(|f| (e, f)))
        .map(|(e, folder)| Extracted {
            archive: e.path.clone(),
            folder: folder.display().to_string(),
        })
        .collect();
    Insights {
        extracted,
        installed,
    }
}

fn normalize(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

pub fn installer_token(name: &str) -> Option<String> {
    let lower = name.to_lowercase();
    let stem = INSTALLER_EXTENSIONS
        .iter()
        .find_map(|ext| lower.strip_suffix(&format!(".{ext}")))
        .unwrap_or(&lower);
    let mut parts = Vec::new();
    for part in stem
        .split(|c: char| !c.is_alphanumeric())
        .filter(|p| !p.is_empty())
    {
        if part.chars().any(|c| c.is_ascii_digit())
            || NOISE.contains(&part)
            || (part.len() == 1 && part == "v")
        {
            break;
        }
        parts.push(part);
    }
    let token = parts.concat();
    (token.chars().count() >= 3).then_some(token)
}

fn same_app(token: &str, app: &str) -> bool {
    if app.chars().count() < 3 {
        return false;
    }
    token == app
        || (app.len() >= 4 && token.starts_with(app))
        || (token.len() >= 4 && app.starts_with(token))
}

fn names_in(dir: &Path, suffix: &str, recursive: bool, out: &mut HashSet<String>) {
    let Ok(read) = fs::read_dir(dir) else { return };
    for item in read.flatten() {
        let name = item.file_name().to_string_lossy().into_owned();
        let is_dir = item.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if let Some(stem) = name.strip_suffix(suffix) {
            let n = normalize(stem);
            if !n.is_empty() {
                out.insert(n);
            }
        } else if recursive && is_dir {
            names_in(&item.path(), suffix, true, out);
        }
    }
}

#[cfg(target_os = "macos")]
fn installed_apps() -> HashSet<String> {
    let mut out = HashSet::new();
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    for dir in [
        PathBuf::from("/Applications"),
        PathBuf::from("/Applications/Utilities"),
        PathBuf::from("/System/Applications"),
        home.join("Applications"),
    ] {
        names_in(&dir, ".app", false, &mut out);
    }
    out
}

#[cfg(windows)]
fn installed_apps() -> HashSet<String> {
    let mut out = HashSet::new();
    let var = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let start = Path::new("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs");
    for base in [var("ProgramData"), var("APPDATA")].into_iter().flatten() {
        names_in(&base.join(&start), ".lnk", true, &mut out);
    }
    if let Some(local) = var("LOCALAPPDATA") {
        if let Ok(read) = fs::read_dir(local.join("Programs")) {
            for item in read.flatten() {
                out.insert(normalize(&item.file_name().to_string_lossy()));
            }
        }
    }
    out
}

#[cfg(target_os = "linux")]
fn installed_apps() -> HashSet<String> {
    let mut out = HashSet::new();
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    for dir in [
        PathBuf::from("/usr/share/applications"),
        PathBuf::from("/usr/local/share/applications"),
        PathBuf::from("/var/lib/flatpak/exports/share/applications"),
        PathBuf::from("/var/lib/snapd/desktop/applications"),
        home.join(".local/share/applications"),
    ] {
        let Ok(read) = fs::read_dir(&dir) else {
            continue;
        };
        for item in read.flatten() {
            let name = item.file_name().to_string_lossy().into_owned();
            let Some(stem) = name.strip_suffix(".desktop") else {
                continue;
            };
            out.insert(normalize(stem.rsplit('.').next().unwrap_or(stem)));
            if let Ok(text) = fs::read_to_string(item.path()) {
                if let Some(n) = text.lines().find_map(|l| l.strip_prefix("Name=")) {
                    out.insert(normalize(n));
                }
            }
        }
    }
    out
}

fn archive_files(zip: &Path) -> Option<Vec<(PathBuf, u64)>> {
    let mut archive = zip::ZipArchive::new(File::open(zip).ok()?).ok()?;
    let mut files = Vec::new();
    for i in 0..archive.len().min(ZIP_CHECK_LIMIT) {
        let entry = archive.by_index_raw(i).ok()?;
        let Some(path) = entry.enclosed_name() else {
            continue;
        };
        if entry.is_dir() || path.starts_with("__MACOSX") || path.ends_with(".DS_Store") {
            continue;
        }
        files.push((path, entry.size()));
    }
    Some(files)
}

fn single_root(files: &[(PathBuf, u64)]) -> Option<PathBuf> {
    let first = files.first()?.0.components().next()?;
    let root = PathBuf::from(first.as_os_str());
    (files
        .iter()
        .all(|(p, _)| p.starts_with(&root) && p.components().count() > 1))
    .then_some(root)
}

fn extracted_folder(zip: &Path) -> Option<PathBuf> {
    let dir = zip.parent()?;
    let stem = zip.file_stem()?.to_string_lossy().into_owned();
    let files = archive_files(zip)?;
    if files.is_empty() {
        return None;
    }
    let root = single_root(&files);
    let mut candidates = vec![(dir.join(&stem), None)];
    if let Some(r) = &root {
        candidates.push((dir.join(r), Some(r.clone())));
        candidates.push((dir.join(&stem), Some(r.clone())));
    }
    for (folder, strip) in candidates {
        if !folder.is_dir() {
            continue;
        }
        let found = files
            .iter()
            .filter(|(p, size)| {
                let rel = strip
                    .as_ref()
                    .and_then(|s| p.strip_prefix(s).ok())
                    .unwrap_or(p);
                fs::metadata(folder.join(rel)).is_ok_and(|m| m.len() == *size)
            })
            .count();
        if found * 10 >= files.len() * 9 {
            return Some(folder);
        }
    }
    None
}

pub fn extract_target(zip: &Path) -> io::Result<(PathBuf, Option<PathBuf>)> {
    let files = archive_files(zip)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "not a readable zip archive"))?;
    let dir = zip
        .parent()
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    Ok(match single_root(&files) {
        Some(root) => (dir.join(&root), Some(root)),
        None => (dir.join(zip.file_stem().unwrap_or_default()), None),
    })
}

pub fn extract(zip: &Path, dest: &Path, strip: Option<&Path>) -> io::Result<()> {
    let mut archive = zip::ZipArchive::new(File::open(zip)?).map_err(io::Error::other)?;
    fs::create_dir(dest)?;
    let result = (|| -> io::Result<()> {
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(io::Error::other)?;
            let Some(path) = entry.enclosed_name() else {
                continue;
            };
            if path.starts_with("__MACOSX") {
                continue;
            }
            let rel = strip
                .and_then(|s| path.strip_prefix(s).ok())
                .unwrap_or(&path);
            if rel.as_os_str().is_empty()
                || rel.components().any(|c| !matches!(c, Component::Normal(_)))
            {
                continue;
            }
            let out = dest.join(rel);
            if entry.is_dir() {
                fs::create_dir_all(&out)?;
                continue;
            }
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&out)?;
            io::copy(&mut entry, &mut file)?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(dest);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;
    use std::io::Write;

    fn make_zip(path: &Path, files: &[(&str, &[u8])]) {
        let mut w = zip::ZipWriter::new(File::create(path).unwrap());
        for (name, data) in files {
            w.start_file(
                *name,
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Stored),
            )
            .unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap();
    }

    #[test]
    fn installer_names() {
        assert_eq!(installer_token("Figma-126.0.dmg").as_deref(), Some("figma"));
        assert_eq!(
            installer_token("Docker Desktop Installer.exe").as_deref(),
            Some("dockerdesktop")
        );
        assert_eq!(installer_token("Slack-4.41.pkg").as_deref(), Some("slack"));
        assert_eq!(
            installer_token("googlechrome.dmg").as_deref(),
            Some("googlechrome")
        );
        assert_eq!(
            installer_token("VSCode-darwin-universal.zip").as_deref(),
            Some("vscode")
        );
        assert_eq!(installer_token("x64.exe"), None);
        assert!(same_app("dockerdesktop", "docker"));
        assert!(same_app("googlechrome", "googlechrome"));
        assert!(!same_app("go", "go"));
        assert!(!same_app("figma", "zoom"));
    }

    #[test]
    fn finds_extracted_archives_and_extracts_safely() {
        let t = TempDir::new("zip");
        let zip_a = t.path().join("photos.zip");
        make_zip(&zip_a, &[("a.txt", b"one"), ("b/c.txt", b"three")]);
        t.file("photos/a.txt", b"one");
        t.file("photos/b/c.txt", b"three");
        let zip_b = t.path().join("project.zip");
        make_zip(
            &zip_b,
            &[
                ("project-main/readme.md", b"hi"),
                ("project-main/src/x.rs", b"fn"),
            ],
        );
        let zip_c = t.path().join("fresh.zip");
        make_zip(&zip_c, &[("only.txt", b"new"), ("../escape.txt", b"bad")]);

        assert_eq!(extracted_folder(&zip_a), Some(t.path().join("photos")));
        assert_eq!(extracted_folder(&zip_c), None);
        assert_eq!(extracted_folder(&zip_b), None);

        let (dest, strip) = extract_target(&zip_b).unwrap();
        assert_eq!(dest, t.path().join("project-main"));
        extract(&zip_b, &dest, strip.as_deref()).unwrap();
        assert_eq!(fs::read(dest.join("src/x.rs")).unwrap(), b"fn");
        assert_eq!(extracted_folder(&zip_b), Some(dest));

        let (dest, strip) = extract_target(&zip_c).unwrap();
        extract(&zip_c, &dest, strip.as_deref()).unwrap();
        assert!(dest.join("only.txt").exists());
        assert!(!t.path().join("escape.txt").exists());
    }
}
