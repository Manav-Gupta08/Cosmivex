use crate::native::{Engine, Health, Profile};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::JoinHandle;
use tauri::ipc::Channel;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    subscription_id: u32,
    #[serde(flatten)]
    health: Health,
}

struct Subscriber {
    id: u32,
    channel: Channel<Frame>,
    in_flight: Option<u64>,
    delivered: u64,
}

struct Delivery {
    latest: (u64, Health),
    next_id: u32,
    subscriber: Option<Subscriber>,
}

impl Delivery {
    fn send_latest(&mut self) {
        if let Some(subscriber) = &mut self.subscriber {
            if subscriber.in_flight.is_some() || self.latest.0 <= subscriber.delivered {
                return;
            }
            let frame = Frame {
                subscription_id: subscriber.id,
                health: self.latest.1.clone(),
            };
            if subscriber.channel.send(frame).is_err() {
                self.subscriber = None;
            } else {
                subscriber.in_flight = Some(self.latest.0);
                subscriber.delivered = self.latest.0;
            }
        }
    }
}

pub struct Bridge {
    engine: Arc<Engine>,
    delivery: Arc<Mutex<Delivery>>,
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
        let (worker_engine, worker_delivery, worker_stopping) =
            (engine.clone(), delivery.clone(), stopping.clone());
        let worker = std::thread::Builder::new()
            .name("core-bridge".into())
            .spawn(move || {
                let mut after = initial_sequence;
                while !worker_stopping.load(Ordering::Acquire) {
                    match worker_engine.wait(after, 30000) {
                        Ok(Some(latest)) => {
                            after = latest.0;
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
            in_flight: None,
            delivered: 0,
        });
        delivery.send_latest();
        Ok(id)
    }

    pub fn ack(&self, id: u32, sequence: &str) -> Result<(), String> {
        let sequence = sequence.parse::<u64>().map_err(|_| "Invalid sequence")?;
        let mut delivery = self
            .delivery
            .lock()
            .map_err(|_| "Core bridge unavailable")?;
        if let Some(subscriber) = &mut delivery.subscriber {
            if subscriber.id == id && subscriber.in_flight == Some(sequence) {
                subscriber.in_flight = None;
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

    pub fn shutdown(&self) {
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
            delivery.latest.0 += 10000;
            delivery.latest.1.sequence = delivery.latest.0.to_string();
            delivery.send_latest();
        }
        assert_eq!(count.load(Ordering::Relaxed), 1);
        bridge.ack(first, "999").unwrap();
        assert_eq!(count.load(Ordering::Relaxed), 1);
        bridge.ack(first, "1").unwrap();
        assert_eq!(count.load(Ordering::Relaxed), 2);
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
}
