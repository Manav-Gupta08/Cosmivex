use serde::Serialize;
use std::{ffi::c_void, mem::size_of};

#[repr(C)]
#[derive(Default)]
struct NativeInfo {
    abi_version: u32,
    struct_size: u32,
    enabled: u32,
    connection_count: u32,
    interface_count: u32,
    truncated: u32,
    table_errors: [u32; 4],
    interface_error: u32,
    reserved: u32,
    observed_at_unix_ms: u64,
    collection_ms: f64,
}
#[repr(C)]
#[derive(Default)]
struct NativeConnection {
    generation: u64,
    owner_creation: u64,
    pid: u32,
    family: u32,
    protocol: u32,
    state: u32,
    local_port: u32,
    remote_port: u32,
    owner_error: u32,
    observations: u32,
    local_address: *const u8,
    remote_address: *const u8,
    local_length: u32,
    remote_length: u32,
}
#[repr(C)]
#[derive(Default)]
struct NativeInterface {
    luid: u64,
    received_bytes: u64,
    sent_bytes: u64,
    receive_rate: f64,
    send_rate: f64,
    index: u32,
    interface_type: u32,
    up: u32,
    rates_available: u32,
    name: *const u8,
    name_length: u32,
    reserved: u32,
}
extern "C" {
    fn uos_network_info_read(snapshot: *mut c_void, output: *mut NativeInfo, size: u32) -> i32;
    fn uos_connection_row_read(
        snapshot: *mut c_void,
        index: u32,
        output: *mut NativeConnection,
        size: u32,
    ) -> i32;
    fn uos_interface_row_read(
        snapshot: *mut c_void,
        index: u32,
        output: *mut NativeInterface,
        size: u32,
    ) -> i32;
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub pid: u32,
    pub family: u32,
    pub protocol: &'static str,
    pub state: &'static str,
    pub local_address: String,
    pub local_port: u32,
    pub remote_address: Option<String>,
    pub remote_port: Option<u32>,
    pub owner_creation: Option<String>,
    pub owner_error: u32,
    pub observations: u32,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterface {
    pub id: String,
    pub index: u32,
    pub interface_type: u32,
    pub up: bool,
    pub name: String,
    pub received_bytes: String,
    pub sent_bytes: String,
    pub receive_rate: Option<f64>,
    pub send_rate: Option<f64>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSnapshot {
    pub enabled: bool,
    pub observed_at_unix_ms: u64,
    pub collection_ms: f64,
    pub table_errors: [u32; 4],
    pub interface_error: u32,
    pub truncated: bool,
    pub connections: Vec<Connection>,
    pub interfaces: Vec<NetworkInterface>,
}

fn text(pointer: *const u8, length: u32, maximum: u32) -> Result<String, String> {
    if pointer.is_null() || length > maximum {
        return Err("Invalid network metadata string".into());
    }
    std::str::from_utf8(unsafe { std::slice::from_raw_parts(pointer, length as usize) })
        .map(str::to_owned)
        .map_err(|_| "Invalid network metadata encoding".into())
}

pub fn read(snapshot: *mut c_void) -> Result<NetworkSnapshot, String> {
    let mut info = NativeInfo::default();
    if unsafe { uos_network_info_read(snapshot, &mut info, size_of::<NativeInfo>() as u32) } != 1
        || info.abi_version != 1
        || info.struct_size != size_of::<NativeInfo>() as u32
        || info.connection_count > 4096
        || info.interface_count > 128
        || !info.collection_ms.is_finite()
        || info.collection_ms < 0.0
    {
        return Err("Invalid native network header".into());
    }
    let mut connections = Vec::with_capacity(info.connection_count as usize);
    for index in 0..info.connection_count {
        let mut row = NativeConnection::default();
        if unsafe {
            uos_connection_row_read(
                snapshot,
                index,
                &mut row,
                size_of::<NativeConnection>() as u32,
            )
        } != 1
            || row.generation == 0
            || ![4, 6].contains(&row.family)
            || row.local_port > 65535
            || row.remote_port > 65535
            || row.observations == 0
        {
            return Err("Invalid native connection row".into());
        }
        let protocol = match row.protocol {
            6 => "TCP",
            17 => "UDP",
            _ => return Err("Invalid network protocol".into()),
        };
        let state = if row.protocol == 17 {
            "BOUND"
        } else {
            match row.state {
                0 => "UNKNOWN",
                1 => "CLOSED",
                2 => "LISTEN",
                3 => "SYN_SENT",
                4 => "SYN_RECEIVED",
                5 => "ESTABLISHED",
                6 => "FIN_WAIT_1",
                7 => "FIN_WAIT_2",
                8 => "CLOSE_WAIT",
                9 => "CLOSING",
                10 => "LAST_ACK",
                11 => "TIME_WAIT",
                12 => "DELETE_TCB",
                _ => "UNKNOWN",
            }
        };
        let remote = if row.remote_address.is_null() {
            None
        } else {
            Some(text(row.remote_address, row.remote_length, 80)?)
        };
        if row.protocol == 17 && remote.is_some() {
            return Err("UDP table cannot claim a remote connection".into());
        }
        connections.push(Connection {
            id: format!("n:{}", row.generation),
            pid: row.pid,
            family: row.family,
            protocol,
            state,
            local_address: text(row.local_address, row.local_length, 80)?,
            local_port: row.local_port,
            remote_port: remote.as_ref().map(|_| row.remote_port),
            remote_address: remote,
            owner_creation: (row.owner_creation != 0).then(|| row.owner_creation.to_string()),
            owner_error: row.owner_error,
            observations: row.observations,
        });
    }
    let mut interfaces = Vec::with_capacity(info.interface_count as usize);
    for index in 0..info.interface_count {
        let mut row = NativeInterface::default();
        if unsafe {
            uos_interface_row_read(
                snapshot,
                index,
                &mut row,
                size_of::<NativeInterface>() as u32,
            )
        } != 1
            || !row.receive_rate.is_finite()
            || !row.send_rate.is_finite()
            || row.receive_rate < 0.0
            || row.send_rate < 0.0
        {
            return Err("Invalid native interface row".into());
        }
        interfaces.push(NetworkInterface {
            id: format!("if:{}", row.luid),
            index: row.index,
            interface_type: row.interface_type,
            up: row.up != 0,
            name: text(row.name, row.name_length, 2048)?,
            received_bytes: row.received_bytes.to_string(),
            sent_bytes: row.sent_bytes.to_string(),
            receive_rate: (row.rates_available != 0).then_some(row.receive_rate),
            send_rate: (row.rates_available != 0).then_some(row.send_rate),
        });
    }
    Ok(NetworkSnapshot {
        enabled: info.enabled != 0,
        observed_at_unix_ms: info.observed_at_unix_ms,
        collection_ms: info.collection_ms,
        table_errors: info.table_errors,
        interface_error: info.interface_error,
        truncated: info.truncated != 0,
        connections,
        interfaces,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native::Engine;
    #[test]
    fn actual_network_crosses_snapshot_abi_independently() {
        assert_eq!(size_of::<NativeInfo>(), 64);
        assert_eq!(size_of::<NativeConnection>(), 72);
        assert_eq!(size_of::<NativeInterface>(), 72);
        let engine = Engine::new().unwrap();
        engine.set_network_collection(true).unwrap();
        let mut after = 0;
        let mut observed = false;
        for _attempt in 0..10 {
            if let Some((sequence, health)) = engine.wait(after, 3000).unwrap() {
                after = sequence;
                if health.processes.network.observed_at_unix_ms > 0 {
                    assert!(health.processes.network.enabled);
                    assert!(!health.processes.network.interfaces.is_empty());
                    assert!(health
                        .processes
                        .network
                        .connections
                        .iter()
                        .all(|row| !row.local_address.is_empty()));
                    assert_eq!(health.enabled_collectors, 0);
                    observed = true;
                    break;
                }
            }
        }
        assert!(observed);
        engine.set_network_collection(false).unwrap();
    }
}
