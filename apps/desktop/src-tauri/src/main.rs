#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    universe_host::run(tauri::generate_context!());
}
