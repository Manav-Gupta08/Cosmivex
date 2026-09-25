mod bridge;
mod native;
mod process;
mod universe;

use bridge::{Bridge, Frame};
use native::Profile;
use tauri::{ipc::Channel, Manager, State};

struct CoreState(Result<Bridge, String>);

#[tauri::command]
fn subscribe_core(
    state: State<CoreState>,
    on_frame: Channel<Frame>,
    protocol_version: u32,
) -> Result<u32, String> {
    if protocol_version != 3 {
        return Err("Unsupported UI protocol version".into());
    }
    state.0.as_ref().map_err(Clone::clone)?.subscribe(on_frame)
}

#[tauri::command]
fn ack_core(state: State<CoreState>, subscription_id: u32, sequence: String) -> Result<(), String> {
    state
        .0
        .as_ref()
        .map_err(Clone::clone)?
        .ack(subscription_id, &sequence)
}

#[tauri::command]
fn unsubscribe_core(state: State<CoreState>, subscription_id: u32) -> Result<(), String> {
    state
        .0
        .as_ref()
        .map_err(Clone::clone)?
        .unsubscribe(subscription_id)
}

#[tauri::command]
fn set_profile(state: State<CoreState>, profile: Profile) -> Result<(), String> {
    state.0.as_ref().map_err(Clone::clone)?.set_profile(profile)
}

pub fn run(context: tauri::Context<tauri::Wry>) {
    tauri::Builder::default()
        .manage(CoreState(Bridge::new().and_then(|bridge| {
            bridge.set_process_collection(true)?;
            Ok(bridge)
        })))
        .invoke_handler(tauri::generate_handler![
            subscribe_core,
            ack_core,
            unsubscribe_core,
            set_profile,
            set_process_collection
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Ok(bridge) = &window.state::<CoreState>().0 {
                    bridge.shutdown();
                }
            }
        })
        .run(context)
        .expect("Unable to start Universe OS");
}

#[tauri::command]
fn set_process_collection(state: State<CoreState>, enabled: bool) -> Result<(), String> {
    state
        .0
        .as_ref()
        .map_err(Clone::clone)?
        .set_process_collection(enabled)
}
