use crate::model::{Entry, Failure, Kind, Outcome};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

const DAY_MS: i64 = 86_400_000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub conditions: Vec<Condition>,
    pub action: Action,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Condition {
    Kind { kinds: Vec<Kind> },
    Extension { extensions: Vec<String> },
    Name { text: String },
    Source { text: String },
    OlderThan { days: u32 },
    LargerThan { megabytes: u64 },
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Grouping {
    None,
    Year,
    Month,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Action {
    Move { folder: String, group: Grouping },
    Trash,
}

static SEQ: AtomicU32 = AtomicU32::new(0);

pub fn new_id(prefix: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!(
        "{prefix}{:x}{:x}",
        nanos,
        SEQ.fetch_add(1, Ordering::Relaxed)
    )
}

fn sort_into(name: &str, folder: &str, kinds: &[Kind]) -> Rule {
    Rule {
        id: new_id("r"),
        name: name.into(),
        enabled: true,
        conditions: vec![Condition::Kind {
            kinds: kinds.to_vec(),
        }],
        action: Action::Move {
            folder: folder.into(),
            group: Grouping::None,
        },
    }
}

pub fn defaults() -> Vec<Rule> {
    vec![
        sort_into("Screenshots", "Screenshots", &[Kind::Screenshot]),
        sort_into("Images", "Images", &[Kind::Image]),
        sort_into("Videos", "Videos", &[Kind::Video]),
        sort_into("Audio", "Audio", &[Kind::Audio]),
        sort_into(
            "Documents",
            "Documents",
            &[
                Kind::Pdf,
                Kind::Document,
                Kind::Spreadsheet,
                Kind::Presentation,
                Kind::Ebook,
            ],
        ),
        sort_into("Archives", "Archives", &[Kind::Archive]),
        sort_into("Installers", "Installers", &[Kind::Installer]),
        sort_into("Code", "Code", &[Kind::Code]),
        sort_into("Fonts", "Fonts", &[Kind::Font]),
        sort_into("Design files", "Design", &[Kind::Design]),
    ]
}

pub fn validate(rule: &mut Rule) -> Outcome<()> {
    rule.name = rule.name.trim().to_string();
    if rule.name.is_empty() {
        return Err(Failure::new("invalidrule", "name"));
    }
    if rule.conditions.is_empty() {
        return Err(Failure::new("invalidrule", "conditions"));
    }
    for c in &mut rule.conditions {
        match c {
            Condition::Kind { kinds } if kinds.is_empty() => {
                return Err(Failure::new("invalidrule", "kinds"))
            }
            Condition::Extension { extensions } => {
                *extensions = extensions
                    .iter()
                    .map(|e| e.trim().trim_start_matches('.').to_lowercase())
                    .filter(|e| !e.is_empty())
                    .collect();
                if extensions.is_empty() {
                    return Err(Failure::new("invalidrule", "extensions"));
                }
            }
            Condition::Name { text } | Condition::Source { text } => {
                *text = text.trim().to_string();
                if text.is_empty() {
                    return Err(Failure::new("invalidrule", "text"));
                }
            }
            _ => {}
        }
    }
    if let Action::Move { folder, .. } = &mut rule.action {
        *folder = folder.trim().trim_end_matches('/').to_string();
        if !valid_folder(folder) {
            return Err(Failure::new("invalidrule", "folder"));
        }
    }
    if rule.id.is_empty() {
        rule.id = new_id("r");
    }
    Ok(())
}

fn valid_folder(folder: &str) -> bool {
    if folder.is_empty() {
        return false;
    }
    let p = Path::new(folder);
    if p.is_absolute() {
        return p.components().all(|c| !matches!(c, Component::ParentDir));
    }
    p.components().all(|c| matches!(c, Component::Normal(_)))
}

pub fn matches(rule: &Rule, e: &Entry, now: i64) -> bool {
    rule.enabled
        && !rule.conditions.is_empty()
        && rule.conditions.iter().all(|c| condition(c, e, now))
}

fn condition(c: &Condition, e: &Entry, now: i64) -> bool {
    match c {
        Condition::Kind { kinds } => kinds.contains(&e.kind),
        Condition::Extension { extensions } => extensions.contains(&e.ext),
        Condition::Name { text } => name_matches(&e.name, text),
        Condition::Source { text } => e
            .from
            .as_deref()
            .is_some_and(|f| f.contains(&text.to_lowercase())),
        Condition::OlderThan { days } => now - e.added >= *days as i64 * DAY_MS,
        Condition::LargerThan { megabytes } => e.size > megabytes * 1_000_000,
    }
}

pub fn name_matches(name: &str, pattern: &str) -> bool {
    let name = name.to_lowercase();
    let pattern = pattern.to_lowercase();
    if pattern.contains('*') || pattern.contains('?') {
        glob(name.as_bytes(), pattern.as_bytes())
    } else {
        name.contains(&pattern)
    }
}

fn glob(s: &[u8], p: &[u8]) -> bool {
    let (mut si, mut pi, mut star, mut mark) = (0, 0, None, 0);
    while si < s.len() {
        if pi < p.len() && (p[pi] == b'?' || p[pi] == s[si]) {
            si += 1;
            pi += 1;
        } else if pi < p.len() && p[pi] == b'*' {
            star = Some(pi);
            mark = si;
            pi += 1;
        } else if let Some(st) = star {
            pi = st + 1;
            mark += 1;
            si = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == b'*' {
        pi += 1;
    }
    pi == p.len()
}

pub fn destination(root: &Path, folder: &str, group: Grouping, added: i64) -> PathBuf {
    let base = if Path::new(folder).is_absolute() {
        PathBuf::from(folder)
    } else {
        root.join(folder)
    };
    match group {
        Grouping::None => base,
        Grouping::Year => base.join(format!("{}", local_date(added).0)),
        Grouping::Month => {
            let (y, m) = local_date(added);
            base.join(format!("{y}-{m:02}"))
        }
    }
}

fn local_date(ms: i64) -> (i32, u32) {
    let secs = (ms / 1000) as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    if unsafe { libc::localtime_r(&secs, &mut tm) }.is_null() {
        return (1970, 1);
    }
    (tm.tm_year + 1900, (tm.tm_mon + 1) as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, kind: Kind, size: u64, added: i64) -> Entry {
        Entry {
            path: format!("/x/{name}"),
            name: name.into(),
            dir: String::new(),
            ext: crate::kinds::extension(name),
            kind,
            size,
            modified: added,
            added,
            from: Some("github.com".into()),
            package: false,
            project: None,
        }
    }

    #[test]
    fn conditions_all_must_match() {
        let now = 100 * DAY_MS;
        let mut rule = sort_into("Old big installers", "Installers", &[Kind::Installer]);
        rule.conditions.push(Condition::OlderThan { days: 30 });
        rule.conditions
            .push(Condition::LargerThan { megabytes: 10 });
        assert!(matches(
            &rule,
            &entry("a.dmg", Kind::Installer, 20_000_000, 10 * DAY_MS),
            now
        ));
        assert!(!matches(
            &rule,
            &entry("a.dmg", Kind::Installer, 20_000_000, 90 * DAY_MS),
            now
        ));
        assert!(!matches(
            &rule,
            &entry("a.dmg", Kind::Installer, 5_000_000, 10 * DAY_MS),
            now
        ));
        rule.enabled = false;
        assert!(!matches(
            &rule,
            &entry("a.dmg", Kind::Installer, 20_000_000, 10 * DAY_MS),
            now
        ));
    }

    #[test]
    fn names_and_sources() {
        assert!(name_matches("Invoice-2026.pdf", "invoice"));
        assert!(name_matches("Invoice-2026.pdf", "invoice*.pdf"));
        assert!(!name_matches("Invoice-2026.pdf", "*.zip"));
        assert!(name_matches("a.tar.gz", "*.tar.?z"));
        let r = Rule {
            id: "x".into(),
            name: "From GitHub".into(),
            enabled: true,
            conditions: vec![Condition::Source {
                text: "GitHub".into(),
            }],
            action: Action::Trash,
        };
        assert!(matches(&r, &entry("x.zip", Kind::Archive, 1, 0), 0));
    }

    #[test]
    fn validation() {
        let mut bad = sort_into("x", "../escape", &[Kind::Image]);
        assert!(validate(&mut bad).is_err());
        let mut abs = sort_into("x", "/Users/someone/Pictures/", &[Kind::Image]);
        assert!(validate(&mut abs).is_ok());
        assert_eq!(
            abs.action,
            Action::Move {
                folder: "/Users/someone/Pictures".into(),
                group: Grouping::None
            }
        );
        let mut ext = Rule {
            conditions: vec![Condition::Extension {
                extensions: vec![" .PDF ".into(), "".into()],
            }],
            ..sort_into("x", "Docs", &[])
        };
        validate(&mut ext).unwrap();
        assert_eq!(
            ext.conditions,
            vec![Condition::Extension {
                extensions: vec!["pdf".into()]
            }]
        );
        let mut empty = sort_into("x", "Docs", &[]);
        assert!(validate(&mut empty).is_err());
    }

    #[test]
    fn grouping() {
        let root = Path::new("/r");
        assert_eq!(
            destination(root, "Images", Grouping::None, 0),
            PathBuf::from("/r/Images")
        );
        let d = destination(root, "Images", Grouping::Month, 1_760_000_000_000);
        assert!(d.display().to_string().starts_with("/r/Images/2025-"));
        assert_eq!(
            destination(root, "/abs", Grouping::None, 0),
            PathBuf::from("/abs")
        );
    }
}
