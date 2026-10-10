use serde::{Deserialize, Serialize};
use std::io;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Image,
    Screenshot,
    Video,
    Audio,
    Pdf,
    Document,
    Spreadsheet,
    Presentation,
    Archive,
    Installer,
    Code,
    Font,
    Ebook,
    Design,
    Partial,
    Other,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub dir: String,
    pub ext: String,
    pub kind: Kind,
    pub size: u64,
    pub modified: i64,
    pub added: i64,
    pub from: Option<String>,
    pub package: bool,
    pub project: Option<String>,
}

impl Entry {
    pub fn top_level(&self) -> bool {
        self.dir.is_empty()
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub root: String,
    pub entries: Vec<Entry>,
    pub total_size: u64,
    pub truncated: bool,
    pub unreadable: u32,
    pub scanned_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub code: String,
    pub detail: String,
}

impl Failure {
    pub fn new(code: &str, detail: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            detail: detail.into(),
        }
    }

    pub fn io(e: &io::Error) -> Self {
        let code = match e.kind() {
            io::ErrorKind::NotFound => "missing",
            io::ErrorKind::PermissionDenied => "permission",
            io::ErrorKind::AlreadyExists => "exists",
            io::ErrorKind::StorageFull => "full",
            io::ErrorKind::ReadOnlyFilesystem => "readonly",
            _ => match e.raw_os_error() {
                Some(libc::EPERM) | Some(libc::EACCES) => "permission",
                Some(libc::EBUSY) => "busy",
                Some(libc::ENOSPC) => "full",
                Some(libc::EROFS) => "readonly",
                Some(libc::EEXIST) => "exists",
                _ => "io",
            },
        };
        Self::new(code, e.to_string())
    }
}

impl From<io::Error> for Failure {
    fn from(e: io::Error) -> Self {
        Self::io(&e)
    }
}

pub type Outcome<T> = Result<T, Failure>;

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn time_ms(t: std::io::Result<std::time::SystemTime>) -> i64 {
    t.ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
