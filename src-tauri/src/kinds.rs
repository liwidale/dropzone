use crate::model::Kind;
use std::fs::File;
use std::io::Read;
use std::path::Path;

const TABLE: &[(Kind, &[&str])] = &[
    (
        Kind::Image,
        &[
            "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp", "svg",
            "ico", "icns", "avif", "jxl", "dng", "raw", "cr2", "cr3", "nef", "arw", "orf", "rw2",
            "raf", "srw", "pef",
        ],
    ),
    (
        Kind::Video,
        &[
            "mp4", "mov", "m4v", "mkv", "avi", "webm", "wmv", "flv", "mpg", "mpeg", "3gp", "mts",
            "m2ts", "vob",
        ],
    ),
    (
        Kind::Audio,
        &[
            "mp3", "m4a", "aac", "wav", "flac", "aif", "aiff", "ogg", "oga", "opus", "wma", "alac",
            "mid", "midi", "m4b", "caf",
        ],
    ),
    (Kind::Pdf, &["pdf"]),
    (
        Kind::Document,
        &[
            "doc", "docx", "pages", "txt", "rtf", "rtfd", "md", "markdown", "odt", "tex", "wpd",
            "eml", "msg", "vcf", "ics",
        ],
    ),
    (
        Kind::Spreadsheet,
        &["xls", "xlsx", "xlsm", "numbers", "csv", "tsv", "ods"],
    ),
    (Kind::Presentation, &["ppt", "pptx", "key", "odp"]),
    (
        Kind::Archive,
        &[
            "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "tbz", "tbz2", "xz", "txz", "zst", "lz",
            "lz4", "lzma", "cab", "sit", "sitx", "iso", "cpio",
        ],
    ),
    (
        Kind::Installer,
        &[
            "dmg", "pkg", "mpkg", "app", "exe", "msi", "deb", "rpm", "apk", "appimage", "xip",
            "ipa", "vsix", "crx", "xpi",
        ],
    ),
    (
        Kind::Code,
        &[
            "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "kt", "swift",
            "c", "h", "cc", "cpp", "hpp", "m", "mm", "cs", "php", "html", "htm", "css", "scss",
            "less", "json", "xml", "yaml", "yml", "toml", "ini", "sh", "zsh", "bash", "fish",
            "ps1", "ipynb", "sql", "lua", "dart", "vue", "svelte", "r", "pl", "scala", "zig",
            "patch", "diff",
        ],
    ),
    (Kind::Font, &["ttf", "otf", "woff", "woff2", "ttc", "dfont"]),
    (
        Kind::Ebook,
        &[
            "epub", "mobi", "azw", "azw3", "fb2", "djvu", "ibooks", "cbz", "cbr",
        ],
    ),
    (
        Kind::Design,
        &[
            "psd",
            "psb",
            "ai",
            "eps",
            "sketch",
            "fig",
            "xd",
            "indd",
            "afdesign",
            "afphoto",
            "afpub",
            "procreate",
            "blend",
            "obj",
            "fbx",
            "stl",
            "usdz",
            "3mf",
            "c4d",
            "dwg",
            "dxf",
        ],
    ),
    (
        Kind::Partial,
        &[
            "crdownload",
            "part",
            "partial",
            "download",
            "opdownload",
            "!ut",
            "fdmdownload",
        ],
    ),
];

const PACKAGES: &[&str] = &[
    "app",
    "bundle",
    "framework",
    "plugin",
    "kext",
    "photoslibrary",
    "musiclibrary",
    "tvlibrary",
    "rtfd",
    "pages",
    "numbers",
    "key",
    "xcodeproj",
    "xcworkspace",
    "playground",
    "download",
    "sparsebundle",
    "fcpbundle",
    "logicx",
    "band",
    "imovielibrary",
    "mpkg",
    "pkg",
    "xcarchive",
    "scptd",
    "workflow",
    "lpdf",
    "theater",
    "prproj",
    "aplibrary",
    "saver",
    "prefpane",
    "qlgenerator",
    "docset",
];

const SCREENSHOT_PREFIXES: &[&str] = &[
    "screenshot",
    "screen shot",
    "cleanshot",
    "снимок экрана",
    "bildschirmfoto",
    "capture d’écran",
    "capture d'écran",
    "captura de pantalla",
    "schermata",
    "スクリーンショット",
    "屏幕快照",
    "截屏",
    "zrzut ekranu",
    "skärmavbild",
    "skjermbilde",
    "schermafbeelding",
];

pub fn by_extension(ext: &str) -> Option<Kind> {
    TABLE
        .iter()
        .find(|(_, list)| list.contains(&ext))
        .map(|(k, _)| *k)
}

pub fn is_package(ext: &str) -> bool {
    PACKAGES.contains(&ext)
}

pub fn extension(name: &str) -> String {
    match name.rfind('.') {
        Some(i) if i > 0 && i + 1 < name.len() => name[i + 1..].to_lowercase(),
        _ => String::new(),
    }
}

pub fn looks_like_screenshot(name: &str) -> bool {
    let lower = name.to_lowercase();
    SCREENSHOT_PREFIXES.iter().any(|p| lower.starts_with(p))
}

pub fn classify(path: &Path, name: &str, ext: &str, is_dir: bool, screen_capture: bool) -> Kind {
    if is_dir {
        return if ext == "download" {
            Kind::Partial
        } else {
            by_extension(ext).unwrap_or(Kind::Other)
        };
    }
    let kind = by_extension(ext)
        .or_else(|| sniff(path))
        .unwrap_or(Kind::Other);
    if kind == Kind::Image && (screen_capture || looks_like_screenshot(name)) {
        Kind::Screenshot
    } else {
        kind
    }
}

fn sniff(path: &Path) -> Option<Kind> {
    let mut head = [0u8; 512];
    let n = File::open(path).and_then(|mut f| f.read(&mut head)).ok()?;
    sniff_bytes(&head[..n])
}

pub fn sniff_bytes(b: &[u8]) -> Option<Kind> {
    let starts = |sig: &[u8]| b.starts_with(sig);
    if b.is_empty() {
        return None;
    }
    if starts(b"%PDF") {
        return Some(Kind::Pdf);
    }
    if starts(&[0x89, b'P', b'N', b'G'])
        || starts(&[0xFF, 0xD8, 0xFF])
        || starts(b"GIF8")
        || starts(b"II*\0")
        || starts(b"MM\0*")
    {
        return Some(Kind::Image);
    }
    if b.len() >= 12 && &b[0..4] == b"RIFF" {
        return match &b[8..12] {
            b"WEBP" => Some(Kind::Image),
            b"WAVE" => Some(Kind::Audio),
            b"AVI " => Some(Kind::Video),
            _ => None,
        };
    }
    if b.len() >= 12 && &b[4..8] == b"ftyp" {
        return match &b[8..12] {
            b"heic" | b"heix" | b"mif1" | b"avif" => Some(Kind::Image),
            b"M4A " | b"M4B " => Some(Kind::Audio),
            _ => Some(Kind::Video),
        };
    }
    if starts(b"ID3")
        || starts(b"fLaC")
        || starts(b"OggS")
        || starts(b"FORM")
        || (b.len() > 1 && b[0] == 0xFF && b[1] & 0xE0 == 0xE0)
    {
        return Some(Kind::Audio);
    }
    if starts(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return Some(Kind::Video);
    }
    if starts(b"PK\x03\x04")
        || starts(b"Rar!")
        || starts(&[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C])
        || starts(&[0x1F, 0x8B])
        || starts(b"BZh")
        || starts(&[0xFD, b'7', b'z', b'X', b'Z'])
        || starts(&[0x28, 0xB5, 0x2F, 0xFD])
    {
        return Some(Kind::Archive);
    }
    if starts(b"xar!") || starts(b"MZ") {
        return Some(Kind::Installer);
    }
    if starts(b"{\\rtf") || starts(b"%!PS") {
        return Some(Kind::Document);
    }
    if starts(b"8BPS") {
        return Some(Kind::Design);
    }
    if starts(b"wOFF") || starts(b"wOF2") || starts(b"OTTO") || starts(&[0, 1, 0, 0, 0]) {
        return Some(Kind::Font);
    }
    if !b.contains(&0) && std::str::from_utf8(b).is_ok() {
        return Some(Kind::Document);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensions() {
        assert_eq!(extension("photo.JPG"), "jpg");
        assert_eq!(extension(".zshrc"), "");
        assert_eq!(extension("README"), "");
        assert_eq!(extension("archive.tar.gz"), "gz");
        assert_eq!(by_extension("dmg"), Some(Kind::Installer));
        assert_eq!(by_extension("crdownload"), Some(Kind::Partial));
    }

    #[test]
    fn screenshots() {
        assert!(looks_like_screenshot(
            "Screenshot 2026-10-01 at 10.00.00.png"
        ));
        assert!(looks_like_screenshot(
            "Снимок экрана 2026-10-01 в 10.00.00.png"
        ));
        assert!(!looks_like_screenshot("holiday.png"));
    }

    #[test]
    fn sniffing() {
        assert_eq!(sniff_bytes(b"%PDF-1.7\n"), Some(Kind::Pdf));
        assert_eq!(
            sniff_bytes(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A]),
            Some(Kind::Image)
        );
        assert_eq!(sniff_bytes(b"PK\x03\x04rest"), Some(Kind::Archive));
        assert_eq!(sniff_bytes(b"\0\0\0\x18ftypheic"), Some(Kind::Image));
        assert_eq!(sniff_bytes(b"\0\0\0\x18ftypisom"), Some(Kind::Video));
        assert_eq!(sniff_bytes(b"plain notes"), Some(Kind::Document));
        assert_eq!(sniff_bytes(&[0, 159, 146, 150]), None);
    }
}
