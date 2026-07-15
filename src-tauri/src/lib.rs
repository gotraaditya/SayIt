use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use uuid::Uuid;

#[cfg(target_os = "windows")]
use clipboard_win::{formats, raw, Clipboard, Getter};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_CONTROL, VK_MENU, VK_SHIFT,
};

struct AppState {
    current_shortcut: Mutex<Option<Shortcut>>,
    backend_connection: Arc<Mutex<BackendConnection>>,
}

#[derive(Clone, Default)]
struct BackendConnection {
    url: String,
    token: String,
    available: bool,
    last_error: String,
}

#[derive(Serialize)]
struct BackendConfig {
    url: String,
    token: String,
}

#[cfg(target_os = "windows")]
#[derive(Clone)]
struct ClipboardFormat {
    id: u32,
    data: Vec<u8>,
}

#[cfg(target_os = "windows")]
struct ClipboardSnapshot {
    formats: Vec<ClipboardFormat>,
}

#[cfg(target_os = "windows")]
impl ClipboardSnapshot {
    fn capture() -> Result<Self, String> {
        let _clipboard =
            Clipboard::new_attempts(20).map_err(|error| format!("Clipboard is busy: {error}"))?;
        let mut formats = Vec::new();

        for id in raw::EnumFormats::new() {
            let mut data = Vec::new();
            if formats::RawData(id).read_clipboard(&mut data).is_ok() {
                formats.push(ClipboardFormat { id, data });
            }
        }

        Ok(Self { formats })
    }

    fn restore(&self) -> Result<(), String> {
        let _clipboard =
            Clipboard::new_attempts(20).map_err(|error| format!("Clipboard is busy: {error}"))?;
        raw::empty().map_err(|error| format!("Unable to clear clipboard: {error}"))?;

        for format in &self.formats {
            raw::set_without_clear(format.id, &format.data).map_err(|error| {
                format!("Unable to restore clipboard format {}: {error}", format.id)
            })?;
        }

        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn clipboard_sequence_number() -> Option<u32> {
    raw::seq_num().map(|number| number.get())
}

#[cfg(target_os = "windows")]
fn read_clipboard_text() -> Result<String, String> {
    let _clipboard =
        Clipboard::new_attempts(20).map_err(|error| format!("Clipboard is busy: {error}"))?;
    let mut text = String::new();
    formats::Unicode
        .read_clipboard(&mut text)
        .map_err(|error| format!("Clipboard does not contain readable text: {error}"))?;
    Ok(text)
}

#[cfg(target_os = "windows")]
fn shortcut_modifiers_are_down() -> bool {
    const KEY_DOWN_MASK: i16 = i16::MIN;
    unsafe {
        (GetAsyncKeyState(VK_CONTROL as i32) & KEY_DOWN_MASK) != 0
            || (GetAsyncKeyState(VK_MENU as i32) & KEY_DOWN_MASK) != 0
            || (GetAsyncKeyState(VK_SHIFT as i32) & KEY_DOWN_MASK) != 0
    }
}

#[cfg(target_os = "windows")]
fn wait_for_shortcut_modifiers_to_release(deadline: Duration) {
    let started = Instant::now();
    while shortcut_modifiers_are_down() && started.elapsed() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(target_os = "windows")]
fn wait_for_clipboard_change(previous_sequence: Option<u32>, deadline: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < deadline {
        if clipboard_sequence_number() != previous_sequence {
            return true;
        }
        thread::sleep(Duration::from_millis(15));
    }
    false
}

#[cfg(target_os = "windows")]
fn copy_current_selection() {
    if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
        let _ = enigo.key(Key::Control, Direction::Press);
        let _ = enigo.key(Key::Unicode('c'), Direction::Click);
        let _ = enigo.key(Key::Control, Direction::Release);
    }
}

#[cfg(target_os = "windows")]
fn capture_selected_text() -> Result<Option<String>, String> {
    wait_for_shortcut_modifiers_to_release(Duration::from_millis(800));
    let snapshot = ClipboardSnapshot::capture()?;
    let previous_sequence = clipboard_sequence_number();

    copy_current_selection();

    if !wait_for_clipboard_change(previous_sequence, Duration::from_millis(900)) {
        return Ok(None);
    }

    let captured_text = read_clipboard_text();
    let restore_result = snapshot.restore();

    match (captured_text, restore_result) {
        (Ok(text), Ok(())) => Ok(Some(text)),
        (Ok(text), Err(error)) => Err(format!(
            "Captured text, but failed to restore clipboard: {error}. Text: {text}"
        )),
        (Err(error), Ok(())) => Err(error),
        (Err(read_error), Err(restore_error)) => Err(format!(
            "{read_error}; additionally failed to restore clipboard: {restore_error}"
        )),
    }
}

#[cfg(not(target_os = "windows"))]
fn capture_selected_text() -> Result<Option<String>, String> {
    Err("Selection capture is currently supported on Windows only.".to_string())
}

const RESERVED_SHORTCUTS: &[&str] = &[
    "ctrl+c", "ctrl+v", "ctrl+x", "ctrl+a", "ctrl+s", "alt+tab", "alt+f4", "meta+l",
];

fn validate_shortcut(shortcut: &str) -> Result<(), String> {
    let normalized = shortcut.trim().to_ascii_lowercase();
    let parts: Vec<&str> = normalized
        .split('+')
        .filter(|part| !part.is_empty())
        .collect();
    let key = parts.last().copied().unwrap_or_default();
    let has_modifier = parts
        .iter()
        .any(|part| matches!(*part, "ctrl" | "alt" | "shift" | "meta"));

    if key.is_empty() || matches!(key, "ctrl" | "alt" | "shift" | "meta") {
        return Err("Use a shortcut with a letter, number, or function key.".into());
    }

    if !has_modifier {
        return Err("Add at least one modifier such as Alt, Ctrl, or Shift.".into());
    }

    if RESERVED_SHORTCUTS.contains(&normalized.as_str()) {
        return Err("That shortcut is reserved by the system or common app actions.".into());
    }

    Ok(())
}

fn should_replace_shortcut(current: Option<&Shortcut>, next: &Shortcut) -> bool {
    current != Some(next)
}

#[tauri::command]
fn hide_window(window: tauri::Window) {
    let _ = window.hide();
}

#[tauri::command]
fn update_shortcut(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    new_shortcut: String,
) -> Result<(), String> {
    validate_shortcut(&new_shortcut)?;
    let parsed = new_shortcut
        .parse::<Shortcut>()
        .map_err(|e| e.to_string())?;
    let mut current = state
        .current_shortcut
        .lock()
        .map_err(|_| "Shortcut state is unavailable.".to_string())?;
    if !should_replace_shortcut(current.as_ref(), &parsed) {
        return Ok(());
    }

    app.global_shortcut()
        .register(parsed)
        .map_err(|e| e.to_string())?;

    if let Some(old) = *current {
        if let Err(error) = app.global_shortcut().unregister(old) {
            let _ = app.global_shortcut().unregister(parsed);
            return Err(format!("Unable to replace the existing shortcut: {error}"));
        }
    }

    *current = Some(parsed);
    Ok(())
}

#[tauri::command]
fn get_backend_config(state: tauri::State<AppState>) -> Result<BackendConfig, String> {
    let backend = state
        .backend_connection
        .lock()
        .map_err(|_| "Backend state is unavailable.".to_string())?;
    if !backend.available {
        return Err(if backend.last_error.is_empty() {
            "Speech service is unavailable.".to_string()
        } else {
            backend.last_error.clone()
        });
    }
    Ok(BackendConfig {
        url: backend.url.clone(),
        token: backend.token.clone(),
    })
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(all(not(mobile), target_os = "windows"))]
fn terminate_backend(child: &mut Child) {
    let pid = child.id().to_string();
    let _ = Command::new("taskkill")
        .args(["/PID", &pid, "/T", "/F"])
        .output();
    let _ = child.wait();
}

#[cfg(all(not(mobile), not(target_os = "windows")))]
fn terminate_backend(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(not(mobile))]
fn backend_dir_candidates(resource_dir: Option<PathBuf>, current_dir: PathBuf) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(resource_dir) = resource_dir {
        candidates.push(resource_dir.join("python-backend"));
    }
    candidates.push(current_dir.join("../python-backend"));
    candidates
}

#[cfg(not(mobile))]
fn backend_runtime_candidates(resource_dir: Option<PathBuf>, current_dir: PathBuf) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(resource_dir) = resource_dir {
        candidates.push(resource_dir.join("python-backend-runtime"));
    }
    candidates.push(current_dir.join("../python-backend-runtime"));
    candidates
}

#[cfg(not(mobile))]
fn select_backend_dir(candidates: Vec<PathBuf>) -> Result<PathBuf, String> {
    candidates
        .into_iter()
        .find(|candidate| candidate.join("app.py").is_file())
        .ok_or_else(|| "SayIt backend files are missing from the app resources.".to_string())
}

#[cfg(all(not(mobile), target_os = "windows"))]
fn packaged_backend_executable_name() -> &'static str {
    "sayit-backend.exe"
}

#[cfg(all(not(mobile), not(target_os = "windows")))]
fn packaged_backend_executable_name() -> &'static str {
    "sayit-backend"
}

#[cfg(not(mobile))]
struct BackendLaunch {
    program: PathBuf,
    args: Vec<String>,
    working_dir: PathBuf,
}

#[cfg(not(mobile))]
struct BackendProcess {
    child: Child,
    url: String,
}

#[cfg(not(mobile))]
fn resolve_backend_launch(app: &tauri::AppHandle) -> Result<(BackendLaunch, PathBuf), String> {
    let resource_dir = app.path().resource_dir().ok();
    let current_dir = std::env::current_dir()
        .map_err(|error| format!("Unable to read the current directory: {error}"))?;
    let backend_dir = select_backend_dir(backend_dir_candidates(
        resource_dir.clone(),
        current_dir.clone(),
    ))?;

    for runtime_dir in backend_runtime_candidates(resource_dir, current_dir) {
        let executable = runtime_dir.join(packaged_backend_executable_name());
        if executable.is_file() {
            return Ok((
                BackendLaunch {
                    program: executable,
                    args: Vec::new(),
                    working_dir: backend_dir.clone(),
                },
                backend_dir,
            ));
        }
    }

    #[cfg(target_os = "windows")]
    let python = backend_dir.join("venv/Scripts/python.exe");
    #[cfg(not(target_os = "windows"))]
    let python = backend_dir.join("venv/bin/python");

    if !python.is_file() {
        return Err(
            "Packaged backend sidecar is missing and the development Python venv was not found."
                .to_string(),
        );
    }

    Ok((
        BackendLaunch {
            program: python,
            args: vec!["backend_server.py".to_string()],
            working_dir: backend_dir.clone(),
        },
        backend_dir,
    ))
}

#[cfg(not(mobile))]
fn app_log_path(app: &tauri::AppHandle, file_name: &str) -> PathBuf {
    match app.path().app_log_dir() {
        Ok(log_dir) => {
            let _ = fs::create_dir_all(&log_dir);
            log_dir.join(file_name)
        }
        Err(_) => std::env::temp_dir().join(file_name),
    }
}

#[cfg(not(mobile))]
fn backend_log_path(app: &tauri::AppHandle) -> PathBuf {
    app_log_path(app, "sayit-backend.log")
}

#[cfg(not(mobile))]
fn desktop_log_path(app: &tauri::AppHandle) -> PathBuf {
    app_log_path(app, "sayit-desktop.log")
}

#[cfg(not(mobile))]
fn write_diagnostic_log(log_path: &PathBuf, message: &str) {
    if let Ok(mut log_file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(log_file, "[{:?}] {message}", std::time::SystemTime::now());
    }
}

#[cfg(not(mobile))]
fn log_desktop_diagnostic(app: &tauri::AppHandle, message: &str) {
    write_diagnostic_log(&desktop_log_path(app), message);
}

#[cfg(not(mobile))]
fn install_panic_logger(log_path: PathBuf) {
    std::panic::set_hook(Box::new(move |panic_info| {
        let payload = panic_info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| {
                panic_info
                    .payload()
                    .downcast_ref::<String>()
                    .map(String::as_str)
            })
            .unwrap_or("non-string panic payload");
        let location = panic_info
            .location()
            .map(|location| {
                format!(
                    "{}:{}:{}",
                    location.file(),
                    location.line(),
                    location.column()
                )
            })
            .unwrap_or_else(|| "unknown location".to_string());
        write_diagnostic_log(&log_path, &format!("panic at {location}: {payload}"));
    }));
}

#[cfg(not(mobile))]
fn parse_loopback_url(url: &str) -> Result<(String, u16), String> {
    let address = url
        .strip_prefix("http://")
        .ok_or_else(|| "Backend URL is not HTTP.".to_string())?;
    let (host, port) = address
        .split_once(':')
        .ok_or_else(|| "Backend URL is missing a port.".to_string())?;
    if host != "127.0.0.1" {
        return Err("Backend URL is not loopback.".to_string());
    }
    let port = port
        .parse::<u16>()
        .map_err(|_| "Backend URL port is invalid.".to_string())?;
    Ok((host.to_string(), port))
}

#[cfg(not(mobile))]
fn backend_healthcheck(url: &str, token: &str, timeout: Duration) -> Result<(), String> {
    let (host, port) = parse_loopback_url(url)?;
    let address = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|error| format!("Unable to resolve backend address: {error}"))?
        .next()
        .ok_or_else(|| "Backend address did not resolve.".to_string())?;
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| format!("Backend health connection failed: {error}"))?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = format!(
        "GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-SayIt-Token: {token}\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("Backend health request failed: {error}"))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| format!("Backend health response failed: {error}"))?;
    if response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200") {
        Ok(())
    } else {
        Err("Backend health endpoint is not ready.".to_string())
    }
}

#[cfg(not(mobile))]
fn wait_for_backend_health(url: &str, token: &str, deadline: Duration) -> Result<(), String> {
    let started = Instant::now();
    let mut last_error = "Backend health endpoint did not respond.".to_string();
    while started.elapsed() < deadline {
        match backend_healthcheck(url, token, Duration::from_millis(500)) {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = error;
                thread::sleep(Duration::from_millis(150));
            }
        }
    }
    Err(last_error)
}

#[cfg(not(mobile))]
fn spawn_backend(app: &tauri::AppHandle, token: &str) -> Result<BackendProcess, String> {
    let (launch, backend_dir) = resolve_backend_launch(app)?;
    let model_dir = backend_dir.join("models/kokoro");
    let log_path = backend_log_path(app);
    let stderr_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("Unable to open backend log file: {error}"))?;

    let mut child = Command::new(&launch.program)
        .current_dir(&launch.working_dir)
        .args(&launch.args)
        .env("SAYIT_MODEL_DIR", &model_dir)
        .env("SAYIT_BACKEND_TOKEN", token)
        .env("SAYIT_BACKEND_LOG", &log_path)
        .env("SAYIT_PARENT_PID", std::process::id().to_string())
        .env("HF_HUB_OFFLINE", "1")
        .env("TRANSFORMERS_OFFLINE", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::from(stderr_log))
        .spawn()
        .map_err(|error| format!("Unable to start the SayIt backend: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Unable to read the SayIt backend startup output.".to_string())?;
    let mut reader = BufReader::new(stdout);
    let mut backend_url = String::new();
    reader
        .read_line(&mut backend_url)
        .map_err(|error| format!("Unable to read the SayIt backend URL: {error}"))?;
    let backend_url = backend_url.trim().to_string();

    if !backend_url.starts_with("http://127.0.0.1:") {
        terminate_backend(&mut child);
        return Err("SayIt backend did not report a valid loopback URL.".to_string());
    }
    if let Err(error) = wait_for_backend_health(&backend_url, token, Duration::from_secs(20)) {
        terminate_backend(&mut child);
        return Err(format!("SayIt backend failed readiness check: {error}"));
    }
    log_desktop_diagnostic(app, &format!("Backend ready: {backend_url}"));

    thread::spawn(move || {
        for line in reader.lines().map_while(Result::ok) {
            eprintln!("[sayit-backend] {line}");
        }
    });

    Ok(BackendProcess {
        child,
        url: backend_url,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--autoplay-policy=no-user-gesture-required",
    );

    let backend_child: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let setup_backend_child = Arc::clone(&backend_child);
    let backend_connection = Arc::new(Mutex::new(BackendConnection::default()));
    let setup_backend_connection = Arc::clone(&backend_connection);
    let backend_token = Uuid::new_v4().to_string();
    let capture_lock = Arc::new(Mutex::new(()));
    let shortcut_capture_lock = Arc::clone(&capture_lock);

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
            let _ = app.emit("single_instance_requested", ());
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let app_handle = app.clone();
                        let capture_lock = Arc::clone(&shortcut_capture_lock);
                        std::thread::spawn(move || {
                            let _capture_guard = match capture_lock.lock() {
                                Ok(guard) => guard,
                                Err(_) => {
                                    let _ = app_handle
                                        .emit("text_captured", "Selection capture is unavailable.");
                                    return;
                                }
                            };

                            let captured_text = capture_selected_text();

                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }

                            match captured_text {
                                Ok(Some(text)) if text.trim().is_empty() => {
                                    let _ = app_handle.emit("text_captured", "No text selected.");
                                }
                                Ok(Some(text)) => {
                                    let _ = app_handle.emit("text_captured", text);
                                }
                                Ok(None) => {
                                    let _ = app_handle.emit("text_captured", "No text selected.");
                                }
                                Err(error) => {
                                    eprintln!("SayIt selection capture failed: {error}");
                                    #[cfg(not(mobile))]
                                    log_desktop_diagnostic(
                                        &app_handle,
                                        &format!("Selection capture failed: {error}"),
                                    );
                                    let _ = app_handle
                                        .emit("text_captured", "Failed to read selected text.");
                                }
                            }
                        });
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            hide_window,
            update_shortcut,
            get_backend_config
        ])
        .setup(move |app| {
            #[cfg(not(mobile))]
            {
                let desktop_log_path = desktop_log_path(app.handle());
                install_panic_logger(desktop_log_path.clone());
                write_diagnostic_log(&desktop_log_path, "SayIt desktop setup started.");
            }

            let tray_menu = MenuBuilder::new(app)
                .text("show", "Show SayIt")
                .text("settings", "Settings")
                .separator()
                .text("quit", "Quit SayIt")
                .build()?;

            let tray = TrayIconBuilder::with_id("sayit")
                .tooltip("SayIt is running")
                .icon(app.default_window_icon().cloned().unwrap())
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "settings" => {
                        show_main_window(app);
                        let _ = app.emit("open_settings_request", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            app.manage(tray);

            let alt_s = "alt+s".parse::<Shortcut>().unwrap();
            let initial_shortcut = match app.global_shortcut().register(alt_s) {
                Ok(()) => Some(alt_s),
                Err(error) => {
                    eprintln!("SayIt shortcut startup registration failed: {error}");
                    #[cfg(not(mobile))]
                    log_desktop_diagnostic(
                        app.handle(),
                        &format!("Shortcut startup registration failed: {error}"),
                    );
                    None
                }
            };

            let token_for_monitor = backend_token.clone();
            match spawn_backend(app.handle(), &backend_token) {
                Ok(process) => {
                    if let Ok(mut backend_child) = setup_backend_child.lock() {
                        *backend_child = Some(process.child);
                    }
                    if let Ok(mut backend) = setup_backend_connection.lock() {
                        backend.url = process.url;
                        backend.token = backend_token.clone();
                        backend.available = true;
                        backend.last_error.clear();
                    }
                }
                Err(error) => {
                    eprintln!("SayIt backend startup failed: {error}");
                    #[cfg(not(mobile))]
                    log_desktop_diagnostic(
                        app.handle(),
                        &format!("Backend startup failed: {error}"),
                    );
                    if let Ok(mut backend) = setup_backend_connection.lock() {
                        backend.url.clear();
                        backend.token = backend_token.clone();
                        backend.available = false;
                        backend.last_error = error.clone();
                    }
                }
            }
            app.manage(AppState {
                current_shortcut: Mutex::new(initial_shortcut),
                backend_connection: Arc::clone(&setup_backend_connection),
            });
            let monitor_backend_child = Arc::clone(&setup_backend_child);
            let monitor_backend_connection = Arc::clone(&setup_backend_connection);
            let monitor_app = app.handle().clone();
            thread::spawn(move || loop {
                thread::sleep(Duration::from_secs(2));
                let needs_restart = {
                    let mut child_guard = match monitor_backend_child.lock() {
                        Ok(guard) => guard,
                        Err(_) => return,
                    };
                    match child_guard.as_mut().and_then(|child| child.try_wait().ok().flatten()) {
                        Some(status) => {
                            eprintln!("SayIt backend exited: {status}");
                            log_desktop_diagnostic(
                                &monitor_app,
                                &format!("Backend process exited: {status}"),
                            );
                            *child_guard = None;
                            true
                        }
                        None => child_guard.is_none(),
                    }
                };

                if !needs_restart {
                    continue;
                }

                if let Ok(mut backend) = monitor_backend_connection.lock() {
                    backend.available = false;
                    backend.last_error = "Speech service is restarting.".to_string();
                }
                let _ = monitor_app.emit("backend_status", "Speech service is restarting.");

                match spawn_backend(&monitor_app, &token_for_monitor) {
                    Ok(process) => {
                        if let Ok(mut child_guard) = monitor_backend_child.lock() {
                            *child_guard = Some(process.child);
                        }
                        if let Ok(mut backend) = monitor_backend_connection.lock() {
                            backend.url = process.url.clone();
                            backend.token = token_for_monitor.clone();
                            backend.available = true;
                            backend.last_error.clear();
                        }
                        let _ = monitor_app.emit("backend_restarted", ());
                        log_desktop_diagnostic(
                            &monitor_app,
                            &format!("Backend restart succeeded: {}", process.url),
                        );
                    }
                    Err(error) => {
                        eprintln!("SayIt backend restart failed: {error}");
                        log_desktop_diagnostic(
                            &monitor_app,
                            &format!("Backend restart failed: {error}"),
                        );
                        if let Ok(mut backend) = monitor_backend_connection.lock() {
                            backend.available = false;
                            backend.last_error = error.clone();
                        }
                        let _ = monitor_app.emit("backend_status", error);
                        thread::sleep(Duration::from_secs(3));
                    }
                }
            });

            if let Some(window) = app.get_webview_window("main") {
                if initial_shortcut.is_none() {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = app.emit(
                        "shortcut_error",
                        "Default shortcut Alt+S is already in use. Open settings to choose another shortcut.",
                    );
                }
                #[cfg(target_os = "windows")]
                {
                    // No native vibrancy, letting Tauri's transparent: true and CSS handle it
                }

                if let Ok(Some(monitor)) = window.current_monitor() {
                    let screen_size = monitor.size();
                    let window_size = window
                        .outer_size()
                        .unwrap_or(tauri::PhysicalSize::new(320, 180));

                    let x = (screen_size.width as i32 - window_size.width as i32) / 2;
                    // 120 pixels from the bottom
                    let y = screen_size.height as i32 - window_size.height as i32 - 120;

                    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
                }
            }

            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_app_handle, event| {
        if let RunEvent::Exit = event {
            #[cfg(not(mobile))]
            if let Ok(mut backend_child) = backend_child.lock() {
                if let Some(ref mut child) = *backend_child {
                    terminate_backend(child);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        backend_dir_candidates, backend_healthcheck, parse_loopback_url, select_backend_dir,
        should_replace_shortcut, validate_shortcut,
    };
    use std::fs;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;
    use tauri_plugin_global_shortcut::Shortcut;

    #[test]
    fn rejects_reserved_shortcuts() {
        assert!(validate_shortcut("ctrl+c").is_err());
        assert!(validate_shortcut("ALT+TAB").is_err());
    }

    #[test]
    fn rejects_shortcuts_without_modifier() {
        assert!(validate_shortcut("s").is_err());
        assert!(validate_shortcut("space").is_err());
    }

    #[test]
    fn accepts_modified_shortcuts() {
        assert!(validate_shortcut("alt+s").is_ok());
        assert!(validate_shortcut("ctrl+shift+p").is_ok());
    }

    #[test]
    fn shortcut_replacement_is_noop_for_same_shortcut() {
        let shortcut = "alt+s".parse::<Shortcut>().unwrap();

        assert!(!should_replace_shortcut(Some(&shortcut), &shortcut));
    }

    #[test]
    fn shortcut_replacement_required_for_new_or_missing_shortcut() {
        let current = "alt+s".parse::<Shortcut>().unwrap();
        let next = "ctrl+shift+p".parse::<Shortcut>().unwrap();

        assert!(should_replace_shortcut(Some(&current), &next));
        assert!(should_replace_shortcut(None, &next));
    }

    #[test]
    fn accepts_only_loopback_backend_urls() {
        assert_eq!(
            parse_loopback_url("http://127.0.0.1:51234").unwrap(),
            ("127.0.0.1".to_string(), 51234)
        );
        assert!(parse_loopback_url("http://localhost:51234").is_err());
        assert!(parse_loopback_url("https://127.0.0.1:51234").is_err());
        assert!(parse_loopback_url("http://127.0.0.1:not-a-port").is_err());
    }

    #[test]
    fn backend_healthcheck_requires_http_ok() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request_buffer = [0; 1024];
            let request_len = stream.read(&mut request_buffer).unwrap();
            let request = String::from_utf8_lossy(&request_buffer[..request_len]);
            assert!(request.contains("X-SayIt-Token: test-token"));
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK")
                .unwrap();
        });

        backend_healthcheck(
            &format!("http://127.0.0.1:{port}"),
            "test-token",
            Duration::from_secs(1),
        )
        .unwrap();
        server.join().unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request_buffer = [0; 512];
            let _ = stream.read(&mut request_buffer).unwrap();
            stream
                .write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n")
                .unwrap();
        });

        assert!(backend_healthcheck(
            &format!("http://127.0.0.1:{port}"),
            "test-token",
            Duration::from_secs(1),
        )
        .is_err());
        server.join().unwrap();
    }

    #[test]
    fn prefers_bundled_backend_resources() {
        let unique = format!(
            "sayit-backend-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        let resource_backend = root.join("resources/python-backend");
        let dev_backend = root.join("src-tauri/../python-backend");
        fs::create_dir_all(&resource_backend).unwrap();
        fs::create_dir_all(&dev_backend).unwrap();
        fs::write(resource_backend.join("app.py"), "").unwrap();
        fs::write(dev_backend.join("app.py"), "").unwrap();

        let selected = select_backend_dir(backend_dir_candidates(
            Some(root.join("resources")),
            root.join("src-tauri"),
        ))
        .unwrap();

        assert_eq!(selected, resource_backend);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn falls_back_to_runtime_working_directory_in_development() {
        let unique = format!(
            "sayit-backend-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        let dev_backend = root.join("python-backend");
        fs::create_dir_all(&dev_backend).unwrap();
        fs::write(dev_backend.join("app.py"), "").unwrap();

        let selected = select_backend_dir(backend_dir_candidates(
            Some(root.join("missing-resources")),
            root.join("src-tauri"),
        ))
        .unwrap();

        assert_eq!(selected, root.join("src-tauri/../python-backend"));
        fs::remove_dir_all(root).unwrap();
    }
}
