mod bridge;
mod changes;
mod filesystem;
mod native;
mod network;
mod process;
mod stream;
mod universe;
mod storage;

use bridge::{Bridge, Frame, RecordingStatus};
use native::Profile;
use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
use tauri::{ipc::Channel, Manager, State};

struct CoreState(Result<Arc<Bridge>, String>);

#[derive(Default)]
struct HistoryJobs(Arc<AtomicUsize>);

struct HistoryPermit(Arc<AtomicUsize>);

impl HistoryJobs {
    fn acquire(&self) -> Result<HistoryPermit, String> {
        self.0.fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| (count < 2).then_some(count + 1))
            .map_err(|_| "History is busy; retry after the current operation")?;
        Ok(HistoryPermit(self.0.clone()))
    }
}

impl Drop for HistoryPermit {
    fn drop(&mut self) { self.0.fetch_sub(1, Ordering::AcqRel); }
}

async fn run_history<T: Send + 'static>(jobs: &HistoryJobs, work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let permit = jobs.acquire()?;
    tauri::async_runtime::spawn_blocking(move || { let _permit = permit; work() })
        .await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn subscribe_core(
    state: State<'_, CoreState>,
    on_frame: Channel<Frame>,
    protocol_version: u32,
) -> Result<u32, String> {
    if protocol_version != 7 {
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
        .manage(HistoryJobs::default())
        .manage(std::sync::Arc::new(bridge::qualification::PressureState::default()))
        .manage(CoreState(Bridge::new().and_then(|bridge| {
            bridge.set_process_collection(true)?;
            bridge.set_network_collection(true)?;
            Ok(Arc::new(bridge))
        })))
        .invoke_handler(tauri::generate_handler![
            subscribe_core,
            ack_core,
            resync_core,
            unsubscribe_core,
            set_profile,
            set_process_collection,
            set_network_collection,
            filesystem_root,
            filesystem_navigate,
            filesystem_stop,
            set_recording,
            recording_status,
            history_sessions,
            history_events,
            history_checkpoints,
            history_checkpoint,
            bridge::qualification::pressure_run,
            bridge::qualification::pressure_ack
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

#[tauri::command]
fn filesystem_root(state: State<CoreState>, path: String) -> Result<(), String> {
    state
        .0
        .as_ref()
        .map_err(Clone::clone)?
        .filesystem_command(0, &path, 0, 0)
}
#[tauri::command]
fn filesystem_navigate(
    state: State<CoreState>,
    scope: String,
    entry: String,
) -> Result<(), String> {
    state.0.as_ref().map_err(Clone::clone)?.filesystem_command(
        1,
        "",
        scope.parse().map_err(|_| "Invalid folder scope")?,
        entry.parse().map_err(|_| "Invalid entry token")?,
    )
}
#[tauri::command]
fn filesystem_stop(state: State<CoreState>) -> Result<(), String> {
    state
        .0
        .as_ref()
        .map_err(Clone::clone)?
        .filesystem_command(2, "", 0, 0)
}

#[tauri::command]
async fn set_recording(
    state: State<'_, CoreState>,
    jobs: State<'_, HistoryJobs>,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<RecordingStatus, String> {
    let bridge = state.0.as_ref().map_err(Clone::clone)?.clone();
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    run_history(&jobs, move || if enabled { bridge.start_recording(&directory) } else { bridge.stop_recording() }).await
}

#[tauri::command]
fn recording_status(state: State<CoreState>) -> Result<RecordingStatus, String> {
    state.0.as_ref().map_err(Clone::clone)?.recording_status()
}

#[tauri::command]
async fn history_sessions(
    state: State<'_, CoreState>,
    jobs: State<'_, HistoryJobs>,
    app: tauri::AppHandle,
) -> Result<Vec<storage::SessionInfo>, String> {
    state.0.as_ref().map_err(Clone::clone)?;
    let path = app.path().app_data_dir().map_err(|error| error.to_string())?.join("history.sqlite");
    run_history(&jobs, move || if !path.exists() { Ok(Vec::new()) } else { storage::sessions(&path, 50).map_err(|error| error.to_string()) }).await
}

#[tauri::command]
async fn history_events(
    state: State<'_, CoreState>,
    jobs: State<'_, HistoryJobs>,
    app: tauri::AppHandle,
    session: String,
    since_ms: i64,
) -> Result<Vec<storage::EventInfo>, String> {
    state.0.as_ref().map_err(Clone::clone)?;
    if session.len() > 128 || since_ms < 0 {
        return Err("Invalid history query".into());
    }
    let path = app.path().app_data_dir().map_err(|error| error.to_string())?.join("history.sqlite");
    run_history(&jobs, move || if !path.exists() { Ok(Vec::new()) } else { storage::events(&path, &session, since_ms, 100).map_err(|error| error.to_string()) }).await
}

#[tauri::command]
async fn history_checkpoints(
    state: State<'_, CoreState>, jobs: State<'_, HistoryJobs>, app: tauri::AppHandle, session: String,
) -> Result<Vec<i64>, String> {
    state.0.as_ref().map_err(Clone::clone)?;
    if session.is_empty() || session.len() > 128 { return Err("Invalid history session".into()); }
    let path = app.path().app_data_dir().map_err(|error| error.to_string())?.join("history.sqlite");
    run_history(&jobs, move || if !path.exists() { Ok(Vec::new()) } else { storage::checkpoint_times(&path, &session).map_err(|error| error.to_string()) }).await
}

#[tauri::command]
async fn history_checkpoint(
    state: State<'_, CoreState>, jobs: State<'_, HistoryJobs>, app: tauri::AppHandle, session: String, at_ms: i64,
) -> Result<Option<storage::ReplayInfo>, String> {
    state.0.as_ref().map_err(Clone::clone)?;
    if session.is_empty() || session.len() > 128 || at_ms < 0 { return Err("Invalid history query".into()); }
    let path = app.path().app_data_dir().map_err(|error| error.to_string())?.join("history.sqlite");
    run_history(&jobs, move || if !path.exists() { Ok(None) } else { storage::replay(&path, &session, at_ms).map_err(|error| error.to_string()) }).await
}

#[cfg(test)]
mod history_job_tests {
    use super::*;

    #[test]
    fn bounds_history_jobs_and_releases_permits_on_error() {
        let jobs = HistoryJobs::default();
        let first = jobs.acquire().unwrap();
        let second = jobs.acquire().unwrap();
        assert!(jobs.acquire().is_err());
        drop(first);
        assert!(jobs.acquire().is_ok());
        drop(second);
        let failed: Result<(), String> = tauri::async_runtime::block_on(run_history(&jobs, || Err("database unavailable".into())));
        assert!(failed.is_err());
        assert_eq!(jobs.0.load(Ordering::Acquire), 0);
    }
}
