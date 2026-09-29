use crate::native::{Engine, Health, Profile};
use crate::storage::Writer;
pub use crate::stream::Frame;
use crate::stream::{self, Transfer};
use serde::Serialize;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{self, SyncSender, TrySendError}, Arc, Mutex,
};
use std::thread::JoinHandle;
use tauri::ipc::Channel;

struct Subscriber {
    id: u32,
    channel: Channel<Frame>,
    base: Option<Health>,
    pending: Option<Transfer>,
    next_transfer: u64,
}

struct Delivery {
    latest: (u64, Health),
    next_id: u32,
    subscriber: Option<Subscriber>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    pub enabled: bool,
    pub error: Option<String>,
}

#[derive(Default)]
struct Recording {
    sender: Option<SyncSender<Health>>,
    worker: Option<JoinHandle<()>>,
    status: RecordingStatus,
}

impl Delivery {
    fn send_latest(&mut self) {
        if let Some(subscriber) = &mut self.subscriber {
            if subscriber.pending.is_some()
                || subscriber
                    .base
                    .as_ref()
                    .is_some_and(|base| base.sequence == self.latest.1.sequence)
            {
                return;
            }
            let transfer = stream::encode(subscriber.id, subscriber.base.as_ref(), &self.latest.1)
                .and_then(|body| {
                    subscriber.next_transfer = subscriber
                        .next_transfer
                        .checked_add(1)
                        .ok_or("Transfer ID exhausted")?;
                    Transfer::new(subscriber.next_transfer, self.latest.1.clone(), body)
                });
            match transfer {
                Ok(transfer) => {
                    if subscriber
                        .channel
                        .send(transfer.frame(subscriber.id))
                        .is_err()
                    {
                        self.subscriber = None;
                    } else {
                        subscriber.pending = Some(transfer);
                    }
                }
                Err(message) => {
                    let _ = subscriber.channel.send(Frame::Error {
                        protocol_version: 7,
                        subscription_id: subscriber.id,
                        message,
                    });
                    self.subscriber = None;
                }
            }
        }
    }
}

pub struct Bridge {
    engine: Arc<Engine>,
    delivery: Arc<Mutex<Delivery>>,
    recording: Arc<Mutex<Recording>>,
    stopping: Arc<AtomicBool>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl Bridge {
    pub fn new() -> Result<Self, String> {
        let engine = Arc::new(Engine::new()?);
        let latest = engine.wait(0, 0)?.ok_or("Core returned no initial state")?;
        let initial_sequence = latest.0;
        let delivery = Arc::new(Mutex::new(Delivery {
            latest,
            next_id: 0,
            subscriber: None,
        }));
        let stopping = Arc::new(AtomicBool::new(false));
        let recording = Arc::new(Mutex::new(Recording::default()));
        let (worker_engine, worker_delivery, worker_stopping) =
            (engine.clone(), delivery.clone(), stopping.clone());
        let worker_recording = recording.clone();
        let worker = std::thread::Builder::new()
            .name("core-bridge".into())
            .spawn(move || {
                let mut after = initial_sequence;
                while !worker_stopping.load(Ordering::Acquire) {
                    match worker_engine.wait(after, 30000) {
                        Ok(Some(latest)) => {
                            after = latest.0;
                            if let Ok(recording) = worker_recording.lock() {
                                if let Some(sender) = &recording.sender {
                                    match sender.try_send(latest.1.clone()) {
                                        Ok(()) | Err(TrySendError::Full(_)) => {}
                                        Err(TrySendError::Disconnected(_)) => {}
                                    }
                                }
                            }
                            let Ok(mut delivery) = worker_delivery.lock() else {
                                break;
                            };
                            delivery.latest = latest;
                            delivery.send_latest();
                        }
                        Ok(None) => {}
                        Err(error) => {
                            eprintln!("{error}");
                            break;
                        }
                    }
                }
            })
            .map_err(|error| error.to_string())?;
        Ok(Self {
            engine,
            delivery,
            recording,
            stopping,
            worker: Mutex::new(Some(worker)),
        })
    }

    pub fn subscribe(&self, channel: Channel<Frame>) -> Result<u32, String> {
        let mut delivery = self
            .delivery
            .lock()
            .map_err(|_| "Core bridge unavailable")?;
        delivery.next_id = delivery
            .next_id
            .checked_add(1)
            .ok_or("Subscription ID exhausted")?;
        let id = delivery.next_id;
        delivery.subscriber = Some(Subscriber {
            id,
            channel,
            base: None,
            pending: None,
            next_transfer: 0,
        });
        delivery.send_latest();
        Ok(id)
    }

    pub fn ack(&self, id: u32, transfer_id: &str, chunk_index: usize) -> Result<(), String> {
        let transfer_id = transfer_id
            .parse::<u64>()
            .map_err(|_| "Invalid transfer ID")?;
        let mut delivery = self
            .delivery
            .lock()
            .map_err(|_| "Core bridge unavailable")?;
        if let Some(subscriber) = &mut delivery.subscriber {
            if subscriber.id != id {
                return Ok(());
            }
            if let Some(transfer) = &mut subscriber.pending {
                if transfer.id != transfer_id || transfer.index != chunk_index {
                    return Ok(());
                }
                if transfer.advance() {
                    subscriber.base = subscriber.pending.take().map(|transfer| transfer.health);
                    delivery.send_latest();
                } else if subscriber.channel.send(transfer.frame(id)).is_err() {
                    delivery.subscriber = None;
                }
            }
        }
        Ok(())
    }

    pub fn resync(&self, id: u32) -> Result<(), String> {
        let mut delivery = self
            .delivery
            .lock()
            .map_err(|_| "Core bridge unavailable")?;
        if let Some(subscriber) = &mut delivery.subscriber {
            if subscriber.id == id {
                subscriber.base = None;
                subscriber.pending = None;
                delivery.send_latest();
            }
        }
        Ok(())
    }

    pub fn unsubscribe(&self, id: u32) -> Result<(), String> {
        let mut delivery = self
            .delivery
            .lock()
            .map_err(|_| "Core bridge unavailable")?;
        if delivery
            .subscriber
            .as_ref()
            .is_some_and(|subscriber| subscriber.id == id)
        {
            delivery.subscriber = None;
        }
        Ok(())
    }

    pub fn set_profile(&self, profile: Profile) -> Result<(), String> {
        self.engine.set_profile(profile)
    }

    pub fn set_process_collection(&self, enabled: bool) -> Result<(), String> {
        self.engine.set_process_collection(enabled)
    }

    pub fn set_network_collection(&self, enabled: bool) -> Result<(), String> {
        self.engine.set_network_collection(enabled)
    }

    pub fn filesystem_command(
        &self,
        action: u32,
        root: &str,
        scope: u64,
        entry: u64,
    ) -> Result<(), String> {
        self.engine.filesystem_command(action, root, scope, entry)
    }

    pub fn recording_status(&self) -> Result<RecordingStatus, String> {
        self.recording.lock().map(|state| state.status.clone()).map_err(|_| "Recording state unavailable".into())
    }

    pub fn start_recording(&self, directory: &Path) -> Result<RecordingStatus, String> {
        if self.recording_status()?.enabled {
            return self.recording_status();
        }
        self.stop_recording()?;
        let health = self.delivery.lock().map_err(|_| "Core bridge unavailable")?.latest.1.clone();
        let writer = (|| {
            std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
            Writer::start(&directory.join("history.sqlite"), &health).map_err(|error| error.to_string())
        })().inspect_err(|error| {
            if let Ok(mut state) = self.recording.lock() {
                state.status.error = Some(error.clone());
            }
        })?;
        let (sender, receiver) = mpsc::sync_channel::<Health>(1);
        let recording = self.recording.clone();
        let worker = std::thread::Builder::new()
            .name("history-writer".into())
            .spawn(move || {
                let mut writer = writer;
                let mut ended_ms = health.observed_at_unix_ms;
                for next in receiver {
                    ended_ms = next.observed_at_unix_ms;
                    if let Err(error) = writer.record(&next, false) {
                        if let Ok(mut state) = recording.lock() {
                            state.sender = None;
                            state.status = RecordingStatus { enabled: false, error: Some(error.to_string()) };
                        }
                        break;
                    }
                }
                if let Err(error) = writer.finish(ended_ms) {
                    if let Ok(mut state) = recording.lock() {
                        state.sender = None;
                        if state.status.error.is_none() {
                            state.status = RecordingStatus { enabled: false, error: Some(error.to_string()) };
                        }
                    }
                }
            })
            .map_err(|error| error.to_string())?;
        let mut state = self.recording.lock().map_err(|_| "Recording state unavailable")?;
        state.sender = Some(sender);
        state.worker = Some(worker);
        state.status = RecordingStatus { enabled: true, error: None };
        Ok(state.status.clone())
    }

    pub fn stop_recording(&self) -> Result<RecordingStatus, String> {
        let worker = {
            let mut state = self.recording.lock().map_err(|_| "Recording state unavailable")?;
            state.sender = None;
            state.status = RecordingStatus::default();
            state.worker.take()
        };
        if let Some(worker) = worker {
            worker.join().map_err(|_| "History writer stopped unexpectedly")?;
        }
        self.recording_status()
    }

    pub fn shutdown(&self) {
        let _ = self.stop_recording();
        self.stopping.store(true, Ordering::Release);
        self.engine.stop();
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn recording_is_opt_in_and_closes_its_session() {
        let directory = std::env::temp_dir().join(format!(
            "universe-bridge-history-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let bridge = Bridge::new().unwrap();
        assert!(!bridge.recording_status().unwrap().enabled);
        assert!(!directory.exists());
        std::fs::create_dir(&directory).unwrap();
        let invalid_directory = directory.join("file");
        std::fs::write(&invalid_directory, b"not a directory").unwrap();
        assert!(bridge.start_recording(&invalid_directory).is_err());
        assert!(bridge.recording_status().unwrap().error.is_some());
        assert!(bridge.start_recording(&directory).unwrap().enabled);
        let initial_sequence = bridge.delivery.lock().unwrap().latest.0;
        bridge.set_profile(Profile::Eco).unwrap();
        assert!(bridge.engine.wait(initial_sequence, 5000).unwrap().is_some());
        assert!(bridge.recording_status().unwrap().enabled);
        assert!(bridge.stop_recording().is_ok());
        assert!(!bridge.recording_status().unwrap().enabled);
        bridge.shutdown();
        let connection = crate::storage::open(&directory.join("history.sqlite")).unwrap();
        let (sessions, closed, checkpoints): (i64, i64, i64) = connection.query_row(
            "SELECT count(*), count(ended_ms), (SELECT count(*) FROM checkpoints) FROM sessions",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        ).unwrap();
        assert_eq!((sessions, closed), (1, 1));
        assert!(checkpoints >= 1);
        assert_eq!(crate::storage::sessions(&directory.join("history.sqlite"), 1).unwrap().len(), 1);
        drop(connection);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn channel_has_one_in_flight_and_replacement_is_safe() {
        let bridge = Bridge::new().unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let sent = count.clone();
        let first = bridge
            .subscribe(Channel::new(move |_| {
                sent.fetch_add(1, Ordering::Relaxed);
                Ok(())
            }))
            .unwrap();
        assert_eq!(count.load(Ordering::Relaxed), 1);
        {
            let mut delivery = bridge.delivery.lock().unwrap();
            for _ in 0..50_000 {
                delivery.latest.0 += 1;
                delivery.latest.1.sequence = delivery.latest.0.to_string();
                delivery.send_latest();
            }
        }
        assert_eq!(count.load(Ordering::Relaxed), 1);
        bridge.ack(first, "999", 0).unwrap();
        assert_eq!(count.load(Ordering::Relaxed), 1);
        bridge.ack(first, "1", 0).unwrap();
        assert_eq!(count.load(Ordering::Relaxed), 2);
        {
            let delivery = bridge.delivery.lock().unwrap();
            assert_eq!(delivery.subscriber.as_ref().unwrap().pending.as_ref().unwrap().health.sequence, delivery.latest.1.sequence);
        }
        bridge.resync(first).unwrap();
        assert_eq!(count.load(Ordering::Relaxed), 3);
        bridge.ack(first, "2", 0).unwrap();
        assert_eq!(count.load(Ordering::Relaxed), 3);
        let second = bridge.subscribe(Channel::new(|_| Ok(()))).unwrap();
        bridge.unsubscribe(first).unwrap();
        assert_eq!(
            bridge
                .delivery
                .lock()
                .unwrap()
                .subscriber
                .as_ref()
                .unwrap()
                .id,
            second
        );
        bridge.unsubscribe(second).unwrap();
        assert!(bridge.delivery.lock().unwrap().subscriber.is_none());
        bridge.shutdown();
        bridge.shutdown();
    }

    #[test]
    fn multi_chunk_transfer_advances_base_only_after_last_ack() {
        let bridge = Bridge::new().unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let sent = count.clone();
        let id = bridge
            .subscribe(Channel::new(move |_| {
                sent.fetch_add(1, Ordering::Relaxed);
                Ok(())
            }))
            .unwrap();
        {
            let mut delivery = bridge.delivery.lock().unwrap();
            let health = delivery.latest.1.clone();
            let subscriber = delivery.subscriber.as_mut().unwrap();
            subscriber.pending =
                Some(Transfer::new(2, health, "x".repeat(stream::CHUNK_BYTES * 2 + 1)).unwrap());
            subscriber.next_transfer = 2;
        }
        bridge.ack(id, "2", 0).unwrap();
        assert!(bridge
            .delivery
            .lock()
            .unwrap()
            .subscriber
            .as_ref()
            .unwrap()
            .base
            .is_none());
        assert_eq!(count.load(Ordering::Relaxed), 2);
        bridge.ack(id, "2", 0).unwrap();
        assert_eq!(count.load(Ordering::Relaxed), 2);
        bridge.ack(id, "2", 1).unwrap();
        assert!(bridge
            .delivery
            .lock()
            .unwrap()
            .subscriber
            .as_ref()
            .unwrap()
            .base
            .is_none());
        bridge.ack(id, "2", 2).unwrap();
        assert!(bridge
            .delivery
            .lock()
            .unwrap()
            .subscriber
            .as_ref()
            .unwrap()
            .base
            .is_some());
        assert!(bridge
            .delivery
            .lock()
            .unwrap()
            .subscriber
            .as_ref()
            .unwrap()
            .pending
            .is_none());
        bridge.shutdown();
    }
}
