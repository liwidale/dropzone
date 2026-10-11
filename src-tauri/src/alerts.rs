use crate::engine::{lock, Core};
use crate::store::{Batch, OpAction, OpStatus};
use std::collections::BTreeMap;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

#[cfg(windows)]
pub const TRASH: &str = "the Recycle Bin";
#[cfg(not(windows))]
pub const TRASH: &str = "the Trash";

fn files(n: usize) -> String {
    if n == 1 {
        "1 file".into()
    } else {
        format!("{n} files")
    }
}

pub fn summary(batch: &Batch) -> String {
    let mut places: BTreeMap<String, usize> = BTreeMap::new();
    for op in batch.ops.iter().filter(|o| o.status == OpStatus::Done) {
        let place = match op.action {
            OpAction::Trash => TRASH.to_string(),
            OpAction::Delete => "deleted".to_string(),
            _ => op
                .target
                .as_deref()
                .and_then(|t| Path::new(t).parent())
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
        };
        *places.entry(place).or_default() += 1;
    }
    let parts: Vec<String> = places
        .into_iter()
        .map(|(place, n)| {
            if place == "deleted" {
                format!("{} deleted", files(n))
            } else {
                format!("{} to {place}", n)
            }
        })
        .collect();
    format!("{}. You can undo it in History.", parts.join(", "))
}

pub fn done(batch: &Batch) -> usize {
    batch
        .ops
        .iter()
        .filter(|o| o.status == OpStatus::Done)
        .count()
}

pub fn send(app: &AppHandle, core: &Core, title: String, body: String) {
    if !lock(&core.config).settings.notify {
        return;
    }
    let _ = app.notification().builder().title(title).body(body).show();
}

pub fn folder_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

pub fn sorted_title(batch: &Batch) -> String {
    let n = done(batch);
    format!(
        "Sorted {} in {}",
        if n == 1 {
            "1 new file".into()
        } else {
            format!("{n} new files")
        },
        folder_name(&batch.folder)
    )
}

pub fn cleaned_title(batch: &Batch) -> String {
    format!(
        "Cleaned up {} in {}",
        files(done(batch)),
        folder_name(&batch.folder)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{BatchKind, OpRecord};

    #[test]
    fn summarizes_destinations() {
        let op = |action, target: Option<&str>| OpRecord {
            action,
            source: "/d/x".into(),
            target: target.map(Into::into),
            size: 1,
            modified: 0,
            status: OpStatus::Done,
            failure: None,
            restored_to: None,
        };
        let batch = Batch {
            id: "b".into(),
            folder: "/Users/a/Downloads".into(),
            kind: BatchKind::Auto,
            created: 0,
            finished: None,
            interrupted: false,
            ops: vec![
                op(OpAction::Move, Some("/Users/a/Downloads/Images/a.png")),
                op(OpAction::Move, Some("/Users/a/Downloads/Images/b.png")),
                op(OpAction::Move, Some("/Users/a/Downloads/Documents/c.pdf")),
            ],
            created_dirs: vec![],
            undone_at: None,
        };
        assert_eq!(
            summary(&batch),
            "1 to Documents, 2 to Images. You can undo it in History."
        );
        assert_eq!(sorted_title(&batch), "Sorted 3 new files in Downloads");
    }
}
