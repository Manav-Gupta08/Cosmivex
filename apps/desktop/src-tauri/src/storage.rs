use std::path::Path;

use crate::native::Health;
use rusqlite::{params, Connection, Error, OpenFlags, Result};
use serde::Serialize;

const CHECKPOINT_INTERVAL_MS: u64 = 60_000;
const MAX_CHECKPOINT_BYTES: usize = 16 * 1024 * 1024;
const RETENTION_MS: u64 = 24 * 60 * 60 * 1000;
const MAX_DATABASE_BYTES: i64 = 256 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Checkpoint<'a> {
    health: &'a Health,
    network: &'a crate::network::NetworkSnapshot,
    filesystem: &'a crate::filesystem::FileSystemSnapshot,
}

pub struct Writer {
    connection: Connection,
    session: String,
    event_cursor: u64,
    checkpoint_at: u64,
    sample_at: u64,
    filesystem_revision: String,
    network_observed_at: u64,
    network_enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub started_ms: i64,
    pub ended_ms: Option<i64>,
    pub protocol_version: u32,
    pub app_version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInfo {
    pub sequence: i64,
    pub observed_ms: i64,
    pub kind: String,
    pub payload_json: String,
}

fn reader(path: &Path) -> Result<Connection> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    connection.busy_timeout(std::time::Duration::from_millis(250))?;
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version != 1 {
        return Err(Error::InvalidQuery);
    }
    Ok(connection)
}

pub fn sessions(path: &Path, limit: u32) -> Result<Vec<SessionInfo>> {
    let connection = reader(path)?;
    let mut statement = connection.prepare(
        "SELECT id, started_ms, ended_ms, protocol_version, app_version FROM sessions ORDER BY started_ms DESC, id DESC LIMIT ?1"
    )?;
    let rows = statement.query_map([limit.min(50)], |row| {
        Ok(SessionInfo {
            id: row.get(0)?,
            started_ms: row.get(1)?,
            ended_ms: row.get(2)?,
            protocol_version: row.get(3)?,
            app_version: row.get(4)?,
        })
    })?.collect();
    rows
}

pub fn events(path: &Path, session: &str, since_ms: i64, limit: u32) -> Result<Vec<EventInfo>> {
    let connection = reader(path)?;
    let mut statement = connection.prepare(
        "SELECT sequence, observed_ms, kind, payload_json FROM events WHERE session_id = ?1 AND observed_ms >= ?2 ORDER BY observed_ms, sequence LIMIT ?3"
    )?;
    let rows = statement.query_map(params![session, since_ms, limit.min(100)], |row| {
        Ok(EventInfo {
            sequence: row.get(0)?,
            observed_ms: row.get(1)?,
            kind: row.get(2)?,
            payload_json: row.get(3)?,
        })
    })?.collect();
    rows
}

impl Writer {
    pub fn start(path: &Path, health: &Health) -> Result<Self> {
        let connection = open(path)?;
        let session = format!(
            "{}-{}-{}",
            health.observed_at_unix_ms,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| Error::InvalidQuery)?
                .as_nanos()
        );
        connection.execute(
            "INSERT INTO sessions(id, started_ms, protocol_version, app_version) VALUES (?1, ?2, ?3, ?4)",
            params![session, checked_ms(health.observed_at_unix_ms)?, health.protocol_version, env!("CARGO_PKG_VERSION")],
        )?;
        let mut writer = Self {
            connection,
            session,
            event_cursor: health.processes.events.last_sequence,
            checkpoint_at: health.observed_at_unix_ms,
            sample_at: 0,
            filesystem_revision: health.processes.filesystem.revision.clone(),
            network_observed_at: health.processes.network.observed_at_unix_ms,
            network_enabled: health.processes.network.enabled,
        };
        writer.record(health, true)?;
        Ok(writer)
    }

    pub fn record(&mut self, health: &Health, checkpoint: bool) -> Result<()> {
        let events = &health.processes.events;
        let oldest = events.rows.first().and_then(|row| row.sequence.parse::<u64>().ok())
            .or_else(|| events.last_sequence.checked_add(1));
        let gap = events.last_sequence > self.event_cursor
            && oldest.is_some_and(|sequence| sequence > self.event_cursor.saturating_add(1));
        let due = checkpoint
            || health.observed_at_unix_ms.saturating_sub(self.checkpoint_at)
                >= CHECKPOINT_INTERVAL_MS;
        let sample = health.processes.observed_at_unix_ms > self.sample_at;
        let filesystem_changed = self.filesystem_revision != health.processes.filesystem.revision;
        let network_changed = self.network_observed_at != health.processes.network.observed_at_unix_ms
            || self.network_enabled != health.processes.network.enabled;
        let state = if due {
            let bytes = serde_json::to_vec(&Checkpoint {
                health,
                network: &health.processes.network,
                filesystem: &health.processes.filesystem,
            })
            .map_err(|error| Error::ToSqlConversionFailure(Box::new(error)))?;
            if bytes.len() > MAX_CHECKPOINT_BYTES {
                return Err(Error::InvalidQuery);
            }
            Some(bytes)
        } else {
            None
        };
        let transaction = self.connection.transaction()?;
        if due {
            prune_history(&transaction, health.observed_at_unix_ms)?;
        }
        if gap {
            transaction.execute(
                "INSERT INTO events(session_id, sequence, observed_ms, kind, payload_json) VALUES (?1, ?2, ?3, 'RECORDING_GAP', ?4)",
                params![self.session, checked_ms(self.event_cursor.saturating_add(1))?, checked_ms(health.observed_at_unix_ms)?, serde_json::json!({"throughSequence": events.last_sequence.min(oldest.unwrap() - 1)}).to_string()],
            )?;
        }
        for event in events.rows.iter().filter(|row| row.sequence.parse::<u64>().is_ok_and(|sequence| sequence > self.event_cursor)) {
            let sequence = event.sequence.parse::<u64>().map_err(|_| Error::InvalidQuery)?;
            transaction.execute(
                "INSERT INTO events(session_id, sequence, observed_ms, source_ms, entity_id, kind, payload_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![self.session, checked_ms(sequence)?, checked_ms(event.observed_at_unix_ms)?, checked_ms(event.previous_observed_at_unix_ms)?, event.process_id, event.kind, serde_json::to_string(event).map_err(|error| Error::ToSqlConversionFailure(Box::new(error)))?],
            )?;
        }
        if filesystem_changed {
            let sequence = health.sequence.parse::<i64>().map_err(|_| Error::InvalidQuery)?;
            let sequence = sequence.checked_mul(-2).ok_or(Error::InvalidQuery)?;
            transaction.execute(
                "INSERT INTO events(session_id, sequence, observed_ms, kind, payload_json) VALUES (?1, ?2, ?3, 'FILESYSTEM_OBSERVATION', ?4)",
                params![self.session, sequence, checked_ms(health.observed_at_unix_ms)?, serde_json::to_string(&health.processes.filesystem).map_err(|error| Error::ToSqlConversionFailure(Box::new(error)))?],
            )?;
        }
        if network_changed {
            let sequence = health.sequence.parse::<i64>().map_err(|_| Error::InvalidQuery)?;
            let sequence = sequence.checked_mul(-2).and_then(|value| value.checked_sub(1)).ok_or(Error::InvalidQuery)?;
            transaction.execute(
                "INSERT INTO events(session_id, sequence, observed_ms, kind, payload_json) VALUES (?1, ?2, ?3, 'NETWORK_OBSERVATION', ?4)",
                params![self.session, sequence, checked_ms(health.observed_at_unix_ms)?, serde_json::to_string(&health.processes.network).map_err(|error| Error::ToSqlConversionFailure(Box::new(error)))?],
            )?;
        }
        if sample {
            let bucket = checked_ms(health.processes.observed_at_unix_ms / 10_000 * 10_000)?;
            for process in &health.processes.rows {
                if let Some(value) = process.cpu_percent {
                    record_sample(&transaction, &self.session, bucket, &process.id, "cpu_percent", value)?;
                }
                if let Some(value) = process.working_set_bytes.as_deref().and_then(|value| value.parse::<f64>().ok()) {
                    record_sample(&transaction, &self.session, bucket, &process.id, "working_set_bytes", value)?;
                }
            }
        }
        if let Some(bytes) = &state {
            transaction.execute(
                "INSERT INTO checkpoints(session_id, sequence, observed_ms, codec, state) VALUES (?1, ?2, ?3, 'json', ?4)",
                params![self.session, checked_ms(health.sequence.parse().map_err(|_| Error::InvalidQuery)?)?, checked_ms(health.observed_at_unix_ms)?, bytes],
            )?;
            for process in &health.processes.rows {
                transaction.execute(
                    "INSERT INTO entities(session_id, id, kind, first_seen_ms, last_seen_ms, metadata_json) VALUES (?1, ?2, 'process', ?3, ?3, ?4) ON CONFLICT(session_id, id) DO UPDATE SET last_seen_ms = excluded.last_seen_ms, metadata_json = excluded.metadata_json",
                    params![self.session, process.id, checked_ms(health.observed_at_unix_ms)?, serde_json::to_string(process).map_err(|error| Error::ToSqlConversionFailure(Box::new(error)))?],
                )?;
            }
        }
        transaction.commit()?;
        self.event_cursor = events.last_sequence;
        if filesystem_changed {
            self.filesystem_revision = health.processes.filesystem.revision.clone();
        }
        if network_changed {
            self.network_observed_at = health.processes.network.observed_at_unix_ms;
            self.network_enabled = health.processes.network.enabled;
        }
        if sample {
            self.sample_at = health.processes.observed_at_unix_ms;
        }
        if due {
            self.checkpoint_at = health.observed_at_unix_ms;
        }
        Ok(())
    }

    pub fn finish(self, ended_ms: u64) -> Result<()> {
        self.connection.execute(
            "UPDATE sessions SET ended_ms = ?1 WHERE id = ?2",
            params![checked_ms(ended_ms)?, self.session],
        )?;
        self.connection.execute_batch("PRAGMA wal_checkpoint(PASSIVE)")?;
        Ok(())
    }
}

fn checked_ms(value: u64) -> Result<i64> {
    i64::try_from(value).map_err(|_| Error::InvalidQuery)
}

fn record_sample(
    connection: &Connection,
    session: &str,
    bucket: i64,
    entity: &str,
    metric: &str,
    value: f64,
) -> Result<()> {
    if !value.is_finite() || value < 0.0 {
        return Err(Error::InvalidQuery);
    }
    connection.execute(
        "INSERT INTO resource_samples(session_id, bucket_ms, entity_id, metric, minimum, maximum, mean, count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5, 1)
         ON CONFLICT(session_id, bucket_ms, entity_id, metric) DO UPDATE SET
         minimum = min(resource_samples.minimum, excluded.minimum),
         maximum = max(resource_samples.maximum, excluded.maximum),
         mean = (resource_samples.mean * resource_samples.count + excluded.mean) / (resource_samples.count + 1),
         count = resource_samples.count + 1",
        params![session, bucket, entity, metric, value],
    )?;
    Ok(())
}

fn prune_history(connection: &Connection, now_ms: u64) -> Result<()> {
    let cutoff = checked_ms(now_ms.saturating_sub(RETENTION_MS))?;
    connection.execute(
        "DELETE FROM sessions WHERE ended_ms IS NOT NULL AND ended_ms < ?1",
        [cutoff],
    )?;
    let mut statement = connection.prepare("SELECT id FROM sessions")?;
    let sessions = statement.query_map([], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>>>()?;
    for session in sessions {
        let anchor: Option<i64> = connection.query_row(
            "SELECT max(observed_ms) FROM checkpoints WHERE session_id = ?1 AND observed_ms <= ?2",
            params![session, cutoff],
            |row| row.get(0),
        )?;
        if let Some(anchor) = anchor {
            connection.execute(
                "DELETE FROM events WHERE session_id = ?1 AND observed_ms < ?2",
                params![session, anchor],
            )?;
            connection.execute(
                "DELETE FROM resource_samples WHERE session_id = ?1 AND bucket_ms < ?2",
                params![session, anchor],
            )?;
            connection.execute(
                "DELETE FROM entities WHERE session_id = ?1 AND last_seen_ms < ?2",
                params![session, anchor],
            )?;
            connection.execute(
                "DELETE FROM checkpoints WHERE session_id = ?1 AND observed_ms < ?2",
                params![session, anchor],
            )?;
        }
    }
    Ok(())
}

pub fn open(path: &Path) -> Result<Connection> {
    let mut connection = Connection::open(path)?;
    connection.busy_timeout(std::time::Duration::from_millis(250))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&mut connection)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    let page_size: i64 = connection.pragma_query_value(None, "page_size", |row| row.get(0))?;
    connection.pragma_update(None, "max_page_count", MAX_DATABASE_BYTES / page_size)?;
    connection.pragma_update(None, "journal_size_limit", 16 * 1024 * 1024)?;
    Ok(connection)
}

fn migrate(connection: &mut Connection) -> Result<()> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version > 1 {
        return Err(Error::InvalidQuery);
    }
    if version == 0 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY, started_ms INTEGER NOT NULL, ended_ms INTEGER,
                protocol_version INTEGER NOT NULL, app_version TEXT NOT NULL
            );
            CREATE TABLE entities (
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                id TEXT NOT NULL, kind TEXT NOT NULL, first_seen_ms INTEGER NOT NULL,
                last_seen_ms INTEGER NOT NULL, metadata_json TEXT NOT NULL,
                PRIMARY KEY(session_id, id)
            );
            CREATE TABLE events (
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                sequence INTEGER NOT NULL, observed_ms INTEGER NOT NULL, source_ms INTEGER,
                entity_id TEXT, kind TEXT NOT NULL, payload_json TEXT NOT NULL,
                PRIMARY KEY(session_id, sequence)
            );
            CREATE INDEX event_time ON events(session_id, observed_ms);
            CREATE INDEX event_entity ON events(session_id, entity_id, observed_ms);
            CREATE TABLE resource_samples (
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                bucket_ms INTEGER NOT NULL, entity_id TEXT NOT NULL, metric TEXT NOT NULL,
                minimum REAL, maximum REAL, mean REAL, count INTEGER NOT NULL,
                PRIMARY KEY(session_id, bucket_ms, entity_id, metric)
            );
            CREATE TABLE checkpoints (
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                sequence INTEGER NOT NULL, observed_ms INTEGER NOT NULL,
                codec TEXT NOT NULL, state BLOB NOT NULL,
                PRIMARY KEY(session_id, sequence)
            );
            CREATE INDEX checkpoint_time ON checkpoints(session_id, observed_ms);
            PRAGMA user_version = 1;",
        )?;
        transaction.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{changes::ProcessEvent, native::Engine};

    #[test]
    fn records_events_gaps_and_checkpoints_without_duplicate_history() {
        let directory = std::env::temp_dir().join(format!(
            "universe-recording-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("history.db");
        let engine = Engine::new().unwrap();
        let (_, mut health) = engine.wait(0, 0).unwrap().unwrap();
        let mut writer = Writer::start(&path, &health).unwrap();
        let first_cursor = writer.event_cursor;
        assert_eq!(writer.connection.query_row("SELECT count(*) FROM checkpoints", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
        health.observed_at_unix_ms += 60_000;
        health.sequence = (health.sequence.parse::<u64>().unwrap() + 1).to_string();
        let processes = std::sync::Arc::make_mut(&mut health.processes);
        std::sync::Arc::make_mut(&mut processes.filesystem).revision = "new-revision".into();
        processes.events.last_sequence = first_cursor + 3;
        processes.events.rows.push(ProcessEvent {
            sequence: (first_cursor + 3).to_string(),
            observed_at_unix_ms: health.observed_at_unix_ms,
            previous_observed_at_unix_ms: 0,
            monotonic_ns: "0".into(),
            process_id: None,
            pid: 0,
            kind: "EVENT_GAP",
            reason: "incomplete",
            name: String::new(),
            resource_value: None,
            resource_threshold: None,
        });
        writer.connection.pragma_update(None, "query_only", "ON").unwrap();
        assert!(writer.record(&health, false).is_err());
        assert_eq!(writer.event_cursor, first_cursor);
        writer.connection.pragma_update(None, "query_only", "OFF").unwrap();
        writer.record(&health, false).unwrap();
        writer.record(&health, false).unwrap();
        assert_eq!(writer.connection.query_row("SELECT count(*) FROM events", [], |row| row.get::<_, i64>(0)).unwrap(), 3);
        assert_eq!(writer.connection.query_row("SELECT count(*) FROM checkpoints", [], |row| row.get::<_, i64>(0)).unwrap(), 2);
        writer.finish(health.observed_at_unix_ms).unwrap();
        drop(engine);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn aggregates_samples_and_preserves_retention_boundary() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&mut connection).unwrap();
        connection.execute("INSERT INTO sessions VALUES ('active', 1, NULL, 7, '0.8.0')", []).unwrap();
        connection.execute("INSERT INTO sessions VALUES ('expired', 1, 100, 7, '0.8.0')", []).unwrap();
        for value in [10.0, 20.0, 30.0] {
            record_sample(&connection, "active", 1000, "process", "cpu_percent", value).unwrap();
        }
        let sample: (f64, f64, f64, i64) = connection.query_row(
            "SELECT minimum, maximum, mean, count FROM resource_samples", [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        ).unwrap();
        assert_eq!(sample, (10.0, 30.0, 20.0, 3));
        for observed in [100, 500, 1500] {
            connection.execute("INSERT INTO checkpoints VALUES ('active', ?1, ?1, 'json', X'7B7D')", [observed]).unwrap();
        }
        connection.execute("INSERT INTO events VALUES ('active', 1, 100, NULL, NULL, 'old', '{}')", []).unwrap();
        connection.execute("INSERT INTO events VALUES ('active', 2, 700, NULL, NULL, 'kept', '{}')", []).unwrap();
        prune_history(&connection, RETENTION_MS + 1000).unwrap();
        assert_eq!(connection.query_row("SELECT min(observed_ms) FROM checkpoints", [], |row| row.get::<_, i64>(0)).unwrap(), 500);
        assert_eq!(connection.query_row("SELECT count(*) FROM events", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!(connection.query_row("SELECT count(*) FROM sessions", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
    }

    #[test]
    fn migration_is_persistent_and_idempotent() {
        let directory = std::env::temp_dir().join(format!(
            "universe-storage-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("history.db");
        {
            let connection = open(&path).unwrap();
            let version: i64 = connection
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .unwrap();
            let foreign_keys: i64 = connection
                .pragma_query_value(None, "foreign_keys", |row| row.get(0))
                .unwrap();
            let journal: String = connection
                .pragma_query_value(None, "journal_mode", |row| row.get(0))
                .unwrap();
            assert_eq!((version, foreign_keys), (1, 1));
            assert_eq!(journal, "wal");
            connection
                .execute(
                    "INSERT INTO sessions VALUES ('one', 1, NULL, 7, '0.7.0')",
                    [],
                )
                .unwrap();
            assert!(connection
                .execute(
                    "INSERT INTO events VALUES ('missing', 1, 1, NULL, NULL, 'event', '{}')",
                    []
                )
                .is_err());
        }
        let connection = open(&path).unwrap();
        let count: i64 = connection
            .query_row("SELECT count(*) FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        drop(connection);
        assert_eq!(sessions(&path, 1).unwrap().len(), 1);
        assert!(sessions(&path, 0).unwrap().is_empty());
        assert!(events(&path, "one", 0, 100).unwrap().is_empty());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn disk_failure_does_not_create_parent_directories() {
        let path = std::env::temp_dir()
            .join(format!("universe-missing-{}", std::process::id()))
            .join("missing")
            .join("history.db");
        assert!(open(&path).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn full_database_rejects_recording_without_advancing_cursor() {
        let directory = std::env::temp_dir().join(format!(
            "universe-full-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let engine = Engine::new().unwrap();
        let (_, mut health) = engine.wait(0, 0).unwrap().unwrap();
        let mut writer = Writer::start(&directory.join("history.db"), &health).unwrap();
        let cursor = writer.event_cursor;
        let pages: i64 = writer.connection.pragma_query_value(None, "page_count", |row| row.get(0)).unwrap();
        let limit: i64 = writer.connection.pragma_query_value(None, "max_page_count", |row| row.get(0)).unwrap();
        assert!(limit > pages);
        let actual: i64 = writer.connection.pragma_update_and_check(None, "max_page_count", pages + 1, |row| row.get(0)).unwrap();
        assert_eq!(actual, pages + 1);
        health.observed_at_unix_ms += 60_000;
        health.sequence = (health.sequence.parse::<u64>().unwrap() + 1).to_string();
        let events = &mut std::sync::Arc::make_mut(&mut health.processes).events;
        events.last_sequence = cursor + 1;
        events.rows.push(ProcessEvent {
            sequence: (cursor + 1).to_string(),
            observed_at_unix_ms: health.observed_at_unix_ms,
            previous_observed_at_unix_ms: 0,
            monotonic_ns: "0".into(),
            process_id: None,
            pid: 0,
            kind: "TEST",
            reason: "full",
            name: "x".repeat(256 * 1024),
            resource_value: None,
            resource_threshold: None,
        });
        assert!(matches!(writer.record(&health, false), Err(Error::SqliteFailure(error, _)) if error.code == rusqlite::ErrorCode::DiskFull));
        assert_eq!(writer.event_cursor, cursor);
        assert_eq!(writer.connection.query_row("SELECT count(*) FROM checkpoints", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
        drop(writer);
        drop(engine);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn corrupted_database_is_not_replaced() {
        let directory = std::env::temp_dir().join(format!(
            "universe-corrupt-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("history.db");
        std::fs::write(&path, b"not a sqlite database").unwrap();
        assert!(open(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"not a sqlite database");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn future_schema_is_not_downgraded() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.pragma_update(None, "user_version", 2).unwrap();
        assert!(migrate(&mut connection).is_err());
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 2);
    }
}
