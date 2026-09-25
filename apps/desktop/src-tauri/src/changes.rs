use crate::process::ProcessSnapshot;
use serde::Serialize;
use std::{ffi::c_void, mem::size_of, ptr::NonNull};

#[repr(C)]
#[derive(Default)]
struct EventInfo {
    abi_version: u32,
    struct_size: u32,
    count: u32,
    reserved: u32,
    last_sequence: u64,
    evicted_count: u64,
}
#[repr(C)]
#[derive(Default)]
struct EventRow {
    sequence: u64,
    observed_at_unix_ms: u64,
    previous_observed_at_unix_ms: u64,
    monotonic_ns: u64,
    generation: u64,
    pid: u32,
    kind: u32,
    reason: u32,
    name_length: u32,
    name: *const u8,
}
#[repr(C)]
#[derive(Default)]
struct DeltaInfo {
    abi_version: u32,
    struct_size: u32,
    count: u32,
    reserved: u32,
}
#[repr(C)]
#[derive(Default)]
struct ChangeRow {
    kind: u32,
    index: u32,
    pid: u32,
    reserved: u32,
    generation: u64,
}

extern "C" {
    fn uos_event_info_read(snapshot: *mut c_void, output: *mut EventInfo, size: u32) -> i32;
    fn uos_event_row_read(
        snapshot: *mut c_void,
        index: u32,
        output: *mut EventRow,
        size: u32,
    ) -> i32;
    fn uos_delta_create(base: *mut c_void, current: *mut c_void, output: *mut *mut c_void) -> i32;
    fn uos_delta_info_read(delta: *mut c_void, output: *mut DeltaInfo, size: u32) -> i32;
    fn uos_delta_row_read(delta: *mut c_void, index: u32, output: *mut ChangeRow, size: u32)
        -> i32;
    fn uos_delta_release(delta: *mut c_void);
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessEvent {
    pub sequence: String,
    pub observed_at_unix_ms: u64,
    pub previous_observed_at_unix_ms: u64,
    pub monotonic_ns: String,
    pub process_id: Option<String>,
    pub pid: u32,
    pub kind: &'static str,
    pub reason: &'static str,
    pub name: String,
}

#[derive(Clone, Debug, Default)]
pub struct Events {
    pub last_sequence: u64,
    pub evicted_count: u64,
    pub rows: Vec<ProcessEvent>,
}

pub fn events(snapshot: *mut c_void) -> Result<Events, String> {
    let mut info = EventInfo::default();
    if unsafe { uos_event_info_read(snapshot, &mut info, size_of::<EventInfo>() as u32) } != 1
        || info.abi_version != 1
        || info.struct_size != size_of::<EventInfo>() as u32
        || info.count > 256
    {
        return Err("Invalid native event window".into());
    }
    let mut rows = Vec::with_capacity(info.count as usize);
    for index in 0..info.count {
        let mut row = EventRow::default();
        if unsafe { uos_event_row_read(snapshot, index, &mut row, size_of::<EventRow>() as u32) }
            != 1
            || row.name.is_null()
            || row.name_length > 1040
            || row.sequence == 0
            || row.sequence > info.last_sequence
        {
            return Err("Invalid native event".into());
        }
        let kind = match row.kind {
            0 => "BASELINE",
            1 => "PROCESS_CREATED",
            2 => "PROCESS_TERMINATED",
            3 => "PROCESS_UPDATED",
            4 => "EVENT_GAP",
            5 => "COLLECTION_PAUSED",
            _ => return Err("Unknown native event kind".into()),
        };
        let reason = match row.reason {
            0 => "observation",
            1 => "identity",
            2 => "metadata",
            3 => "incomplete",
            4 => "configuration",
            _ => return Err("Unknown native event reason".into()),
        };
        let name = std::str::from_utf8(unsafe {
            std::slice::from_raw_parts(row.name, row.name_length as usize)
        })
        .map_err(|_| "Invalid event name encoding")?
        .to_owned();
        rows.push(ProcessEvent {
            sequence: row.sequence.to_string(),
            observed_at_unix_ms: row.observed_at_unix_ms,
            previous_observed_at_unix_ms: row.previous_observed_at_unix_ms,
            monotonic_ns: row.monotonic_ns.to_string(),
            process_id: (row.generation != 0).then(|| format!("{}:{}", row.pid, row.generation)),
            pid: row.pid,
            kind,
            reason,
            name,
        });
    }
    Ok(Events {
        last_sequence: info.last_sequence,
        evicted_count: info.evicted_count,
        rows,
    })
}

struct DeltaHandle(NonNull<c_void>);
impl Drop for DeltaHandle {
    fn drop(&mut self) {
        unsafe { uos_delta_release(self.0.as_ptr()) }
    }
}

#[derive(Default)]
pub struct Changes {
    pub processes: Vec<usize>,
    pub removed_processes: Vec<String>,
    pub galaxies: Vec<usize>,
    pub removed_galaxies: Vec<String>,
}

pub fn diff(base: Option<&ProcessSnapshot>, current: &ProcessSnapshot) -> Result<Changes, String> {
    let mut raw = std::ptr::null_mut();
    let base_pointer = base.map_or(std::ptr::null_mut(), |snapshot| snapshot.native.0.as_ptr());
    if unsafe { uos_delta_create(base_pointer, current.native.0.as_ptr(), &mut raw) } != 1 {
        return Err("Native delta calculation failed".into());
    }
    let handle = DeltaHandle(NonNull::new(raw).ok_or("Null native delta")?);
    let mut info = DeltaInfo::default();
    if unsafe { uos_delta_info_read(handle.0.as_ptr(), &mut info, size_of::<DeltaInfo>() as u32) }
        != 1
        || info.abi_version != 1
        || info.struct_size != size_of::<DeltaInfo>() as u32
        || info.count > 16384
    {
        return Err("Invalid native delta header".into());
    }
    let mut result = Changes::default();
    for index in 0..info.count {
        let mut row = ChangeRow::default();
        if unsafe {
            uos_delta_row_read(
                handle.0.as_ptr(),
                index,
                &mut row,
                size_of::<ChangeRow>() as u32,
            )
        } != 1
        {
            return Err("Invalid native change row".into());
        }
        match row.kind {
            0 if (row.index as usize) < current.rows.len() => {
                result.processes.push(row.index as usize)
            }
            1 if row.generation > 0 => result
                .removed_processes
                .push(format!("{}:{}", row.pid, row.generation)),
            2 if (row.index as usize) < current.galaxies.len() => {
                result.galaxies.push(row.index as usize)
            }
            3 if row.generation > 0 => result
                .removed_galaxies
                .push(format!("g:{}:{}", row.pid, row.generation)),
            _ => return Err("Invalid native change reference".into()),
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native::Engine;
    #[test]
    fn native_events_and_retained_snapshot_diff() {
        assert_eq!(size_of::<EventInfo>(), 32);
        assert_eq!(size_of::<EventRow>(), 64);
        assert_eq!(size_of::<ChangeRow>(), 24);
        let engine = Engine::new().unwrap();
        engine.set_process_collection(true).unwrap();
        let mut after = 0;
        let mut observed = None;
        for _attempt in 0..10 {
            let Some((sequence, health)) = engine.wait(after, 3000).unwrap() else {
                continue;
            };
            after = sequence;
            if !health.processes.rows.is_empty() {
                observed = Some(health.processes);
                break;
            }
        }
        let snapshot = observed.expect("bounded wait for actual native processes");
        assert_eq!(snapshot.events.rows[0].kind, "BASELINE");
        assert_eq!(
            diff(None, &snapshot).unwrap().processes.len(),
            snapshot.rows.len()
        );
        assert!(diff(Some(&snapshot), &snapshot)
            .unwrap()
            .processes
            .is_empty());
        engine.set_process_collection(false).unwrap();
        let (_, disabled) = engine.wait(after, 1000).unwrap().unwrap();
        assert_eq!(
            disabled.processes.events.rows.last().unwrap().kind,
            "COLLECTION_PAUSED"
        );
        assert_eq!(
            diff(Some(&snapshot), &disabled.processes)
                .unwrap()
                .removed_processes
                .len(),
            snapshot.rows.len()
        );
    }
}
