use crate::engine::{lock, ApplyRequest, Core, OpRequest};
use crate::store::{BatchKind, OpAction};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const QUIET: Duration = Duration::from_millis(700);
const SETTLE: Duration = Duration::from_millis(4_500);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Changed {
    folder: String,
}

pub struct Watch {
    watcher: Mutex<Option<RecommendedWatcher>>,
    tx: Sender<PathBuf>,
}

impl Watch {
    pub fn start(app: AppHandle, core: Arc<Core>) -> Arc<Self> {
        let (tx, rx) = mpsc::channel::<PathBuf>();
        let watch = Arc::new(Self {
            watcher: Mutex::new(None),
            tx,
        });
        std::thread::Builder::new()
            .name("watch".into())
            .spawn(move || {
                let mut changed: HashMap<String, Instant> = HashMap::new();
                let mut settling: HashMap<String, Instant> = HashMap::new();
                let mut failed: HashSet<(String, i64)> = HashSet::new();
                loop {
                    match rx.recv_timeout(Duration::from_millis(250)) {
                        Ok(path) => {
                            let roots: Vec<String> = lock(&core.config)
                                .folders
                                .iter()
                                .map(|f| f.path.clone())
                                .collect();
                            if let Some(root) = roots.into_iter().find(|r| path.starts_with(r)) {
                                changed.insert(root.clone(), Instant::now());
                                settling.insert(root, Instant::now());
                            }
                        }
                        Err(RecvTimeoutError::Disconnected) => return,
                        Err(RecvTimeoutError::Timeout) => {}
                    }
                    let now = Instant::now();
                    let quiet: Vec<String> = changed
                        .iter()
                        .filter(|(_, t)| now.duration_since(**t) >= QUIET)
                        .map(|(r, _)| r.clone())
                        .collect();
                    for root in quiet {
                        changed.remove(&root);
                        core.forget(&root);
                        let _ = app.emit("folder-changed", Changed { folder: root });
                    }
                    let ready: Vec<String> = settling
                        .iter()
                        .filter(|(_, t)| now.duration_since(**t) >= SETTLE)
                        .map(|(r, _)| r.clone())
                        .collect();
                    for root in ready {
                        if core.busy() {
                            continue;
                        }
                        settling.remove(&root);
                        auto_sort(&app, &core, &root, &mut failed);
                    }
                }
            })
            .expect("watch thread");
        watch
    }

    pub fn refresh(&self, roots: &[String]) {
        let tx = self.tx.clone();
        let handler = move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                for p in event.paths {
                    let _ = tx.send(p);
                }
            }
        };
        let mut slot = lock(&self.watcher);
        *slot = None;
        let Ok(mut w) = notify::recommended_watcher(handler) else {
            return;
        };
        for r in roots {
            let _ = w.watch(Path::new(r), RecursiveMode::Recursive);
        }
        *slot = Some(w);
    }
}

fn auto_sort(app: &AppHandle, core: &Core, root: &str, failed: &mut HashSet<(String, i64)>) {
    let Ok(folder) = core.folder(root) else {
        return;
    };
    if !folder.auto {
        return;
    }
    let Ok(plan) = core.plan(root, true) else {
        return;
    };
    let ops: Vec<OpRequest> = plan
        .ops
        .into_iter()
        .filter(|o| {
            o.action == OpAction::Move
                && o.added >= folder.auto_since
                && !failed.contains(&(o.source.clone(), o.modified))
        })
        .map(|o| OpRequest {
            action: o.action,
            source: o.source,
            destination: o.destination,
            size: o.size,
            modified: o.modified,
        })
        .collect();
    if ops.is_empty() {
        return;
    }
    let req = ApplyRequest {
        folder: root.to_string(),
        kind: BatchKind::Auto,
        ops,
        allow_projects: false,
    };
    if let Ok(batch) = core.apply(req, &|_, _| {}) {
        for op in batch.ops.iter().filter(|o| o.failure.is_some()) {
            failed.insert((op.source.clone(), op.modified));
        }
        let _ = app.emit("history-changed", batch.id);
        let _ = app.emit(
            "folder-changed",
            Changed {
                folder: root.to_string(),
            },
        );
    }
}
