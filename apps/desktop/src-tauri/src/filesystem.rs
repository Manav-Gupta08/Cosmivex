use serde::Serialize;
use std::{
    ffi::c_void,
    mem::size_of,
    sync::{Arc, Mutex},
};

#[repr(C)]
#[derive(Default)]
struct NativeInfo {
    abi_version: u32,
    struct_size: u32,
    revision: u64,
    scope: u64,
    observed_at_unix_ms: u64,
    evicted_events: u64,
    error: u32,
    watch_error: u32,
    watching: u32,
    truncated: u32,
    entry_count: u32,
    event_count: u32,
    scan_ms: f64,
    root: *const u8,
    relative: *const u8,
    root_length: u32,
    relative_length: u32,
}
#[repr(C)]
#[derive(Default)]
struct NativeEntry {
    generation: u64,
    file_id: u64,
    created_ticks: u64,
    modified_unix_ms: u64,
    size: u64,
    attributes: u32,
    directory: u32,
    reparse: u32,
    name_length: u32,
    name: *const u8,
}
#[repr(C)]
#[derive(Default)]
struct NativeEvent {
    sequence: u64,
    observed_at_unix_ms: u64,
    kind: u32,
    name_length: u32,
    previous_length: u32,
    reserved: u32,
    name: *const u8,
    previous_name: *const u8,
}
extern "C" {
    fn uos_filesystem_info_read(snapshot: *mut c_void, output: *mut NativeInfo, size: u32) -> i32;
    fn uos_file_entry_read(
        snapshot: *mut c_void,
        index: u32,
        output: *mut NativeEntry,
        size: u32,
    ) -> i32;
    fn uos_file_event_read(
        snapshot: *mut c_void,
        index: u32,
        output: *mut NativeEvent,
        size: u32,
    ) -> i32;
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    id: String,
    token: String,
    file_id: String,
    created_ticks: String,
    modified_unix_ms: u64,
    size: Option<String>,
    attributes: u32,
    directory: bool,
    reparse: bool,
    name: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEvent {
    sequence: String,
    observed_at_unix_ms: u64,
    kind: &'static str,
    name: String,
    previous_name: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSystemSnapshot {
    pub revision: String,
    pub scope: String,
    observed_at_unix_ms: u64,
    evicted_events: String,
    pub error: u32,
    watch_error: u32,
    watching: bool,
    truncated: bool,
    scan_ms: f64,
    root: String,
    relative: String,
    pub entries: Vec<FileEntry>,
    events: Vec<FileEvent>,
}
pub type FileCache = Mutex<Option<Arc<FileSystemSnapshot>>>;

fn text(pointer: *const u8, length: u32, limit: u32) -> Result<String, String> {
    if length == 0 {
        return Ok(String::new());
    }
    if pointer.is_null() || length > limit {
        return Err("Invalid filesystem metadata string".into());
    }
    std::str::from_utf8(unsafe { std::slice::from_raw_parts(pointer, length as usize) })
        .map(str::to_owned)
        .map_err(|_| "Invalid filesystem UTF-8".into())
}

pub fn read(snapshot: *mut c_void, cache: &FileCache) -> Result<Arc<FileSystemSnapshot>, String> {
    let mut info = NativeInfo::default();
    if unsafe { uos_filesystem_info_read(snapshot, &mut info, size_of::<NativeInfo>() as u32) } != 1
        || info.abi_version != 1
        || info.struct_size != size_of::<NativeInfo>() as u32
        || info.entry_count > 4096
        || info.event_count > 256
        || !info.scan_ms.is_finite()
        || info.scan_ms < 0.0
    {
        return Err("Invalid filesystem header".into());
    }
    let mut cache = cache.lock().map_err(|_| "Filesystem cache unavailable")?;
    if let Some(previous) = cache.as_ref() {
        if previous.revision == info.revision.to_string() {
            return Ok(previous.clone());
        }
    }
    let mut entries = Vec::with_capacity(info.entry_count as usize);
    for index in 0..info.entry_count {
        let mut row = NativeEntry::default();
        if unsafe {
            uos_file_entry_read(snapshot, index, &mut row, size_of::<NativeEntry>() as u32)
        } != 1
            || row.generation == 0
        {
            return Err("Invalid filesystem entry".into());
        }
        entries.push(FileEntry {
            id: format!("f:{}:{}", info.scope, row.generation),
            token: row.generation.to_string(),
            file_id: row.file_id.to_string(),
            created_ticks: row.created_ticks.to_string(),
            modified_unix_ms: row.modified_unix_ms,
            size: (row.directory == 0).then(|| row.size.to_string()),
            attributes: row.attributes,
            directory: row.directory != 0,
            reparse: row.reparse != 0,
            name: text(row.name, row.name_length, 2048)?,
        });
    }
    let mut events = Vec::with_capacity(info.event_count as usize);
    for index in 0..info.event_count {
        let mut row = NativeEvent::default();
        if unsafe {
            uos_file_event_read(snapshot, index, &mut row, size_of::<NativeEvent>() as u32)
        } != 1
        {
            return Err("Invalid filesystem event".into());
        }
        let kind = match row.kind {
            0 => "BASELINE",
            1 => "FILE_CREATED",
            2 => "FILE_MODIFIED",
            3 => "FILE_DELETED",
            4 => "FILE_MOVED",
            5 => "EVENT_GAP",
            6 => "RENAME_FROM",
            7 => "RENAME_TO",
            _ => return Err("Unknown filesystem event".into()),
        };
        events.push(FileEvent {
            sequence: row.sequence.to_string(),
            observed_at_unix_ms: row.observed_at_unix_ms,
            kind,
            name: text(row.name, row.name_length, 2048)?,
            previous_name: text(row.previous_name, row.previous_length, 2048)?,
        });
    }
    let value = Arc::new(FileSystemSnapshot {
        revision: info.revision.to_string(),
        scope: info.scope.to_string(),
        observed_at_unix_ms: info.observed_at_unix_ms,
        evicted_events: info.evicted_events.to_string(),
        error: info.error,
        watch_error: info.watch_error,
        watching: info.watching != 0,
        truncated: info.truncated != 0,
        scan_ms: info.scan_ms,
        root: text(info.root, info.root_length, 16384)?,
        relative: text(info.relative, info.relative_length, 16384)?,
        entries,
        events,
    });
    *cache = Some(value.clone());
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native::Engine;
    #[test]
    fn queued_filesystem_root_reaches_cached_snapshot() {
        assert_eq!(size_of::<NativeInfo>(), 96);
        assert_eq!(size_of::<NativeEntry>(), 64);
        assert_eq!(size_of::<NativeEvent>(), 48);
        let root = std::env::temp_dir().join(format!("universe-fs-rust-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("fixture.txt"), b"test").unwrap();
        let engine = Engine::new().unwrap();
        engine
            .filesystem_command(0, &root.to_string_lossy(), 0, 0)
            .unwrap();
        let mut after = 0;
        let mut observed = None;
        for _attempt in 0..10 {
            if let Some((sequence, health)) = engine.wait(after, 3000).unwrap() {
                after = sequence;
                if !health.processes.filesystem.entries.is_empty() {
                    observed = Some(health.processes.filesystem.clone());
                    break;
                }
            }
        }
        let filesystem = observed.expect("real filesystem metadata through ABI");
        assert_eq!(filesystem.error, 0);
        assert_eq!(filesystem.entries[0].name, "fixture.txt");
        assert_eq!(filesystem.entries[0].size.as_deref(), Some("4"));
        engine.filesystem_command(2, "", 0, 0).unwrap();
        for _attempt in 0..10 {
            if let Some((sequence, health)) = engine.wait(after, 3000).unwrap() {
                after = sequence;
                if health.processes.filesystem.entries.is_empty() {
                    break;
                }
            }
        }
        drop(engine);
        std::fs::remove_dir_all(root).unwrap();
    }
}
