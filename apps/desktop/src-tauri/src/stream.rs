use crate::{
    changes,
    native::{Health, Profile},
    process::Process,
    universe::Galaxy,
};
use serde::Serialize;
use std::io::{self, Write};

pub const CHUNK_BYTES: usize = 256 * 1024;
pub const TRANSFER_BYTES: usize = 16 * 1024 * 1024;

struct BoundedJson {
    bytes: Vec<u8>,
}

impl Write for BoundedJson {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let required = self
            .bytes
            .len()
            .checked_add(buffer.len())
            .ok_or_else(|| io::Error::other("Telemetry size overflow"))?;
        if required > TRANSFER_BYTES {
            return Err(io::Error::other(
                "Telemetry transfer exceeds the 16 MiB limit",
            ));
        }
        if required > self.bytes.capacity() {
            let capacity = required
                .max(self.bytes.capacity().saturating_mul(2))
                .min(TRANSFER_BYTES);
            self.bytes
                .try_reserve_exact(capacity - self.bytes.len())
                .map_err(io::Error::other)?;
        }
        self.bytes.extend_from_slice(buffer);
        Ok(buffer.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[derive(Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum Frame {
    Chunk {
        protocol_version: u32,
        subscription_id: u32,
        transfer_id: String,
        chunk_index: usize,
        chunk_count: usize,
        total_bytes: usize,
        payload: String,
    },
    Error {
        protocol_version: u32,
        subscription_id: u32,
        message: String,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessPatch<'a> {
    observed_at_unix_ms: u64,
    logical_cpus: u32,
    error: u32,
    truncated: bool,
    collection_ms: f64,
    model_build_ms: f64,
    rows: Vec<&'a Process>,
    removed: Vec<String>,
    galaxies: Vec<&'a Galaxy>,
    removed_galaxies: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EventBatch<'a> {
    through_sequence: String,
    evicted_count: String,
    gap_count: String,
    rows: Vec<&'a changes::ProcessEvent>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Packet<'a> {
    protocol_version: u32,
    subscription_id: u32,
    kind: &'static str,
    sequence: &'a str,
    base_sequence: Option<&'a str>,
    abi_version: u32,
    uptime_ms: u64,
    observed_at_unix_ms: u64,
    interval_ms: u32,
    profile: Profile,
    enabled_collectors: u32,
    processes: ProcessPatch<'a>,
    events: EventBatch<'a>,
}

pub fn encode(
    subscription: u32,
    base: Option<&Health>,
    current: &Health,
) -> Result<String, String> {
    let full = base.is_none_or(|before| {
        before.enabled_collectors != current.enabled_collectors
            || before.processes.error != current.processes.error
            || before.processes.truncated
            || current.processes.truncated
    });
    let previous = if full { None } else { base };
    let diff = changes::diff(
        previous.map(|health| health.processes.as_ref()),
        &current.processes,
    )?;
    let events = &current.processes.events;
    let after = base.map_or(0, |health| health.processes.events.last_sequence);
    let oldest_cursor = events
        .last_sequence
        .saturating_sub(events.rows.len() as u64);
    let gap = if base.is_some() {
        oldest_cursor.saturating_sub(after)
    } else {
        0
    };
    let body = Packet {
        protocol_version: 5,
        subscription_id: subscription,
        kind: if full { "snapshot" } else { "delta" },
        sequence: &current.sequence,
        base_sequence: previous.map(|health| health.sequence.as_str()),
        abi_version: current.abi_version,
        uptime_ms: current.uptime_ms,
        observed_at_unix_ms: current.observed_at_unix_ms,
        interval_ms: current.interval_ms,
        profile: current.profile,
        enabled_collectors: current.enabled_collectors,
        processes: ProcessPatch {
            observed_at_unix_ms: current.processes.observed_at_unix_ms,
            logical_cpus: current.processes.logical_cpus,
            error: current.processes.error,
            truncated: current.processes.truncated,
            collection_ms: current.processes.collection_ms,
            model_build_ms: current.processes.model_build_ms,
            rows: diff
                .processes
                .iter()
                .map(|&index| &current.processes.rows[index])
                .collect(),
            galaxies: diff
                .galaxies
                .iter()
                .map(|&index| &current.processes.galaxies[index])
                .collect(),
            removed: diff.removed_processes,
            removed_galaxies: diff.removed_galaxies,
        },
        events: EventBatch {
            through_sequence: events.last_sequence.to_string(),
            evicted_count: events.evicted_count.to_string(),
            gap_count: gap.to_string(),
            rows: events
                .rows
                .iter()
                .filter(|event| {
                    full || event
                        .sequence
                        .parse::<u64>()
                        .is_ok_and(|sequence| sequence > after)
                })
                .collect(),
        },
    };
    let mut output = BoundedJson {
        bytes: Vec::with_capacity(16 * 1024),
    };
    serde_json::to_writer(&mut output, &body).map_err(|error| error.to_string())?;
    String::from_utf8(output.bytes).map_err(|error| error.to_string())
}

pub struct Transfer {
    pub id: u64,
    pub index: usize,
    pub health: Health,
    body: String,
    ranges: Vec<(usize, usize)>,
}

impl Transfer {
    pub fn new(id: u64, health: Health, body: String) -> Result<Self, String> {
        if body.is_empty() || body.len() > TRANSFER_BYTES {
            return Err("Invalid telemetry transfer size".into());
        }
        let mut ranges = Vec::new();
        let mut start = 0;
        while start < body.len() {
            let mut end = (start + CHUNK_BYTES).min(body.len());
            while !body.is_char_boundary(end) {
                end -= 1;
            }
            ranges.push((start, end));
            start = end;
        }
        Ok(Self {
            id,
            index: 0,
            health,
            body,
            ranges,
        })
    }

    pub fn frame(&self, subscription: u32) -> Frame {
        let (start, end) = self.ranges[self.index];
        Frame::Chunk {
            protocol_version: 5,
            subscription_id: subscription,
            transfer_id: self.id.to_string(),
            chunk_index: self.index,
            chunk_count: self.ranges.len(),
            total_bytes: self.body.len(),
            payload: self.body[start..end].to_owned(),
        }
    }

    pub fn advance(&mut self) -> bool {
        self.index += 1;
        self.index == self.ranges.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native::Engine;
    #[test]
    fn serialization_buffer_rejects_oversize_before_growth() {
        let mut writer = BoundedJson { bytes: Vec::new() };
        assert!(writer.write_all(&vec![b'x'; TRANSFER_BYTES + 1]).is_err());
        assert_eq!(writer.bytes.capacity(), 0);
        assert!(writer.bytes.is_empty());
    }
    #[test]
    fn utf8_chunks_reconstruct_and_stay_under_wire_cap() {
        let (_, health) = Engine::new().unwrap().wait(0, 0).unwrap().unwrap();
        let source = "\u{1f680}\\\"\n".repeat(100000);
        let mut transfer = Transfer::new(1, health, source.clone()).unwrap();
        let mut reconstructed = String::new();
        loop {
            let frame = transfer.frame(1);
            assert!(serde_json::to_vec(&frame).unwrap().len() < 1024 * 1024);
            if let Frame::Chunk { payload, .. } = frame {
                reconstructed.push_str(&payload);
            }
            if transfer.advance() {
                break;
            }
        }
        assert_eq!(source, reconstructed);
    }

    #[test]
    fn unchanged_snapshot_encodes_empty_delta() {
        let (_, first) = Engine::new().unwrap().wait(0, 0).unwrap().unwrap();
        let mut next = first.clone();
        next.sequence = "2".into();
        let full: serde_json::Value =
            serde_json::from_str(&encode(1, None, &first).unwrap()).unwrap();
        let delta: serde_json::Value =
            serde_json::from_str(&encode(1, Some(&first), &next).unwrap()).unwrap();
        assert_eq!(full["kind"], "snapshot");
        assert_eq!(delta["kind"], "delta");
        assert_eq!(delta["baseSequence"], "1");
        assert!(delta["processes"]["rows"].as_array().unwrap().is_empty());
    }
}
