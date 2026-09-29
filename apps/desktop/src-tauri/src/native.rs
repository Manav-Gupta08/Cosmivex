use crate::process::{self, ProcessSnapshot};
use serde::{Deserialize, Serialize};
use std::{ffi::c_void, mem::size_of, ptr::NonNull, sync::Arc};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Profile {
    Eco,
    Normal,
    Cinematic,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct NativeHealth {
    abi_version: u32,
    struct_size: u32,
    sequence: u64,
    uptime_ms: u64,
    observed_at_unix_ms: u64,
    interval_ms: u32,
    profile: u32,
    enabled_collectors: u32,
    reserved: u32,
}

extern "C" {
    fn uos_create(abi_version: u32, health_size: u32) -> *mut c_void;
    fn uos_wait(
        engine: *mut c_void,
        after: u64,
        timeout: u32,
        output: *mut NativeHealth,
        size: u32,
    ) -> i32;
    fn uos_set_profile(engine: *mut c_void, profile: u32) -> i32;
    fn uos_set_process_collection(engine: *mut c_void, enabled: u32) -> i32;
    fn uos_set_network_collection(engine: *mut c_void, enabled: u32) -> i32;
    fn uos_stop(engine: *mut c_void);
    fn uos_destroy(engine: *mut c_void);
}

pub struct Engine(NonNull<c_void>, crate::filesystem::FileCache);
unsafe impl Send for Engine {}
unsafe impl Sync for Engine {}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub protocol_version: u32,
    pub abi_version: u32,
    pub sequence: String,
    pub uptime_ms: u64,
    pub observed_at_unix_ms: u64,
    pub interval_ms: u32,
    pub profile: Profile,
    pub enabled_collectors: u32,
    pub processes: Arc<ProcessSnapshot>,
}

impl Engine {
    pub fn new() -> Result<Self, String> {
        NonNull::new(unsafe { uos_create(1, size_of::<NativeHealth>() as u32) })
            .map(|handle| Self(handle, std::sync::Mutex::new(None)))
            .ok_or_else(|| "Native core initialization or ABI negotiation failed".into())
    }

    pub fn wait(&self, after: u64, timeout: u32) -> Result<Option<(u64, Health)>, String> {
        let mut raw = NativeHealth::default();
        let result = unsafe {
            uos_wait(
                self.0.as_ptr(),
                after,
                timeout,
                &mut raw,
                size_of::<NativeHealth>() as u32,
            )
        };
        match result {
            0 | 2 => Ok(None),
            1 => {
                if raw.abi_version != 1 || raw.struct_size != size_of::<NativeHealth>() as u32 {
                    return Err("Native core returned an incompatible ABI".into());
                }
                let profile = match raw.profile {
                    0 => Profile::Eco,
                    1 => Profile::Normal,
                    2 => Profile::Cinematic,
                    _ => return Err("Native core returned an unknown profile".into()),
                };
                let Some(processes) = process::read(self.0.as_ptr(), raw.sequence, &self.1)? else {
                    return Ok(None);
                };
                Ok(Some((
                    raw.sequence,
                    Health {
                        protocol_version: 7,
                        abi_version: raw.abi_version,
                        sequence: raw.sequence.to_string(),
                        uptime_ms: raw.uptime_ms,
                        observed_at_unix_ms: raw.observed_at_unix_ms,
                        interval_ms: raw.interval_ms,
                        profile,
                        enabled_collectors: raw.enabled_collectors,
                        processes,
                    },
                )))
            }
            _ => Err(format!("Native core wait failed ({result})")),
        }
    }

    pub fn set_profile(&self, profile: Profile) -> Result<(), String> {
        let value = match profile {
            Profile::Eco => 0,
            Profile::Normal => 1,
            Profile::Cinematic => 2,
        };
        match unsafe { uos_set_profile(self.0.as_ptr(), value) } {
            1 => Ok(()),
            code => Err(format!("Native profile change failed ({code})")),
        }
    }

    pub fn stop(&self) {
        unsafe { uos_stop(self.0.as_ptr()) }
    }

    pub fn set_process_collection(&self, enabled: bool) -> Result<(), String> {
        match unsafe { uos_set_process_collection(self.0.as_ptr(), u32::from(enabled)) } {
            1 => Ok(()),
            code => Err(format!("Native collection toggle failed ({code})")),
        }
    }

    pub fn set_network_collection(&self, enabled: bool) -> Result<(), String> {
        match unsafe { uos_set_network_collection(self.0.as_ptr(), u32::from(enabled)) } {
            1 => Ok(()),
            code => Err(format!("Native network toggle failed ({code})")),
        }
    }

    pub fn filesystem_command(
        &self,
        action: u32,
        root: &str,
        scope: u64,
        entry: u64,
    ) -> Result<(), String> {
        unsafe extern "C" {
            fn uos_filesystem_command(
                engine: *mut c_void,
                action: u32,
                root: *const u8,
                length: u32,
                scope: u64,
                entry: u64,
            ) -> i32;
        }
        if root.len() > 16384 {
            return Err("Folder path too long".into());
        }
        match unsafe {
            uos_filesystem_command(
                self.0.as_ptr(),
                action,
                root.as_ptr(),
                root.len() as u32,
                scope,
                entry,
            )
        } {
            1 => Ok(()),
            code => Err(format!("Filesystem command failed ({code})")),
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        unsafe { uos_destroy(self.0.as_ptr()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_cpp_frame_crosses_abi_and_serializes() {
        assert_eq!(size_of::<NativeHealth>(), 48);
        let engine = Engine::new().unwrap();
        let (sequence, frame) = engine.wait(0, 0).unwrap().unwrap();
        assert_eq!(sequence, 1);
        assert_eq!(frame.enabled_collectors, 0);
        let json = serde_json::to_value(&frame).unwrap();
        assert_eq!(json["sequence"], "1");
        assert_eq!(json["protocolVersion"], 7);
        engine.set_profile(Profile::Eco).unwrap();
        let (_, next) = engine.wait(sequence, 100).unwrap().unwrap();
        assert_eq!(next.interval_ms, 5000);
        assert_eq!(next.profile, Profile::Eco);
        engine.stop();
        assert!(engine.wait(0, 0).unwrap().is_none());
    }
}
