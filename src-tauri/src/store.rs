use crate::model::{Failure, Outcome};
use crate::rules::Rule;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

const HISTORY_LIMIT: usize = 200;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: String,
    pub show_hidden: bool,
    pub recursive: bool,
    pub stale_days: u32,
    pub removal: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            show_hidden: false,
            recursive: true,
            stale_days: 30,
            removal: "trash".into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderConfig {
    pub path: String,
    pub rules: Vec<Rule>,
    #[serde(default)]
    pub auto: bool,
    #[serde(default)]
    pub auto_since: i64,
    #[serde(default)]
    pub allow_project: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub folders: Vec<FolderConfig>,
    pub settings: Settings,
    pub destinations: Vec<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BatchKind {
    Sort,
    Auto,
    Duplicates,
    Move,
    Trash,
    Delete,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OpAction {
    Move,
    Trash,
    Delete,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OpStatus {
    Pending,
    Done,
    Failed,
    Skipped,
    Undone,
    UndoFailed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpRecord {
    pub action: OpAction,
    pub source: String,
    pub target: Option<String>,
    pub size: u64,
    pub modified: i64,
    pub status: OpStatus,
    #[serde(default)]
    pub failure: Option<Failure>,
    #[serde(default)]
    pub restored_to: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub id: String,
    pub folder: String,
    pub kind: BatchKind,
    pub created: i64,
    pub finished: Option<i64>,
    #[serde(default)]
    pub interrupted: bool,
    pub ops: Vec<OpRecord>,
    #[serde(default)]
    pub created_dirs: Vec<String>,
    #[serde(default)]
    pub undone_at: Option<i64>,
}

#[derive(Serialize, Deserialize)]
struct Step {
    i: usize,
    s: OpStatus,
    #[serde(default)]
    t: Option<String>,
    #[serde(default)]
    f: Option<Failure>,
    #[serde(default)]
    d: Vec<String>,
}

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&dir);
        Self { dir }
    }

    fn file(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    pub fn load_config(&self) -> Config {
        read_json(&self.file("config.json")).unwrap_or_default()
    }

    pub fn save_config(&self, c: &Config) -> Outcome<()> {
        write_json(&self.file("config.json"), c)
    }

    pub fn load_history(&self) -> Vec<Batch> {
        read_json(&self.file("history.json")).unwrap_or_default()
    }

    pub fn save_history(&self, h: &mut Vec<Batch>) -> Outcome<()> {
        h.truncate(HISTORY_LIMIT);
        write_json(&self.file("history.json"), h)
    }

    pub fn begin(&self, batch: &Batch) -> Outcome<Journal> {
        let _ = fs::remove_file(self.file("journal.log"));
        write_json(&self.file("journal.json"), batch)?;
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.file("journal.log"))
            .map_err(|e| Failure::io(&e))?;
        Ok(Journal { log })
    }

    pub fn end(&self) {
        let _ = fs::remove_file(self.file("journal.log"));
        let _ = fs::remove_file(self.file("journal.json"));
    }

    pub fn pending(&self) -> Option<(Batch, HashSet<usize>)> {
        let mut batch: Batch = read_json(&self.file("journal.json"))?;
        let mut started = HashSet::new();
        if let Ok(f) = File::open(self.file("journal.log")) {
            for line in BufReader::new(f).lines().map_while(Result::ok) {
                let Ok(step) = serde_json::from_str::<Step>(&line) else {
                    continue;
                };
                if step.s == OpStatus::Pending {
                    started.insert(step.i);
                }
                if let Some(op) = batch.ops.get_mut(step.i) {
                    op.status = step.s;
                    if step.t.is_some() {
                        op.target = step.t;
                    }
                    op.failure = step.f;
                }
                for d in step.d {
                    if !batch.created_dirs.contains(&d) {
                        batch.created_dirs.push(d);
                    }
                }
            }
        }
        Some((batch, started))
    }
}

pub struct Journal {
    log: File,
}

impl Journal {
    pub fn step(&mut self, i: usize, op: &OpRecord, dirs: &[String]) {
        let line = serde_json::to_string(&Step {
            i,
            s: op.status,
            t: op.target.clone(),
            f: op.failure.clone(),
            d: dirs.to_vec(),
        })
        .unwrap_or_default();
        let _ = writeln!(self.log, "{line}");
        let _ = self.log.flush();
    }
}

fn read_json<T: DeserializeOwned>(p: &Path) -> Option<T> {
    let raw = fs::read(p).ok()?;
    serde_json::from_slice(&raw).ok()
}

fn write_json<T: Serialize>(p: &Path, v: &T) -> Outcome<()> {
    let tmp = p.with_extension("json.tmp");
    let data = serde_json::to_vec_pretty(v).map_err(|e| Failure::new("io", e.to_string()))?;
    let mut f = File::create(&tmp).map_err(|e| Failure::io(&e))?;
    f.write_all(&data)
        .and_then(|_| f.sync_all())
        .map_err(|e| Failure::io(&e))?;
    fs::rename(&tmp, p).map_err(|e| Failure::io(&e))
}
