mod dupes;
mod engine;
mod kinds;
mod menu;
mod meta;
mod model;
mod ops;
mod projects;
mod rules;
mod scan;
mod store;
#[cfg(test)]
mod testutil;
mod watch;

use crate::dupes::{DupGroup, Progress};
use crate::engine::{lock, ApplyRequest, Core, Plan, RulePreview};
use crate::model::{Failure, Outcome, Snapshot};
use crate::rules::Rule;
use crate::store::{Batch, FolderConfig, OpStatus, Settings};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

struct App {
    core: Arc<Core>,
    watch: Arc<watch::Watch>,
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
    menu: Mutex<Option<menu::Items>>,
}

type AppState<'a> = State<'a, App>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderView {
    path: String,
    name: String,
    rules: Vec<Rule>,
    auto: bool,
    allow_project: bool,
    known: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Boot {
    folders: Vec<FolderView>,
    settings: Settings,
    history: Vec<Batch>,
    recovered: Option<Batch>,
    known: Vec<(String, String)>,
    destinations: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct JobProgress {
    folder: String,
    done: u64,
    total: u64,
}

fn known_dirs(app: &AppHandle) -> Vec<(&'static str, PathBuf)> {
    let p = app.path();
    [
        ("downloads", p.download_dir()),
        ("desktop", p.desktop_dir()),
        ("documents", p.document_dir()),
    ]
    .into_iter()
    .filter_map(|(k, d)| {
        d.ok()
            .and_then(|d| dunce::canonicalize(&d).ok().or(Some(d)))
            .map(|d| (k, d))
    })
    .collect()
}

fn view(app: &AppHandle, f: FolderConfig) -> FolderView {
    let known = known_dirs(app)
        .into_iter()
        .find(|(_, d)| Path::new(&f.path) == d)
        .map(|(k, _)| k);
    let name = Path::new(&f.path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| f.path.clone());
    FolderView {
        path: f.path,
        name,
        rules: f.rules,
        auto: f.auto,
        allow_project: f.allow_project,
        known,
    }
}

fn sync_roots(app: &AppHandle, state: &App) {
    let roots: Vec<String> = lock(&state.core.config)
        .folders
        .iter()
        .map(|f| f.path.clone())
        .collect();
    let scope = app.asset_protocol_scope();
    for r in &roots {
        let _ = scope.allow_directory(r, true);
    }
    state.watch.refresh(&roots);
}

fn job(state: &App, key: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Some(prev) = lock(&state.jobs).insert(key.to_string(), flag.clone()) {
        prev.store(true, Ordering::Relaxed);
    }
    flag
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Outcome<T> + Send + 'static,
) -> Outcome<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| Failure::new("io", e.to_string()))?
}

#[tauri::command]
fn boot(app: AppHandle, state: AppState) -> Boot {
    let c = lock(&state.core.config).clone();
    Boot {
        folders: c.folders.into_iter().map(|f| view(&app, f)).collect(),
        settings: c.settings,
        history: lock(&state.core.history).clone(),
        recovered: lock(&state.core.recovered).take(),
        known: known_dirs(&app)
            .into_iter()
            .map(|(k, d)| (k.to_string(), d.display().to_string()))
            .collect(),
        destinations: c.destinations,
    }
}

#[tauri::command]
fn add_known(app: AppHandle, state: AppState, which: String) -> Outcome<FolderView> {
    let (_, dir) = known_dirs(&app)
        .into_iter()
        .find(|(k, _)| *k == which)
        .ok_or_else(|| Failure::new("missing", which))?;
    let f = state.core.add_folder(&dir)?;
    sync_roots(&app, &state);
    Ok(view(&app, f))
}

#[tauri::command]
async fn choose_folder(app: AppHandle, state: AppState<'_>) -> Outcome<Option<FolderView>> {
    let picked = app
        .dialog()
        .file()
        .set_title("Add a folder to Dropzone")
        .blocking_pick_folder();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let f = state.core.add_folder(&path)?;
    sync_roots(&app, &state);
    Ok(Some(view(&app, f)))
}

#[tauri::command]
async fn locate_folder(
    app: AppHandle,
    state: AppState<'_>,
    path: String,
) -> Outcome<Option<FolderView>> {
    let picked = app
        .dialog()
        .file()
        .set_title("Locate the folder")
        .blocking_pick_folder();
    let Some(new_path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let real = dunce::canonicalize(&new_path).map_err(|e| Failure::io(&e))?;
    let key = real.display().to_string();
    let f = {
        let mut c = lock(&state.core.config);
        if c.folders.iter().any(|f| f.path == key) {
            return Err(Failure::new("overlap", key));
        }
        let slot = c
            .folders
            .iter_mut()
            .find(|f| f.path == path)
            .ok_or_else(|| Failure::new("unknownfolder", path.clone()))?;
        slot.path = key;
        let f = slot.clone();
        state.core.save_config(&c)?;
        f
    };
    state.core.forget(&path);
    sync_roots(&app, &state);
    Ok(Some(view(&app, f)))
}

#[tauri::command]
fn remove_folder(app: AppHandle, state: AppState, path: String) -> Outcome<()> {
    {
        let mut c = lock(&state.core.config);
        c.folders.retain(|f| f.path != path);
        state.core.save_config(&c)?;
    }
    let _ = app.asset_protocol_scope().forbid_directory(&path, true);
    state.core.forget(&path);
    sync_roots(&app, &state);
    Ok(())
}

#[tauri::command]
async fn scan(state: AppState<'_>, path: String) -> Outcome<Arc<Snapshot>> {
    state.core.folder(&path)?;
    let core = state.core.clone();
    let cancel = job(&state, &format!("scan:{path}"));
    let opts = {
        let s = &lock(&core.config).settings;
        scan::Options {
            hidden: s.show_hidden,
            recursive: s.recursive,
        }
    };
    blocking(move || {
        let snap = Arc::new(scan::scan(Path::new(&path), opts, &cancel)?);
        lock(&core.snapshots).insert(path, snap.clone());
        Ok(snap)
    })
    .await
}

#[tauri::command]
async fn duplicates(app: AppHandle, state: AppState<'_>, path: String) -> Outcome<Vec<DupGroup>> {
    state.core.folder(&path)?;
    let core = state.core.clone();
    let cancel = job(&state, &format!("dupes:{path}"));
    let opts = {
        let s = &lock(&core.config).settings;
        scan::Options {
            hidden: s.show_hidden,
            recursive: s.recursive,
        }
    };
    blocking(move || {
        let cached = lock(&core.snapshots).get(&path).cloned();
        let snap = match cached {
            Some(s) => s,
            None => Arc::new(scan::scan(Path::new(&path), opts, &cancel)?),
        };
        let last = std::cell::Cell::new(None::<Instant>);
        dupes::find(&snap.entries, &core.hashes, &cancel, |p: Progress| {
            if last
                .get()
                .is_none_or(|t| t.elapsed() >= Duration::from_millis(80))
                || p.done >= p.total
            {
                last.set(Some(Instant::now()));
                let _ = app.emit(
                    "duplicates-progress",
                    JobProgress {
                        folder: path.clone(),
                        done: p.done,
                        total: p.total,
                    },
                );
            }
        })
    })
    .await
}

#[tauri::command]
async fn plan(state: AppState<'_>, path: String) -> Outcome<Plan> {
    let core = state.core.clone();
    blocking(move || core.plan(&path, false)).await
}

#[tauri::command]
async fn preview_rule(state: AppState<'_>, path: String, rule: Rule) -> Outcome<RulePreview> {
    let core = state.core.clone();
    blocking(move || core.preview_rule(&path, &rule)).await
}

#[tauri::command]
fn save_rules(
    app: AppHandle,
    state: AppState,
    path: String,
    rules: Vec<Rule>,
) -> Outcome<Vec<Rule>> {
    let mut rules = rules;
    for r in &mut rules {
        rules::validate(r)?;
    }
    let mut c = lock(&state.core.config);
    let f = c
        .folders
        .iter_mut()
        .find(|f| f.path == path)
        .ok_or_else(|| Failure::new("unknownfolder", path.clone()))?;
    f.rules = rules.clone();
    state.core.save_config(&c)?;
    drop(c);
    sync_roots(&app, &state);
    Ok(rules)
}

#[tauri::command]
fn default_rules() -> Vec<Rule> {
    rules::defaults()
}

#[tauri::command]
fn set_auto(state: AppState, path: String, on: bool) -> Outcome<()> {
    let mut c = lock(&state.core.config);
    let f = c
        .folders
        .iter_mut()
        .find(|f| f.path == path)
        .ok_or_else(|| Failure::new("unknownfolder", path.clone()))?;
    f.auto = on;
    if on {
        f.auto_since = model::now_ms();
    }
    state.core.save_config(&c)
}

#[tauri::command]
fn set_allow_project(state: AppState, path: String, on: bool) -> Outcome<()> {
    let mut c = lock(&state.core.config);
    let f = c
        .folders
        .iter_mut()
        .find(|f| f.path == path)
        .ok_or_else(|| Failure::new("unknownfolder", path.clone()))?;
    f.allow_project = on;
    state.core.save_config(&c)
}

#[tauri::command]
async fn apply(app: AppHandle, state: AppState<'_>, request: ApplyRequest) -> Outcome<Batch> {
    let core = state.core.clone();
    let folder = request.folder.clone();
    blocking(move || {
        let last = std::cell::Cell::new(None::<Instant>);
        let progress = |done: usize, total: usize| {
            if last
                .get()
                .is_none_or(|t| t.elapsed() >= Duration::from_millis(60))
                || done == total
            {
                last.set(Some(Instant::now()));
                let _ = app.emit(
                    "apply-progress",
                    JobProgress {
                        folder: folder.clone(),
                        done: done as u64,
                        total: total as u64,
                    },
                );
            }
        };
        core.apply(request, &progress)
    })
    .await
}

#[tauri::command]
async fn undo(state: AppState<'_>, id: String) -> Outcome<Batch> {
    let core = state.core.clone();
    blocking(move || core.undo(&id)).await
}

#[tauri::command]
fn history(state: AppState) -> Vec<Batch> {
    lock(&state.core.history).clone()
}

#[tauri::command]
fn clear_history(state: AppState) -> Outcome<()> {
    state.core.clear_history()
}

#[tauri::command]
fn set_settings(app: AppHandle, state: AppState, settings: Settings) -> Outcome<Settings> {
    let mut settings = settings;
    if !matches!(settings.theme.as_str(), "system" | "light" | "dark") {
        settings.theme = "system".into();
    }
    settings.stale_days = settings.stale_days.clamp(1, 3650);
    let mut c = lock(&state.core.config);
    let rescan = c.settings.show_hidden != settings.show_hidden
        || c.settings.recursive != settings.recursive;
    c.settings = settings.clone();
    state.core.save_config(&c)?;
    drop(c);
    if rescan {
        lock(&state.core.snapshots).clear();
        let _ = app.emit("settings-changed", ());
    }
    Ok(settings)
}

#[tauri::command]
async fn choose_destination(app: AppHandle, state: AppState<'_>) -> Outcome<Option<String>> {
    let picked = app
        .dialog()
        .file()
        .set_title("Choose a destination")
        .blocking_pick_folder();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    state.core.allow_destination(&path).map(Some)
}

fn known_path(state: &App, path: &str) -> Outcome<PathBuf> {
    let p = engine::clean(Path::new(path))?;
    let c = lock(&state.core.config);
    let inside = c
        .folders
        .iter()
        .map(|f| PathBuf::from(&f.path))
        .chain(c.destinations.iter().map(PathBuf::from))
        .any(|r| p.starts_with(&r));
    let touched = || {
        lock(&state.core.history)
            .iter()
            .flat_map(|b| b.ops.iter())
            .filter(|o| {
                matches!(
                    o.status,
                    OpStatus::Done | OpStatus::Undone | OpStatus::UndoFailed
                )
            })
            .any(|o| o.target.as_deref() == Some(path) || o.source == path)
    };
    if inside || touched() {
        Ok(p)
    } else {
        Err(Failure::new("outside", path))
    }
}

#[tauri::command]
fn reveal(app: AppHandle, state: AppState, path: String) -> Outcome<()> {
    let p = known_path(&state, &path)?;
    app.opener()
        .reveal_item_in_dir(&p)
        .map_err(|e| Failure::new("io", e.to_string()))
}

#[tauri::command]
fn open_file(app: AppHandle, state: AppState, path: String) -> Outcome<()> {
    let p = known_path(&state, &path)?;
    if !ops::exists(&p) {
        return Err(Failure::new("missing", path));
    }
    app.opener()
        .open_path(p.display().to_string(), None::<&str>)
        .map_err(|e| Failure::new("io", e.to_string()))
}

#[tauri::command]
fn open_privacy_settings(app: AppHandle) -> Outcome<()> {
    app.opener()
        .open_url(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders",
            None::<&str>,
        )
        .map_err(|e| Failure::new("io", e.to_string()))
}

#[tauri::command]
fn set_inspector_menu(state: AppState, shown: bool) {
    if let Some(items) = lock(&state.menu).as_ref() {
        let _ = items.inspector.set_text(if shown {
            "Hide Inspector"
        } else {
            "Show Inspector"
        });
    }
}

fn dropped(app: &AppHandle, paths: &[PathBuf]) {
    let state = app.state::<App>();
    let mut added = Vec::new();
    let mut failures = Vec::new();
    for p in paths.iter().filter(|p| p.is_dir()) {
        match state.core.add_folder(p) {
            Ok(f) => added.push(view(app, f)),
            Err(e) => failures.push(e),
        }
    }
    if !added.is_empty() {
        sync_roots(app, &state);
    }
    #[derive(Clone, Serialize)]
    struct Dropped {
        added: Vec<String>,
        failures: Vec<Failure>,
        files: bool,
    }
    let files = paths.iter().any(|p| !p.is_dir());
    let _ = app.emit(
        "folders-dropped",
        Dropped {
            added: added.into_iter().map(|f| f.path).collect(),
            failures,
            files,
        },
    );
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let dir = app.path().app_data_dir()?;
            let core = Arc::new(Core::open(dir));
            let watch = watch::Watch::start(handle.clone(), core.clone());
            let items = if cfg!(target_os = "macos") {
                let (menu, items) = menu::build(&handle)?;
                app.set_menu(menu)?;
                Some(items)
            } else {
                None
            };
            app.manage(App {
                core,
                watch,
                jobs: Mutex::new(HashMap::new()),
                menu: Mutex::new(items),
            });
            sync_roots(&handle, &app.state::<App>());
            let fallback = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(3));
                if let Some(w) = fallback.get_webview_window("main") {
                    if !w.is_visible().unwrap_or(true) {
                        let _ = w.show();
                    }
                }
            });
            Ok(())
        })
        .on_menu_event(|app, event| menu::forward(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                dropped(window.app_handle(), paths);
            }
        })
        .invoke_handler(tauri::generate_handler![
            boot,
            add_known,
            choose_folder,
            locate_folder,
            remove_folder,
            scan,
            duplicates,
            plan,
            preview_rule,
            save_rules,
            default_rules,
            set_auto,
            set_allow_project,
            apply,
            undo,
            history,
            clear_history,
            set_settings,
            choose_destination,
            reveal,
            open_file,
            open_privacy_settings,
            set_inspector_menu,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dropzone");
}
