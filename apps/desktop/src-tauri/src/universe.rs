use crate::process::Process;
use serde::Serialize;
use std::{ffi::c_void, mem::size_of};

#[repr(C)]
#[derive(Default)]
struct NativeModelInfo {
    abi_version: u32,
    struct_size: u32,
    galaxy_count: u32,
    reserved: u32,
    build_ms: f64,
}

#[repr(C)]
#[derive(Default)]
struct NativeRelationship {
    parent_index: i32,
    status: u32,
    galaxy_index: u32,
    depth: u32,
}

#[repr(C)]
#[derive(Default)]
struct NativeGalaxy {
    root_index: u32,
    process_count: u32,
    cpu_sample_count: u32,
    memory_sample_count: u32,
    cpu_percent: f64,
    working_set_bytes: u64,
    executable_path: *const u8,
    path_length: u32,
    image_error: u32,
}

extern "C" {
    fn uos_model_info_read(snapshot: *mut c_void, output: *mut NativeModelInfo, size: u32) -> i32;
    fn uos_relationship_read(
        snapshot: *mut c_void,
        index: u32,
        output: *mut NativeRelationship,
        size: u32,
    ) -> i32;
    fn uos_galaxy_read(
        snapshot: *mut c_void,
        index: u32,
        output: *mut NativeGalaxy,
        size: u32,
    ) -> i32;
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Galaxy {
    pub id: String,
    pub root_id: String,
    pub label: String,
    pub executable_path: Option<String>,
    pub image_error: u32,
    pub process_count: u32,
    pub cpu_sample_count: u32,
    pub memory_sample_count: u32,
    pub cpu_percent: Option<f64>,
    pub working_set_bytes: Option<String>,
}

pub fn read(snapshot: *mut c_void, rows: &mut [Process]) -> Result<(Vec<Galaxy>, f64), String> {
    let mut info = NativeModelInfo::default();
    if unsafe { uos_model_info_read(snapshot, &mut info, size_of::<NativeModelInfo>() as u32) } != 1
        || info.abi_version != 1
        || info.struct_size != size_of::<NativeModelInfo>() as u32
        || info.galaxy_count as usize > rows.len()
        || !info.build_ms.is_finite()
        || info.build_ms < 0.0
    {
        return Err("Invalid native universe model".into());
    }
    let mut galaxies = Vec::with_capacity(info.galaxy_count as usize);
    for index in 0..info.galaxy_count {
        let mut raw = NativeGalaxy::default();
        if unsafe { uos_galaxy_read(snapshot, index, &mut raw, size_of::<NativeGalaxy>() as u32) }
            != 1
            || raw.root_index as usize >= rows.len()
            || raw.process_count == 0
            || raw.process_count as usize > rows.len()
            || raw.cpu_sample_count > raw.process_count
            || raw.memory_sample_count > raw.process_count
            || raw.path_length > 16384
            || !raw.cpu_percent.is_finite()
            || raw.cpu_percent < 0.0
        {
            return Err("Invalid native galaxy".into());
        }
        let path = if raw.executable_path.is_null() {
            if raw.path_length != 0 {
                return Err("Invalid native image view".into());
            }
            None
        } else {
            Some(
                std::str::from_utf8(unsafe {
                    std::slice::from_raw_parts(raw.executable_path, raw.path_length as usize)
                })
                .map_err(|_| "Invalid image path encoding")?
                .to_owned(),
            )
        };
        let root = &rows[raw.root_index as usize];
        galaxies.push(Galaxy {
            id: format!("g:{}", root.id),
            root_id: root.id.clone(),
            label: root.name.clone(),
            executable_path: path,
            image_error: raw.image_error,
            process_count: raw.process_count,
            cpu_sample_count: raw.cpu_sample_count,
            memory_sample_count: raw.memory_sample_count,
            cpu_percent: (raw.cpu_sample_count > 0).then_some(raw.cpu_percent),
            working_set_bytes: (raw.memory_sample_count > 0)
                .then(|| raw.working_set_bytes.to_string()),
        });
    }
    let ids: Vec<_> = rows.iter().map(|row| row.id.clone()).collect();
    for (index, row) in rows.iter_mut().enumerate() {
        let mut raw = NativeRelationship::default();
        if unsafe {
            uos_relationship_read(
                snapshot,
                index as u32,
                &mut raw,
                size_of::<NativeRelationship>() as u32,
            )
        } != 1
            || raw.parent_index < -1
            || raw.parent_index >= ids.len() as i32
            || raw.parent_index == index as i32
            || raw.galaxy_index as usize >= galaxies.len()
            || raw.depth >= 4096
            || (raw.status == 1) != (raw.parent_index >= 0)
        {
            return Err("Invalid native relationship".into());
        }
        row.parent_status = match raw.status {
            0 => "root",
            1 => "verified",
            2 => "missing",
            3 => "unavailable",
            4 => "newer-or-equal",
            5 => "self",
            _ => return Err("Unknown native parent status".into()),
        };
        row.parent_id = (raw.parent_index >= 0).then(|| ids[raw.parent_index as usize].clone());
        row.galaxy_id = galaxies[raw.galaxy_index as usize].id.clone();
        row.depth = raw.depth;
    }
    Ok((galaxies, info.build_ms))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_abi_layout_is_fixed() {
        assert_eq!(size_of::<NativeModelInfo>(), 24);
        assert_eq!(size_of::<NativeRelationship>(), 16);
        assert_eq!(size_of::<NativeGalaxy>(), 48);
    }
}
