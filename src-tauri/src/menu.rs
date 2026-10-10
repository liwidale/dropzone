use tauri::menu::{
    AboutMetadataBuilder, Menu, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem,
    SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Runtime, Wry};

pub struct Items {
    pub inspector: MenuItem<Wry>,
}

fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    text: &str,
    accel: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
    let b = MenuItemBuilder::with_id(id, text);
    match accel {
        Some(a) => b.accelerator(a).build(app),
        None => b.build(app),
    }
}

pub fn build(app: &AppHandle<Wry>) -> tauri::Result<(Menu<Wry>, Items)> {
    let about = AboutMetadataBuilder::new()
        .name(Some("Dropzone"))
        .version(Some(app.package_info().version.to_string()))
        .copyright(Some("Copyright (c) 2026 Liwidale"))
        .comments(Some("Sorts your Downloads with rules you can preview and undo. Everything stays on this Mac."))
        .build();

    let app_menu = SubmenuBuilder::new(app, "Dropzone")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Dropzone"),
            Some(about),
        )?)
        .separator()
        .item(&item(app, "settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item(
            app,
            "add-folder",
            "Add Folder…",
            Some("CmdOrCtrl+O"),
        )?)
        .separator()
        .item(&item(
            app,
            "sort",
            "Sort Files…",
            Some("CmdOrCtrl+Shift+S"),
        )?)
        .item(&item(app, "refresh", "Refresh", Some("CmdOrCtrl+R"))?)
        .separator()
        .item(&item(app, "open", "Open", None)?)
        .item(&item(app, "reveal", "Show in Finder", None)?)
        .item(&item(app, "move", "Move To…", None)?)
        .item(&item(app, "trash", "Move to Trash", None)?)
        .item(&item(app, "delete", "Delete Immediately…", None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&item(app, "undo", "Undo", Some("CmdOrCtrl+Z"))?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&item(app, "select-all", "Select All", Some("CmdOrCtrl+A"))?)
        .separator()
        .item(&item(app, "find", "Find", Some("CmdOrCtrl+F"))?)
        .build()?;

    let inspector = item(app, "inspector", "Show Inspector", Some("CmdOrCtrl+Alt+I"))?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item(
            app,
            "view-overview",
            "Overview",
            Some("CmdOrCtrl+1"),
        )?)
        .item(&item(app, "view-files", "All Files", Some("CmdOrCtrl+2"))?)
        .item(&item(
            app,
            "view-duplicates",
            "Duplicates",
            Some("CmdOrCtrl+3"),
        )?)
        .item(&item(app, "view-rules", "Rules", Some("CmdOrCtrl+4"))?)
        .item(&item(app, "view-history", "History", Some("CmdOrCtrl+5"))?)
        .separator()
        .item(&inspector)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &window])
        .build()?;
    Ok((menu, Items { inspector }))
}

pub fn forward(app: &AppHandle<Wry>, id: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.emit("menu", id.to_string());
    }
}
