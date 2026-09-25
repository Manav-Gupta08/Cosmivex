mod bridge;
mod changes;
mod native;
mod network;
mod process;
mod stream;
mod universe;

use bridge::{Bridge, Frame};
use native::Profile;
use tauri::{ipc::Channel, Manager, State};

struct CoreState(Result<Bridge, String>);

#[tauri::command]
async fn subscribe_core(
    state: State<'_, CoreState>,
    on_frame: Channel<Frame>,
    protocol_version: u32,
) -> Result<u32, String> {
    if protocol_version != 6 {
        return Err("Unsupported UI protocol version".into());
    }
    state.0.as_ref().map_err(Clone::clone)?.subscribe(on_frame)
}

#[tauri::command]
async fn ack_core(
    state: State<'_, CoreState>,
    subscription_id: u32,
    transfer_id: String,
    chunk_index: usize,
) -> Result<(), String> {
    state
        .0
        .as_ref()
        .map_err(Clone::clone)?
        .ack(subscription_id, &transfer_id, chunk_index)
}

#[tauri::command]
async fn resync_core(state: State<'_, CoreState>, subscription_id: u32) -> Result<(), String> {
    state
        .0
        .as_ref()
        .map_err(Clone::clone)?
        .resync(subscription_id)
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
            bridge.set_network_collection(true)?;
            Ok(bridge)
        })))
        .invoke_handler(tauri::generate_handler![
            subscribe_core,
            ack_core,
            resync_core,
            unsubscribe_core,
            set_profile,
            set_process_collection,
            set_network_collection
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

#[tauri::command]
fn set_network_collection(state: State<CoreState>, enabled: bool) -> Result<(), String> {
    state
        .0
        .as_ref()
        .map_err(Clone::clone)?
        .set_network_collection(enabled)
}
