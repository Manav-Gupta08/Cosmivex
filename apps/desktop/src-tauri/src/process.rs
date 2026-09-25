use crate::universe::{self, Galaxy};
use serde::Serialize;
use std::{ffi::c_void, mem::size_of, ptr::NonNull, sync::Arc};

#[repr(C)]
#[derive(Default)]
struct NativeInfo {
    abi_version: u32,
    struct_size: u32,
    count: u32,
    logical_cpus: u32,
    error: u32,
    truncated: u32,
    observed_at_unix_ms: u64,
    collection_ms: f64,
}

#[repr(C)]
#[derive(Default)]
struct NativeRow {
    creation_filetime: u64,
    generation: u64,
    working_set_bytes: u64,
    cpu_percent: f64,
    pid: u32,
    parent_pid: u32,
    thread_count: u32,
    available: u32,
    timing_error: u32,
    memory_error: u32,
    name: *const u8,
    name_length: u32,
    reserved: u32,
}

extern "C" {
    fn uos_acquire_processes(engine: *mut c_void, sequence: u64, output: *mut *mut c_void) -> i32;
    fn uos_process_info_read(snapshot: *mut c_void, output: *mut NativeInfo, size: u32) -> i32;
    fn uos_process_row_read(
        snapshot: *mut c_void,
        index: u32,
        output: *mut NativeRow,
        size: u32,
    ) -> i32;
    fn uos_release_processes(snapshot: *mut c_void);
}

struct SnapshotHandle(NonNull<c_void>);
impl Drop for SnapshotHandle {
    fn drop(&mut self) {
        unsafe { uos_release_processes(self.0.as_ptr()) }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Process {
    pub id: String,
    pub pid: u32,
    pub parent_pid: u32,
    pub parent_id: Option<String>,
    pub parent_status: &'static str,
    pub galaxy_id: String,
    pub depth: u32,
    pub name: String,
    pub thread_count: u32,
    pub creation_filetime: Option<String>,
    pub created_at_unix_ms: Option<u64>,
    pub cpu_percent: Option<f64>,
    pub working_set_bytes: Option<String>,
    pub timing_error: u32,
    pub memory_error: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessSnapshot {
    pub observed_at_unix_ms: u64,
    pub logical_cpus: u32,
    pub error: u32,
    pub truncated: bool,
    pub collection_ms: f64,
    pub rows: Vec<Process>,
    pub galaxies: Vec<Galaxy>,
    pub model_build_ms: f64,
}

pub fn read(engine: *mut c_void, sequence: u64) -> Result<Option<Arc<ProcessSnapshot>>, String> {
    let mut raw = std::ptr::null_mut();
    match unsafe { uos_acquire_processes(engine, sequence, &mut raw) } {
        0 | 2 => return Ok(None),
        1 => {}
        code => return Err(format!("Process snapshot acquisition failed ({code})")),
    }
    let handle = SnapshotHandle(NonNull::new(raw).ok_or("Null native snapshot")?);
    let mut info = NativeInfo::default();
    if unsafe {
        uos_process_info_read(handle.0.as_ptr(), &mut info, size_of::<NativeInfo>() as u32)
    } != 1
        || info.abi_version != 1
        || info.struct_size != size_of::<NativeInfo>() as u32
        || info.count > 4096
        || !info.collection_ms.is_finite()
        || info.collection_ms < 0.0
    {
        return Err("Invalid native process snapshot header".into());
    }
    let mut rows = Vec::with_capacity(info.count as usize);
    for index in 0..info.count {
        let mut row = NativeRow::default();
        if unsafe {
            uos_process_row_read(
                handle.0.as_ptr(),
                index,
                &mut row,
                size_of::<NativeRow>() as u32,
            )
        } != 1
            || row.name.is_null()
            || row.name_length > 1040
        {
            return Err("Invalid native process record".into());
        }
        let name = std::str::from_utf8(unsafe {
            std::slice::from_raw_parts(row.name, row.name_length as usize)
        })
        .map_err(|_| "Invalid process name encoding")?
        .to_owned();
        let cpu = (row.available & 2 != 0).then_some(row.cpu_percent);
        if cpu.is_some_and(|value| !value.is_finite() || !(0.0..=100.0).contains(&value)) {
            return Err("Invalid native process CPU sample".into());
        }
        rows.push(Process {
            id: format!("{}:{}", row.pid, row.generation),
            pid: row.pid,
            parent_pid: row.parent_pid,
            parent_id: None,
            parent_status: "root",
            galaxy_id: String::new(),
            depth: 0,
            name,
            thread_count: row.thread_count,
            creation_filetime: (row.available & 1 != 0).then(|| row.creation_filetime.to_string()),
            created_at_unix_ms: (row.available & 1 != 0)
                .then(|| {
                    row.creation_filetime
                        .checked_sub(116444736000000000)
                        .map(|value| value / 10000)
                })
                .flatten(),
            cpu_percent: cpu,
            working_set_bytes: (row.available & 4 != 0).then(|| row.working_set_bytes.to_string()),
            timing_error: row.timing_error,
            memory_error: row.memory_error,
        });
    }
    let (galaxies, model_build_ms) = universe::read(handle.0.as_ptr(), &mut rows)?;
    Ok(Some(Arc::new(ProcessSnapshot {
        observed_at_unix_ms: info.observed_at_unix_ms,
        logical_cpus: info.logical_cpus,
        error: info.error,
        truncated: info.truncated != 0,
        collection_ms: info.collection_ms,
        rows,
        galaxies,
        model_build_ms,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native::Engine;

    #[test]
    fn real_processes_cross_snapshot_abi() {
        assert_eq!(size_of::<NativeInfo>(), 40);
        assert_eq!(size_of::<NativeRow>(), 72);
        let engine = Engine::new().unwrap();
        engine.set_process_collection(true).unwrap();
        let mut after = 0;
        let mut found = false;
        for _attempt in 0..10 {
            if let Some((sequence, health)) = engine.wait(after, 3000).unwrap() {
                after = sequence;
                if let Some(process) = health
                    .processes
                    .rows
                    .iter()
                    .find(|process| process.pid == std::process::id())
                {
                    assert!(process.working_set_bytes.is_some());
                    assert!(process.creation_filetime.is_some());
                    assert_eq!(health.processes.error, 0);
                    let group = health
                        .processes
                        .galaxies
                        .iter()
                        .find(|galaxy| galaxy.id == process.galaxy_id)
                        .unwrap();
                    assert!(group.executable_path.is_some());
                    assert!(group.process_count > 0);
                    assert!(health
                        .processes
                        .rows
                        .iter()
                        .any(|row| row.id == group.root_id));
                    assert_eq!(process.parent_status, "verified");
                    assert!(process.parent_id.is_some());
                    found = true;
                    break;
                }
            }
        }
        assert!(found, "actual test process must reach Rust");
        engine.set_process_collection(false).unwrap();
        let (_, disabled) = engine.wait(after, 1000).unwrap().unwrap();
        assert_eq!(disabled.enabled_collectors, 0);
        assert!(disabled.processes.rows.is_empty());
    }
}
