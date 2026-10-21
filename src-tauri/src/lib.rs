//! Shade: a privacy screen. One transparent, click-through overlay per monitor dims
//! everything except what you choose to keep visible: a spotlight around the mouse,
//! the window you're working in, or a reading band. The curtain covers everything.

use serde::Serialize;
use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder, Wry};
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

pub const MODES: [&str; 4] = ["spotlight", "window", "band", "curtain"];
const TOGGLE: &str = "Alt+Shift+S";
const CURTAIN: &str = "Alt+Shift+X";

#[derive(Default)]
struct State {
    mode: Mutex<String>,     // "off" or one of MODES
    last: Mutex<String>,     // the last privacy mode that isn't the curtain, for the toggle
    before_curtain: Mutex<String>,
    menu: Mutex<Vec<(String, CheckMenuItem<Wry>)>>,
}

#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize)]
struct Pointer {
    cursor: Option<(f64, f64)>,
    active: Option<Rect>,
}

/// Converts a rectangle in physical screen pixels to a window's own logical pixels.
pub fn to_local(r: Rect, origin: (f64, f64), scale: f64) -> Rect {
    let s = if scale > 0.0 { scale } else { 1.0 };
    Rect { x: (r.x - origin.0) / s, y: (r.y - origin.1) / s, w: r.w / s, h: r.h / s }
}

/// What the next toggle should switch to.
pub fn next_mode(current: &str, last: &str) -> String {
    if current == "off" {
        if MODES.contains(&last) && last != "curtain" { last.to_string() } else { "spotlight".to_string() }
    } else {
        "off".to_string()
    }
}

fn active_window_physical(scale: f64) -> Option<Rect> {
    let w = active_win_pos_rs::get_active_window().ok()?;
    let p = w.position;
    if p.width <= 0.0 || p.height <= 0.0 {
        return None;
    }
    // macOS reports points; the others report physical pixels.
    let k = if cfg!(target_os = "macos") { scale } else { 1.0 };
    Some(Rect { x: p.x * k, y: p.y * k, w: p.width * k, h: p.height * k })
}

/// The mouse and the focused window, in the calling overlay's own coordinates.
#[tauri::command]
fn pointer(app: AppHandle, window: tauri::WebviewWindow, want_active: bool) -> Pointer {
    let origin = window.outer_position().map(|p| (p.x as f64, p.y as f64)).unwrap_or((0.0, 0.0));
    let scale = window.scale_factor().unwrap_or(1.0);
    let cursor = app.cursor_position().ok().map(|c| {
        let r = to_local(Rect { x: c.x, y: c.y, w: 0.0, h: 0.0 }, origin, scale);
        (r.x, r.y)
    });
    let active = if want_active { active_window_physical(scale).map(|r| to_local(r, origin, scale)) } else { None };
    Pointer { cursor, active }
}

#[tauri::command]
fn get_mode(state: tauri::State<State>) -> String {
    state.mode.lock().unwrap().clone()
}

#[tauri::command]
fn set_mode(app: AppHandle, mode: String) {
    apply(&app, &mode);
}

fn apply(app: &AppHandle, mode: &str) {
    let mode = if MODES.contains(&mode) { mode } else { "off" };
    let state = app.state::<State>();
    {
        let mut current = state.mode.lock().unwrap();
        if mode == "curtain" && current.as_str() != "curtain" {
            *state.before_curtain.lock().unwrap() = current.clone();
        }
        *current = mode.to_string();
    }
    if mode != "off" && mode != "curtain" {
        *state.last.lock().unwrap() = mode.to_string();
    }
    for (_, win) in app.webview_windows() {
        if !win.label().starts_with("overlay-") {
            continue;
        }
        if mode == "off" {
            let _ = win.hide();
        } else {
            let _ = win.show();
            // The curtain blocks the mouse too; the other modes let every click through.
            let _ = win.set_ignore_cursor_events(mode != "curtain");
            if mode == "curtain" {
                let _ = win.set_focus();
            }
        }
    }
    for (id, item) in state.menu.lock().unwrap().iter() {
        let _ = item.set_checked(id == mode);
    }
    let _ = app.emit("shade://mode", mode);
}

fn toggle(app: &AppHandle) {
    let state = app.state::<State>();
    let current = state.mode.lock().unwrap().clone();
    let last = state.last.lock().unwrap().clone();
    apply(app, &next_mode(&current, &last));
}

fn toggle_curtain(app: &AppHandle) {
    let state = app.state::<State>();
    let current = state.mode.lock().unwrap().clone();
    if current == "curtain" {
        let back = state.before_curtain.lock().unwrap().clone();
        apply(app, if back.is_empty() { "off" } else { &back });
    } else {
        apply(app, "curtain");
    }
}

/// One overlay per monitor, covering it edge to edge.
fn build_overlays(app: &AppHandle) -> tauri::Result<()> {
    let monitors = app.available_monitors()?;
    for (i, m) in monitors.iter().enumerate() {
        let label = format!("overlay-{i}");
        let scale = m.scale_factor();
        let pos = m.position();
        let size = m.size();
        let win = match app.get_webview_window(&label) {
            Some(w) => w,
            None => WebviewWindowBuilder::new(app, &label, WebviewUrl::App("overlay.html".into()))
                .title("Shade")
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .shadow(false)
                .resizable(false)
                .focused(false)
                .visible(false)
                .visible_on_all_workspaces(true)
                .build()?,
        };
        let _ = win.set_position(LogicalPosition::new(pos.x as f64 / scale, pos.y as f64 / scale));
        let _ = win.set_size(LogicalSize::new(size.width as f64 / scale, size.height as f64 / scale));
        // Linux needs the window shown once before it can be made click-through.
        let _ = win.show();
        let _ = win.set_ignore_cursor_events(true);
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
fn refit(app: AppHandle) {
    let _ = build_overlays(&app);
    let mode = app.state::<State>().mode.lock().unwrap().clone();
    apply(&app, &mode);
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Shade")
        .inner_size(720.0, 640.0)
        .min_inner_size(520.0, 480.0)
        .center()
        .build();
}

#[tauri::command]
fn lift_curtain(app: AppHandle) {
    if app.state::<State>().mode.lock().unwrap().as_str() == "curtain" {
        toggle_curtain(&app);
    }
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

pub fn run() {
    tauri::Builder::default()
        .manage(State { mode: Mutex::new("off".into()), last: Mutex::new("spotlight".into()), ..Default::default() })
        .plugin(tauri_plugin_single_instance::init(|app, _, _| open_settings(app.clone())))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts([TOGGLE, CURTAIN])
                .expect("valid shortcuts")
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    if *shortcut == CURTAIN.parse::<Shortcut>().unwrap() {
                        toggle_curtain(app);
                    } else {
                        toggle(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![pointer, get_mode, set_mode, refit, lift_curtain, open_settings, quit])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let handle = app.handle().clone();
            build_overlays(&handle)?;

            let items: Vec<(String, CheckMenuItem<Wry>)> = [
                ("off", "Off"),
                ("spotlight", "Spotlight around the mouse"),
                ("window", "Only the window I'm using"),
                ("band", "Reading band"),
                ("curtain", "Curtain (Alt Shift X)"),
            ]
            .iter()
            .map(|(id, text)| (id.to_string(), CheckMenuItem::with_id(app, *id, *text, true, *id == "off", None::<&str>).unwrap()))
            .collect();
            let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Shade", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let mut refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = items.iter().map(|(_, i)| i as &dyn tauri::menu::IsMenuItem<Wry>).collect();
            refs.push(&sep);
            refs.push(&settings);
            refs.push(&quit);
            let menu = Menu::with_items(app, &refs)?;
            *app.state::<State>().menu.lock().unwrap() = items;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .tooltip("Shade (Alt Shift S)")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "settings" => open_settings(app.clone()),
                    "quit" => app.exit(0),
                    id => apply(app, id),
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        toggle(tray.app_handle());
                    }
                })
                .build(app)?;

            let first = handle.path().app_config_dir().map(|d| d.join("launched")).ok();
            if let Some(marker) = first {
                if !marker.exists() {
                    let _ = std::fs::create_dir_all(marker.parent().unwrap());
                    let _ = std::fs::write(&marker, b"1");
                    open_settings(handle);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Shade");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_rects_to_window_coordinates() {
        let r = to_local(Rect { x: 2120.0, y: 200.0, w: 800.0, h: 600.0 }, (1920.0, 0.0), 2.0);
        assert_eq!(r, Rect { x: 100.0, y: 100.0, w: 400.0, h: 300.0 });
    }

    #[test]
    fn toggle_returns_to_the_last_privacy_mode() {
        assert_eq!(next_mode("off", "window"), "window");
        assert_eq!(next_mode("off", "curtain"), "spotlight");
        assert_eq!(next_mode("off", ""), "spotlight");
        assert_eq!(next_mode("band", "band"), "off");
    }
}
