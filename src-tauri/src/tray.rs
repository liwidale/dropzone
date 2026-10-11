use serde::Deserialize;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayFolder {
    pub path: String,
    pub name: String,
    pub pending: usize,
}

const SORT: &str = "tray-sort|";

pub fn create(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let icon = if cfg!(target_os = "macos") {
        Some(tauri::image::Image::from_bytes(include_bytes!(
            "../icons/tray.png"
        ))?)
    } else {
        app.default_window_icon().cloned()
    };
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Dropzone")
        .icon_as_template(cfg!(target_os = "macos"))
        .menu(&menu(app, &[])?)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| handle(app, event.id().as_ref()));
    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }
    builder.build(app)
}

fn menu(app: &AppHandle, folders: &[TrayFolder]) -> tauri::Result<Menu<Wry>> {
    let mut m = MenuBuilder::new(app)
        .item(&MenuItemBuilder::with_id("tray-open", "Open Dropzone").build(app)?);
    if !folders.is_empty() {
        m = m.item(&PredefinedMenuItem::separator(app)?);
        for f in folders {
            let text = if f.pending == 0 {
                format!("{}: nothing to sort", f.name)
            } else {
                format!("Sort {} ({})…", f.name, f.pending)
            };
            m = m.item(
                &MenuItemBuilder::with_id(format!("{SORT}{}", f.path), text)
                    .enabled(f.pending > 0)
                    .build(app)?,
            );
        }
    }
    m.item(&PredefinedMenuItem::separator(app)?)
        .item(&MenuItemBuilder::with_id("tray-quit", "Quit Dropzone").build(app)?)
        .build()
}

pub fn update(app: &AppHandle, tray: &TrayIcon, folders: &[TrayFolder]) {
    if let Ok(m) = menu(app, folders) {
        let _ = tray.set_menu(Some(m));
    }
    let total: usize = folders.iter().map(|f| f.pending).sum();
    #[cfg(target_os = "macos")]
    let _ = tray.set_title((total > 0).then(|| total.to_string()));
    let _ = tray.set_tooltip(Some(if total > 0 {
        format!("Dropzone: {total} to sort")
    } else {
        "Dropzone".to_string()
    }));
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn handle(app: &AppHandle, id: &str) {
    match id {
        "tray-open" => show_main(app),
        "tray-quit" => app.exit(0),
        _ => {
            if let Some(path) = id.strip_prefix(SORT) {
                show_main(app);
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.emit("menu", format!("sort-folder:{path}"));
                }
            }
        }
    }
}
