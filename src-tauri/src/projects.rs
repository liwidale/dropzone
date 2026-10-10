use std::fs;
use std::path::{Path, PathBuf};

const MARKERS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    "package.json",
    "deno.json",
    "tsconfig.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "setup.py",
    "Pipfile",
    "requirements.txt",
    "Gemfile",
    "composer.json",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "build.sbt",
    "Package.swift",
    "Podfile",
    "CMakeLists.txt",
    "Makefile",
    "meson.build",
    "pubspec.yaml",
    "mix.exs",
    "stack.yaml",
    "dune-project",
    "flake.nix",
    "project.godot",
];

const MARKER_EXTENSIONS: &[&str] = &["xcodeproj", "xcworkspace", "sln", "csproj", "uproject"];

pub fn is_marker(name: &str) -> bool {
    MARKERS.contains(&name)
        || name
            .rsplit_once('.')
            .is_some_and(|(stem, ext)| !stem.is_empty() && MARKER_EXTENSIONS.contains(&ext))
}

pub fn marker_in(dir: &Path) -> Option<String> {
    fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .find(|n| is_marker(n))
}

pub fn project_of(path: &Path, root: &Path) -> Option<PathBuf> {
    let mut dir = path.parent()?;
    loop {
        if !dir.starts_with(root) {
            return None;
        }
        if marker_in(dir).is_some() {
            return Some(dir.to_path_buf());
        }
        if dir == root {
            return None;
        }
        dir = dir.parent()?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    #[test]
    fn markers() {
        assert!(is_marker("package.json"));
        assert!(is_marker("App.xcodeproj"));
        assert!(is_marker(".git"));
        assert!(!is_marker("photo.jpg"));
        assert!(!is_marker(".xcodeproj"));
    }

    #[test]
    fn finds_nearest_project() {
        let t = TempDir::new("projects");
        t.file("site/package.json", b"{}");
        let deep = t.file("site/src/app.js", b"1");
        let loose = t.file("notes/todo.txt", b"1");
        let top = t.file("script.py", b"1");
        assert_eq!(project_of(&deep, t.path()), Some(t.path().join("site")));
        assert_eq!(project_of(&loose, t.path()), None);
        assert_eq!(project_of(&top, t.path()), None);
        t.file(".git/HEAD", b"ref");
        assert_eq!(project_of(&top, t.path()), Some(t.path().to_path_buf()));
        assert_eq!(marker_in(t.path()).as_deref(), Some(".git"));
    }
}
