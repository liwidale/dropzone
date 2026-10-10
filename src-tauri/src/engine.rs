use crate::dupes;
use crate::model::{now_ms, time_ms, Entry, Failure, Kind, Outcome, Snapshot};
use crate::ops;
use crate::projects;
use crate::rules::{self, new_id, Action, Rule};
use crate::scan::{self, TEMP_PREFIX};
use crate::store::{
    Batch, BatchKind, Config, FolderConfig, Journal, OpAction, OpRecord, OpStatus, Store,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

const SETTLE_MS: i64 = 4_000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedOp {
    pub source: String,
    pub name: String,
    pub kind: Kind,
    pub size: u64,
    pub modified: i64,
    pub added: i64,
    pub action: OpAction,
    pub destination: Option<String>,
    pub renamed: bool,
    pub rule_id: String,
    pub rule_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub folder: String,
    pub ops: Vec<PlannedOp>,
    pub unfinished: Vec<Entry>,
    pub unmatched: usize,
    pub project: Option<String>,
    pub protected: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RulePreview {
    pub count: usize,
    pub size: u64,
    pub names: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpRequest {
    pub action: OpAction,
    pub source: String,
    pub destination: Option<String>,
    pub size: u64,
    pub modified: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRequest {
    pub folder: String,
    pub kind: BatchKind,
    pub ops: Vec<OpRequest>,
    #[serde(default)]
    pub allow_projects: bool,
}

struct Guard {
    root: PathBuf,
    kind: BatchKind,
    allow_root: bool,
    allow_projects: bool,
}

impl Guard {
    fn check(&self, src: &Path) -> Outcome<()> {
        let Some(project) = projects::project_of(src, &self.root) else {
            return Ok(());
        };
        let allowed = match self.kind {
            BatchKind::Sort | BatchKind::Auto => project == self.root && self.allow_root,
            BatchKind::Duplicates => false,
            BatchKind::Move | BatchKind::Trash => self.allow_projects,
        };
        if allowed {
            Ok(())
        } else {
            Err(Failure::new("project", project.display().to_string()))
        }
    }
}

pub struct Core {
    pub store: Store,
    pub config: Mutex<Config>,
    pub history: Mutex<Vec<Batch>>,
    pub hashes: dupes::Cache,
    pub snapshots: Mutex<HashMap<String, Arc<Snapshot>>>,
    pub recovered: Mutex<Option<Batch>>,
    work: Mutex<()>,
}

pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn clean(p: &Path) -> Outcome<PathBuf> {
    if !p.is_absolute()
        || p.components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
    {
        return Err(Failure::new("outside", p.display().to_string()));
    }
    Ok(p.components().collect())
}

fn resolve(p: &Path) -> PathBuf {
    let mut tail = Vec::new();
    let mut cur = p.to_path_buf();
    loop {
        if let Ok(real) = dunce::canonicalize(&cur) {
            return tail
                .into_iter()
                .rev()
                .fold(real, |acc: PathBuf, n| acc.join(n));
        }
        match (cur.file_name().map(|n| n.to_os_string()), cur.parent()) {
            (Some(name), Some(parent)) => {
                tail.push(name);
                cur = parent.to_path_buf();
            }
            _ => return p.to_path_buf(),
        }
    }
}

fn located(p: &Path) -> PathBuf {
    match (p.parent(), p.file_name()) {
        (Some(parent), Some(name)) => resolve(parent).join(name),
        _ => p.to_path_buf(),
    }
}

impl Core {
    pub fn open(dir: PathBuf) -> Self {
        let store = Store::new(dir);
        let config = store.load_config();
        let history = store.load_history();
        let core = Self {
            store,
            config: Mutex::new(config),
            history: Mutex::new(history),
            hashes: Default::default(),
            snapshots: Default::default(),
            recovered: Mutex::new(None),
            work: Mutex::new(()),
        };
        core.recover();
        core
    }

    pub fn save_config(&self, c: &Config) -> Outcome<()> {
        self.store.save_config(c)
    }

    pub fn folder(&self, path: &str) -> Outcome<FolderConfig> {
        lock(&self.config)
            .folders
            .iter()
            .find(|f| f.path == path)
            .cloned()
            .ok_or_else(|| Failure::new("unknownfolder", path))
    }

    pub fn add_folder(&self, path: &Path) -> Outcome<FolderConfig> {
        let real = dunce::canonicalize(path).map_err(|e| Failure::io(&e))?;
        if !fs::metadata(&real).map_err(|e| Failure::io(&e))?.is_dir() {
            return Err(Failure::new("notfolder", real.display().to_string()));
        }
        let key = real.display().to_string();
        let mut c = lock(&self.config);
        if let Some(f) = c.folders.iter().find(|f| f.path == key) {
            return Ok(f.clone());
        }
        let nested = c.folders.iter().find(|f| {
            let other = Path::new(&f.path);
            real.starts_with(other) || other.starts_with(&real)
        });
        if let Some(f) = nested {
            return Err(Failure::new("overlap", f.path.clone()));
        }
        let folder = FolderConfig {
            path: key,
            rules: rules::defaults(),
            auto: false,
            auto_since: 0,
            allow_project: false,
        };
        c.folders.push(folder.clone());
        self.save_config(&c)?;
        Ok(folder)
    }

    pub fn allow_destination(&self, dir: &Path) -> Outcome<String> {
        let real = dunce::canonicalize(dir).map_err(|e| Failure::io(&e))?;
        let key = real.display().to_string();
        let mut c = lock(&self.config);
        c.destinations.retain(|d| d != &key);
        c.destinations.insert(0, key.clone());
        c.destinations.truncate(24);
        self.save_config(&c)?;
        Ok(key)
    }

    fn roots(&self) -> Vec<PathBuf> {
        lock(&self.config)
            .folders
            .iter()
            .map(|f| PathBuf::from(&f.path))
            .collect()
    }

    fn destinations(&self) -> Vec<PathBuf> {
        let c = lock(&self.config);
        let mut out: Vec<PathBuf> = c.folders.iter().map(|f| PathBuf::from(&f.path)).collect();
        out.extend(c.destinations.iter().map(PathBuf::from));
        for f in &c.folders {
            for r in &f.rules {
                if let Action::Move { folder, .. } = &r.action {
                    if Path::new(folder).is_absolute() {
                        out.push(resolve(Path::new(folder)));
                    }
                }
            }
        }
        out
    }

    fn check_source(&self, p: &Path) -> Outcome<PathBuf> {
        let p = clean(p)?;
        let real = located(&p);
        if self
            .roots()
            .iter()
            .any(|r| real.starts_with(r) && real != *r)
        {
            Ok(p)
        } else {
            Err(Failure::new("outside", p.display().to_string()))
        }
    }

    fn check_destination(&self, p: &Path, allowed: &[PathBuf]) -> Outcome<PathBuf> {
        let p = clean(p)?;
        let real = resolve(&p);
        if allowed.iter().any(|a| real.starts_with(a) && real != *a) {
            Ok(p)
        } else {
            Err(Failure::new("outside", p.display().to_string()))
        }
    }

    pub fn plan(&self, folder: &str, settled_only: bool) -> Outcome<Plan> {
        let cfg = self.folder(folder)?;
        let hidden = lock(&self.config).settings.show_hidden;
        let entries = scan::top_level(Path::new(folder), hidden)?;
        let now = now_ms();
        let entries: Vec<Entry> = if settled_only {
            entries
                .into_iter()
                .filter(|e| now - e.modified >= SETTLE_MS)
                .collect()
        } else {
            entries
        };
        let mut plan = plan(Path::new(folder), entries, &cfg.rules, now);
        plan.project = projects::marker_in(Path::new(folder));
        if plan.project.is_some() && !cfg.allow_project {
            plan.protected = plan.ops.len();
            plan.ops.clear();
        }
        Ok(plan)
    }

    pub fn preview_rule(&self, folder: &str, rule: &Rule) -> Outcome<RulePreview> {
        self.folder(folder)?;
        let hidden = lock(&self.config).settings.show_hidden;
        let now = now_ms();
        let mut rule = rule.clone();
        rule.enabled = true;
        let mut hits: Vec<Entry> = scan::top_level(Path::new(folder), hidden)?
            .into_iter()
            .filter(|e| e.kind != Kind::Partial && rules::matches(&rule, e, now))
            .collect();
        hits.sort_by_key(|e| std::cmp::Reverse(e.added));
        Ok(RulePreview {
            count: hits.len(),
            size: hits.iter().map(|e| e.size).sum(),
            names: hits.iter().take(6).map(|e| e.name.clone()).collect(),
        })
    }

    pub fn apply(&self, req: ApplyRequest, progress: &dyn Fn(usize, usize)) -> Outcome<Batch> {
        let _lock = lock(&self.work);
        let cfg = self.folder(&req.folder)?;
        let guard = Guard {
            root: PathBuf::from(&cfg.path),
            kind: req.kind,
            allow_root: cfg.allow_project,
            allow_projects: req.allow_projects,
        };
        let allowed = self.destinations();
        let mut batch = Batch {
            id: new_id("b"),
            folder: req.folder.clone(),
            kind: req.kind,
            created: now_ms(),
            finished: None,
            interrupted: false,
            ops: req
                .ops
                .iter()
                .map(|o| OpRecord {
                    action: o.action,
                    source: o.source.clone(),
                    target: if o.action == OpAction::Move {
                        o.destination.clone()
                    } else {
                        None
                    },
                    size: o.size,
                    modified: o.modified,
                    status: OpStatus::Pending,
                    failure: None,
                    restored_to: None,
                })
                .collect(),
            created_dirs: Vec::new(),
            undone_at: None,
        };
        let mut journal = self.store.begin(&batch)?;
        let total = batch.ops.len();
        for i in 0..total {
            let mut dirs = Vec::new();
            let op = &mut batch.ops[i];
            if let Err(f) = self.run(op, &guard, &allowed, &mut journal, i, &mut dirs) {
                op.status = if f.code == "changed" {
                    OpStatus::Skipped
                } else {
                    OpStatus::Failed
                };
                op.failure = Some(f);
            }
            let dirs: Vec<String> = dirs.iter().map(|d| d.display().to_string()).collect();
            journal.step(i, &batch.ops[i], &dirs);
            batch.created_dirs.extend(dirs);
            progress(i + 1, total);
        }
        batch.finished = Some(now_ms());
        self.finish(batch.clone())?;
        self.forget(&req.folder);
        Ok(batch)
    }

    fn run(
        &self,
        op: &mut OpRecord,
        guard: &Guard,
        allowed: &[PathBuf],
        journal: &mut Journal,
        i: usize,
        dirs: &mut Vec<PathBuf>,
    ) -> Outcome<()> {
        let src = self.check_source(Path::new(&op.source))?;
        guard.check(&src)?;
        let md = fs::symlink_metadata(&src).map_err(|e| Failure::io(&e))?;
        if time_ms(md.modified()) != op.modified || (!md.is_dir() && md.len() != op.size) {
            return Err(Failure::new("changed", op.source.clone()));
        }
        match op.action {
            OpAction::Move => {
                let wanted = op
                    .target
                    .clone()
                    .ok_or_else(|| Failure::new("io", "no destination"))?;
                let wanted = self.check_destination(Path::new(&wanted), allowed)?;
                let dir = wanted
                    .parent()
                    .ok_or_else(|| Failure::new("outside", ""))?
                    .to_path_buf();
                let name = wanted
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                if src == wanted {
                    return Err(Failure::new("same", op.source.clone()));
                }
                ops::create_dirs(&dir, dirs).map_err(|e| Failure::io(&e))?;
                let mut target = ops::free_path(&dir, &name, |_| false);
                op.target = Some(target.display().to_string());
                journal.step(
                    i,
                    op,
                    &dirs
                        .iter()
                        .map(|d| d.display().to_string())
                        .collect::<Vec<_>>(),
                );
                if let Err(e) = ops::move_item(&src, &target) {
                    if e.kind() != std::io::ErrorKind::AlreadyExists {
                        op.target = None;
                        return Err(Failure::io(&e));
                    }
                    target = ops::free_path(&dir, &name, |_| false);
                    op.target = Some(target.display().to_string());
                    journal.step(i, op, &[]);
                    ops::move_item(&src, &target).map_err(|e| {
                        op.target = None;
                        Failure::io(&e)
                    })?;
                }
                op.status = OpStatus::Done;
            }
            OpAction::Trash => {
                journal.step(i, op, &[]);
                let landed = ops::trash(&src).map_err(|e| Failure::io(&e))?;
                op.target = landed.map(|p| p.display().to_string());
                op.status = OpStatus::Done;
            }
        }
        Ok(())
    }

    fn finish(&self, batch: Batch) -> Outcome<()> {
        let mut h = lock(&self.history);
        h.retain(|b| b.id != batch.id);
        h.insert(0, batch);
        let saved = self.store.save_history(&mut h);
        self.store.end();
        saved
    }

    pub fn forget(&self, folder: &str) {
        lock(&self.snapshots).remove(folder);
    }

    pub fn undo(&self, id: &str) -> Outcome<Batch> {
        let _guard = lock(&self.work);
        let mut batch = lock(&self.history)
            .iter()
            .find(|b| b.id == id)
            .cloned()
            .ok_or_else(|| Failure::new("unknownbatch", id))?;
        for op in batch.ops.iter_mut().rev() {
            if !matches!(op.status, OpStatus::Done | OpStatus::UndoFailed) {
                continue;
            }
            match undo_op(op) {
                Ok(()) => {
                    op.status = OpStatus::Undone;
                    op.failure = None;
                }
                Err(f) => {
                    op.status = OpStatus::UndoFailed;
                    op.failure = Some(f);
                }
            }
        }
        for d in batch.created_dirs.iter().rev() {
            ops::remove_if_empty(Path::new(d));
        }
        batch.undone_at = Some(now_ms());
        let mut h = lock(&self.history);
        if let Some(slot) = h.iter_mut().find(|b| b.id == batch.id) {
            *slot = batch.clone();
        }
        self.store.save_history(&mut h)?;
        drop(h);
        self.forget(&batch.folder);
        Ok(batch)
    }

    pub fn clear_history(&self) -> Outcome<()> {
        let _guard = lock(&self.work);
        let mut h = lock(&self.history);
        h.clear();
        self.store.save_history(&mut h)
    }

    pub fn busy(&self) -> bool {
        self.work.try_lock().is_err()
    }

    fn recover(&self) {
        let Some((mut batch, started)) = self.store.pending() else {
            return;
        };
        if lock(&self.history).iter().any(|b| b.id == batch.id) {
            self.store.end();
            return;
        }
        for (i, op) in batch.ops.iter_mut().enumerate() {
            if op.status != OpStatus::Pending {
                continue;
            }
            let src_there = ops::exists(Path::new(&op.source));
            if !started.contains(&i) {
                op.status = OpStatus::Skipped;
                op.failure = Some(Failure::new("interrupted", ""));
                continue;
            }
            let target_there = op
                .target
                .as_deref()
                .is_some_and(|t| ops::exists(Path::new(t)));
            match (op.action, src_there, target_there) {
                (OpAction::Move, false, true) | (OpAction::Trash, false, _) => {
                    op.status = OpStatus::Done
                }
                _ => {
                    op.status = OpStatus::Failed;
                    op.failure = Some(Failure::new("interrupted", ""));
                    if op.action == OpAction::Move && !target_there {
                        op.target = None;
                    }
                }
            }
            if let Some(dir) = op.target.as_deref().and_then(|t| Path::new(t).parent()) {
                sweep_partials(dir);
            }
        }
        batch.interrupted = true;
        batch.finished = Some(now_ms());
        if self.finish(batch.clone()).is_ok() {
            *lock(&self.recovered) = Some(batch);
        }
    }
}

fn sweep_partials(dir: &Path) {
    let Ok(read) = fs::read_dir(dir) else { return };
    for e in read.flatten() {
        if e.file_name().to_string_lossy().starts_with(TEMP_PREFIX) {
            let p = e.path();
            let _ = if p.is_dir() {
                fs::remove_dir_all(&p)
            } else {
                fs::remove_file(&p)
            };
        }
    }
}

fn undo_op(op: &mut OpRecord) -> Outcome<()> {
    let source = PathBuf::from(&op.source);
    let Some(target) = op.target.clone().map(PathBuf::from) else {
        return Err(Failure::new(
            if op.action == OpAction::Trash {
                "untracked"
            } else {
                "missing"
            },
            "",
        ));
    };
    if !ops::exists(&target) {
        if ops::exists(&source) {
            return Ok(());
        }
        return Err(Failure::new(
            if op.action == OpAction::Trash {
                "emptied"
            } else {
                "missing"
            },
            target.display().to_string(),
        ));
    }
    let dir = source.parent().ok_or_else(|| Failure::new("io", ""))?;
    ops::create_dirs(dir, &mut Vec::new()).map_err(|e| Failure::io(&e))?;
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let dest = ops::free_path(dir, &name, |_| false);
    ops::move_item(&target, &dest).map_err(|e| Failure::io(&e))?;
    if op.action == OpAction::Trash {
        ops::forget_trashed(&target);
    }
    op.restored_to = (dest != source).then(|| dest.display().to_string());
    Ok(())
}

pub fn plan(root: &Path, mut entries: Vec<Entry>, rules: &[Rule], now: i64) -> Plan {
    entries.sort_by_cached_key(|e| e.name.to_lowercase());
    let mut reserved: HashMap<PathBuf, HashSet<String>> = HashMap::new();
    let mut ops_out = Vec::new();
    let mut unfinished = Vec::new();
    let mut unmatched = 0;
    for e in entries {
        if e.kind == Kind::Partial {
            unfinished.push(e);
            continue;
        }
        let Some(rule) = rules.iter().find(|r| rules::matches(r, &e, now)) else {
            unmatched += 1;
            continue;
        };
        let (action, destination, renamed) = match &rule.action {
            Action::Trash => (OpAction::Trash, None, false),
            Action::Move { folder, group } => {
                let dir = rules::destination(root, folder, *group, e.added);
                if Path::new(&e.path).parent() == Some(dir.as_path()) {
                    unmatched += 1;
                    continue;
                }
                let taken = reserved.entry(dir.clone()).or_default();
                let target = ops::free_path(&dir, &e.name, |n| taken.contains(&n.to_lowercase()));
                let final_name = target
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                taken.insert(final_name.to_lowercase());
                (
                    OpAction::Move,
                    Some(target.display().to_string()),
                    final_name != e.name,
                )
            }
        };
        ops_out.push(PlannedOp {
            source: e.path.clone(),
            name: e.name.clone(),
            kind: e.kind,
            size: e.size,
            modified: e.modified,
            added: e.added,
            action,
            destination,
            renamed,
            rule_id: rule.id.clone(),
            rule_name: rule.name.clone(),
        });
    }
    Plan {
        folder: root.display().to_string(),
        ops: ops_out,
        unfinished,
        unmatched,
        project: None,
        protected: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    fn request(plan: &Plan) -> ApplyRequest {
        ApplyRequest {
            folder: plan.folder.clone(),
            kind: BatchKind::Sort,
            ops: plan
                .ops
                .iter()
                .map(|o| OpRequest {
                    action: o.action,
                    source: o.source.clone(),
                    destination: o.destination.clone(),
                    size: o.size,
                    modified: o.modified,
                })
                .collect(),
            allow_projects: false,
        }
    }

    #[test]
    fn sort_then_undo_round_trip() {
        let data = TempDir::new("data");
        let home = TempDir::new("home");
        home.file("photo.jpg", &[0xFF, 0xD8, 0xFF, 1]);
        home.file("Images/photo.jpg", &[0xFF, 0xD8, 0xFF, 2]);
        home.file("doc.pdf", b"%PDF-1");
        home.file("setup.dmg", b"koly");
        home.file("movie.mp4.crdownload", b"...");
        home.file("unknown.xyz", &[0, 1, 2, 250]);

        let core = Core::open(data.path().to_path_buf());
        let folder = core.add_folder(home.path()).unwrap();
        let plan = core.plan(&folder.path, false).unwrap();
        assert_eq!(plan.ops.len(), 3);
        assert_eq!(plan.unfinished.len(), 1);
        assert_eq!(plan.unmatched, 1);
        let photo = plan.ops.iter().find(|o| o.name == "photo.jpg").unwrap();
        assert!(photo.renamed);
        assert!(photo
            .destination
            .as_deref()
            .unwrap()
            .ends_with("Images/photo 2.jpg"));

        let batch = core.apply(request(&plan), &|_, _| {}).unwrap();
        assert!(batch.ops.iter().all(|o| o.status == OpStatus::Done));
        assert!(home.path().join("Images/photo 2.jpg").exists());
        assert!(home.path().join("Documents/doc.pdf").exists());
        assert!(home.path().join("Installers/setup.dmg").exists());
        assert!(!home.path().join("doc.pdf").exists());
        assert_eq!(
            fs::read(home.path().join("Images/photo.jpg")).unwrap(),
            vec![0xFF, 0xD8, 0xFF, 2]
        );

        fs::write(home.path().join("doc.pdf"), b"new file with the same name").unwrap();
        let undone = core.undo(&batch.id).unwrap();
        assert!(undone.ops.iter().all(|o| o.status == OpStatus::Undone));
        assert_eq!(
            fs::read(home.path().join("photo.jpg")).unwrap(),
            vec![0xFF, 0xD8, 0xFF, 1]
        );
        assert!(home.path().join("setup.dmg").exists());
        assert!(home.path().join("doc 2.pdf").exists());
        assert_eq!(
            fs::read(home.path().join("doc.pdf")).unwrap(),
            b"new file with the same name"
        );
        assert!(!home.path().join("Documents").exists());
        assert!(!home.path().join("Installers").exists());
        assert!(home.path().join("Images/photo.jpg").exists());

        let reopened = Core::open(data.path().to_path_buf());
        assert_eq!(lock(&reopened.history).len(), 1);
        assert!(lock(&reopened.history)[0].undone_at.is_some());
    }

    #[test]
    fn changed_files_are_skipped_and_paths_are_confined() {
        let data = TempDir::new("data");
        let home = TempDir::new("home");
        let outside = TempDir::new("outside");
        let secret = outside.file("secret.txt", b"keep");
        home.file("a.txt", b"one");
        let core = Core::open(data.path().to_path_buf());
        let folder = core.add_folder(home.path()).unwrap();
        let plan = core.plan(&folder.path, false).unwrap();
        fs::write(home.path().join("a.txt"), b"changed!").unwrap();
        let mut req = request(&plan);
        req.ops.push(OpRequest {
            action: OpAction::Move,
            source: secret.display().to_string(),
            destination: Some(home.path().join("secret.txt").display().to_string()),
            size: 4,
            modified: 0,
        });
        req.ops.push(OpRequest {
            action: OpAction::Move,
            source: home
                .path()
                .join("../")
                .join(outside.path().file_name().unwrap())
                .join("secret.txt")
                .display()
                .to_string(),
            destination: Some(home.path().join("x.txt").display().to_string()),
            size: 4,
            modified: 0,
        });
        let batch = core.apply(req, &|_, _| {}).unwrap();
        assert_eq!(batch.ops[0].status, OpStatus::Skipped);
        assert_eq!(batch.ops[1].failure.as_ref().unwrap().code, "outside");
        assert_eq!(batch.ops[2].failure.as_ref().unwrap().code, "outside");
        assert_eq!(fs::read(&secret).unwrap(), b"keep");
        assert!(home.path().join("a.txt").exists());
    }

    #[test]
    fn project_files_are_protected() {
        let data = TempDir::new("data");
        let home = TempDir::new("home");
        home.file("Projects/site/package.json", b"{}");
        home.file("Projects/site/index.js", b"same");
        home.file("Projects/other/index.js", b"same");
        home.file("loose.js", b"x");
        let core = Core::open(data.path().to_path_buf());
        let folder = core.add_folder(home.path()).unwrap();
        let snap = scan::scan(
            home.path(),
            scan::Options {
                hidden: false,
                recursive: true,
            },
            &std::sync::atomic::AtomicBool::new(false),
        )
        .unwrap();
        let site = snap
            .entries
            .iter()
            .find(|e| e.dir == "Projects/site")
            .unwrap();
        assert_eq!(site.project.as_deref(), Some("Projects/site"));
        assert!(snap
            .entries
            .iter()
            .find(|e| e.dir == "Projects/other")
            .unwrap()
            .project
            .is_none());

        let mv = |kind, allow| ApplyRequest {
            folder: folder.path.clone(),
            kind,
            ops: vec![OpRequest {
                action: OpAction::Move,
                source: site.path.clone(),
                destination: Some(home.path().join("Code/index.js").display().to_string()),
                size: site.size,
                modified: site.modified,
            }],
            allow_projects: allow,
        };
        for kind in [BatchKind::Sort, BatchKind::Duplicates, BatchKind::Move] {
            let b = core.apply(mv(kind, false), &|_, _| {}).unwrap();
            assert_eq!(b.ops[0].failure.as_ref().unwrap().code, "project");
        }
        assert!(Path::new(&site.path).exists());
        let b = core.apply(mv(BatchKind::Move, true), &|_, _| {}).unwrap();
        assert_eq!(b.ops[0].status, OpStatus::Done);

        let plan = core.plan(&folder.path, false).unwrap();
        assert!(plan.project.is_none());
        assert_eq!(plan.ops.len(), 1);
        home.file(".git/HEAD", b"ref");
        let plan = core.plan(&folder.path, false).unwrap();
        assert_eq!(plan.project.as_deref(), Some(".git"));
        assert!(plan.ops.is_empty());
        assert_eq!(plan.protected, 1);
    }

    #[test]
    fn trash_round_trip() {
        let data = TempDir::new("data");
        let home = TempDir::new("home");
        let name = format!("dropzone-trash-test-{}.txt", rules::new_id(""));
        let file = home.file(&name, b"trash me");
        let core = Core::open(data.path().to_path_buf());
        let folder = core.add_folder(home.path()).unwrap();
        let md = fs::metadata(&file).unwrap();
        let req = ApplyRequest {
            folder: folder.path.clone(),
            kind: BatchKind::Trash,
            ops: vec![OpRequest {
                action: OpAction::Trash,
                source: file.display().to_string(),
                destination: None,
                size: md.len(),
                modified: time_ms(md.modified()),
            }],
            allow_projects: false,
        };
        let batch = core.apply(req, &|_, _| {}).unwrap();
        let op = &batch.ops[0];
        assert_eq!(op.status, OpStatus::Done, "{:?}", op.failure);
        assert!(!file.exists());
        let target = PathBuf::from(op.target.clone().expect("trash location"));
        assert!(target.exists(), "{}", target.display());
        let undone = core.undo(&batch.id).unwrap();
        assert_eq!(
            undone.ops[0].status,
            OpStatus::Undone,
            "{:?}",
            undone.ops[0].failure
        );
        assert_eq!(fs::read(&file).unwrap(), b"trash me");
        assert!(!target.exists());
    }

    #[test]
    fn recovers_interrupted_batches() {
        let data = TempDir::new("data");
        let home = TempDir::new("home");
        let a = home.file("a.txt", b"a");
        let b = home.file("b.txt", b"b");
        home.file("Docs/.dropzone-partial-x", b"half");
        let core = Core::open(data.path().to_path_buf());
        core.add_folder(home.path()).unwrap();
        let op = |p: &Path, d: &str| OpRecord {
            action: OpAction::Move,
            source: p.display().to_string(),
            target: Some(home.path().join(d).display().to_string()),
            size: 1,
            modified: 0,
            status: OpStatus::Pending,
            failure: None,
            restored_to: None,
        };
        let batch = Batch {
            id: "b1".into(),
            folder: home.path().display().to_string(),
            kind: BatchKind::Sort,
            created: 0,
            finished: None,
            interrupted: false,
            ops: vec![op(&a, "Docs/a.txt"), op(&b, "Docs/b.txt")],
            created_dirs: vec![],
            undone_at: None,
        };
        let mut j = core.store.begin(&batch).unwrap();
        j.step(
            0,
            &batch.ops[0],
            &[home.path().join("Docs").display().to_string()],
        );
        j.step(1, &batch.ops[1], &[]);
        fs::rename(&a, home.path().join("Docs/a.txt")).unwrap();
        drop(core);

        let core = Core::open(data.path().to_path_buf());
        let rec = lock(&core.recovered).clone().unwrap();
        assert!(rec.interrupted);
        assert_eq!(rec.ops[0].status, OpStatus::Done);
        assert_eq!(rec.ops[1].status, OpStatus::Failed);
        assert!(!home.path().join("Docs/.dropzone-partial-x").exists());
        let undone = core.undo("b1").unwrap();
        assert_eq!(undone.ops[0].status, OpStatus::Undone);
        assert!(a.exists());
        assert!(!home.path().join("Docs").exists());
    }
}
