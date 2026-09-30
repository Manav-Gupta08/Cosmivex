use super::{Delivery, Subscriber};
use crate::{changes::{Events, ProcessEvent}, native::Engine, stream::Frame};
use serde::Serialize;
use std::{collections::VecDeque, sync::{Arc, Mutex}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tauri::{ipc::Channel, State};

#[derive(Default)]
pub struct PressureState(Mutex<Option<Arc<Mutex<Delivery>>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PressureReport {
    generated: u64,
    producer_seconds: f64,
    generated_per_second: f64,
    retained_events: usize,
    evicted_events: u64,
    acknowledged_cursor: u64,
    pending_transfers: usize,
}

fn enabled() -> Result<(), String> {
    if std::env::var("UOS_QUALIFICATION").as_deref() == Ok("1") { Ok(()) }
    else { Err("Isolated qualification is disabled".into()) }
}

#[tauri::command]
pub async fn pressure_ack(state: State<'_, Arc<PressureState>>, transfer_id: String, chunk_index: usize) -> Result<(), String> {
    enabled()?;
    let active = state.0.lock().map_err(|_| "Pressure state unavailable")?.clone();
    if let Some(active) = active {
        active.lock().map_err(|_| "Pressure delivery unavailable")?
            .acknowledge(1, transfer_id.parse().map_err(|_| "Invalid transfer ID")?, chunk_index);
    }
    Ok(())
}

#[tauri::command]
pub async fn pressure_run(state: State<'_, Arc<PressureState>>, on_frame: Channel<Frame>, seconds: u32) -> Result<PressureReport, String> {
    enabled()?;
    if !(5..=120).contains(&seconds) { return Err("Pressure duration must be 5-120 seconds".into()); }
    let engine = Engine::new()?;
    let latest = engine.wait(0, 0)?.ok_or("Missing isolated baseline")?;
    engine.stop();
    let active = Arc::new(Mutex::new(Delivery { latest, next_id: 1, subscriber: Some(Subscriber {
        id: 1, channel: on_frame, base: None, pending: None, next_transfer: 0,
    }) }));
    {
        let mut slot = state.0.lock().map_err(|_| "Pressure state unavailable")?;
        if slot.is_some() { return Err("Pressure run already active".into()); }
        *slot = Some(active.clone());
    }
    let result = tauri::async_runtime::spawn_blocking(move || produce(active, seconds)).await.map_err(|error| error.to_string());
    state.0.lock().map_err(|_| "Pressure state unavailable")?.take();
    result?
}

fn produce(active: Arc<Mutex<Delivery>>, seconds: u32) -> Result<PressureReport, String> {
    let mut health = active.lock().map_err(|_| "Pressure delivery unavailable")?.latest.1.clone();
    let initial_sequence: u64 = health.sequence.parse().map_err(|_| "Invalid baseline")?;
    let template = health.processes.clone();
    let mut retained = VecDeque::with_capacity(256);
    let started = Instant::now();
    let mut generated = 0_u64;
    let mut revision = initial_sequence;
    active.lock().map_err(|_| "Pressure delivery unavailable")?.send_latest();
    loop {
        let elapsed = started.elapsed().as_secs_f64().min(f64::from(seconds));
        let target = (elapsed * 50_000.0).floor() as u64;
        let observed_ms = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis() as u64;
        while generated < target {
            generated += 1;
            if retained.len() == 256 { retained.pop_front(); }
            retained.push_back(ProcessEvent {
                sequence: generated.to_string(), observed_at_unix_ms: observed_ms, previous_observed_at_unix_ms: observed_ms,
                monotonic_ns: started.elapsed().as_nanos().to_string(), process_id: Some(format!("42:{}", generated.div_ceil(2))), pid: 42,
                kind: if generated % 2 == 1 { "PROCESS_CREATED" } else { "PROCESS_TERMINATED" }, reason: "observation",
                name: "isolated-pressure-fixture".into(), resource_value: None, resource_threshold: None,
            });
        }
        revision += 1;
        let mut snapshot = (*template).clone();
        snapshot.events = Events { last_sequence: generated, evicted_count: generated.saturating_sub(retained.len() as u64), rows: retained.iter().cloned().collect() };
        health.sequence = revision.to_string();
        health.observed_at_unix_ms = observed_ms;
        health.processes = Arc::new(snapshot);
        {
            let mut delivery = active.lock().map_err(|_| "Pressure delivery unavailable")?;
            if delivery.subscriber.is_none() { return Err("Pressure consumer disconnected".into()); }
            delivery.latest = (revision, health.clone());
            delivery.send_latest();
        }
        if generated >= u64::from(seconds) * 50_000 { break; }
        std::thread::sleep(Duration::from_millis(20));
    }
    let producer_seconds = started.elapsed().as_secs_f64();
    let drain_deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let delivery = active.lock().map_err(|_| "Pressure delivery unavailable")?;
        let subscriber = delivery.subscriber.as_ref().ok_or("Pressure consumer disconnected")?;
        let cursor = subscriber.base.as_ref().map_or(0, |base| base.processes.events.last_sequence);
        if cursor == generated || Instant::now() >= drain_deadline {
            return Ok(PressureReport { generated, producer_seconds, generated_per_second: generated as f64 / producer_seconds,
                retained_events: retained.len(), evicted_events: generated.saturating_sub(retained.len() as u64),
                acknowledged_cursor: cursor, pending_transfers: usize::from(subscriber.pending.is_some()) });
        }
        drop(delivery);
        std::thread::sleep(Duration::from_millis(20));
    }
}