use std::path::Path;

use rusqlite::{Connection, Error, Result};

pub fn open(path: &Path) -> Result<Connection> {
    let mut connection = Connection::open(path)?;
    connection.busy_timeout(std::time::Duration::from_millis(250))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&mut connection)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
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
