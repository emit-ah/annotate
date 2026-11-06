//! The annotations in SQLite (EMIT ADR-0017): one row each, its body as JSON beside the columns lists filter by, and
//! its pictures as blobs. Every query here runs in the service's tests, as sqlx checks them at run time only
//! (ADR-0001). The database holds at most 1 GiB, and annotations done or not to be done go after 90 days.

use std::path::Path;
use std::str::FromStr;

use annotations::{Annotation, AnnotationBody, NewAnnotation, Status, StatusUpdate};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{FromRow, SqlitePool};

/// The time now in UTC as RFC 3339, as SQLite writes it. Queries are literals, which sqlx asks for against injection,
/// so their shared parts are macros.
macro_rules! now {
    () => {
        "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
    };
}

/// The days an annotation that is done, or won't be, stays.
pub const KEEP_RESOLVED_DAYS: u32 = 90;
/// The most pages of 4 KiB the database has: 1 GiB.
const MAX_PAGES: &str = "262144";

/// The columns of a [`Row`].
macro_rules! columns {
    () => {
        "id, created, updated, author, status, answer, resolved_in, body, \
         crop IS NOT NULL AS has_crop, frame IS NOT NULL AS has_frame"
    };
}

/// What went wrong in the store.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// The database failed.
    #[error("the database failed: {0}")]
    Database(#[from] sqlx::Error),
    /// The schema could not be brought up to date.
    #[error("the schema could not be migrated: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),
    /// A body in the database does not read, which only a change of the database by hand can cause.
    #[error("the body of annotation {id} does not read: {source}")]
    Body {
        /// The annotation's ID.
        id: String,
        /// Why.
        source: serde_json::Error,
    },
    /// A status in the database is none the service knows.
    #[error("annotation {0} has an unknown status")]
    Status(String),
}

/// Which annotations a list holds; what it leaves out does not filter.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Filter {
    /// Only those of this status.
    pub status: Option<Status>,
    /// Only those of this app.
    pub app: Option<String>,
    /// Only those of this page.
    pub path: Option<String>,
    /// Only those of this version.
    pub version: Option<String>,
}

/// One of an annotation's pictures.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Picture {
    /// The crop around its target.
    Crop,
    /// The whole window.
    Frame,
}

/// The annotations of one SQLite database.
#[derive(Debug, Clone)]
pub struct Store {
    pool: SqlitePool,
}

#[derive(FromRow)]
struct Row {
    id: String,
    created: String,
    updated: String,
    author: String,
    status: String,
    answer: Option<String>,
    resolved_in: Option<String>,
    body: String,
    has_crop: bool,
    has_frame: bool,
}

impl Row {
    fn annotation(self) -> Result<Annotation, StoreError> {
        let body: AnnotationBody =
            serde_json::from_str(&self.body).map_err(|source| StoreError::Body {
                id: self.id.clone(),
                source,
            })?;
        let status =
            Status::from_str(&self.status).map_err(|_| StoreError::Status(self.id.clone()))?;
        Ok(Annotation {
            id: self.id,
            created: self.created,
            updated: self.updated,
            author: self.author,
            status,
            answer: self.answer,
            resolved_in: self.resolved_in,
            has_crop: self.has_crop,
            has_frame: self.has_frame,
            body,
        })
    }
}

impl Store {
    /// The store in the file `path`, made where there is none, its schema brought up to date.
    ///
    /// # Errors
    ///
    /// Where the file cannot be opened or the schema not migrated.
    pub async fn open(path: &Path) -> Result<Self, StoreError> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .pragma("max_page_count", MAX_PAGES);
        Self::with(
            SqlitePoolOptions::new()
                .max_connections(4)
                .connect_with(options)
                .await?,
        )
        .await
    }

    /// A store in memory, which ends with it, for tests.
    ///
    /// # Errors
    ///
    /// Where SQLite cannot start.
    pub async fn in_memory() -> Result<Self, StoreError> {
        let options = SqliteConnectOptions::from_str("sqlite::memory:")?;
        // One connection, as each connection to memory is a database of its own.
        Self::with(
            SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await?,
        )
        .await
    }

    async fn with(pool: SqlitePool) -> Result<Self, StoreError> {
        sqlx::migrate!("./migrations").run(&pool).await?;
        let store = Self { pool };
        store.purge().await?;
        Ok(store)
    }

    /// Closes the database, after the requests that use it.
    pub async fn close(&self) {
        self.pool.close().await;
    }

    /// Removes the annotations done, or not to be done, for more than [`KEEP_RESOLVED_DAYS`] days; how many.
    ///
    /// # Errors
    ///
    /// Where the database fails.
    pub async fn purge(&self) -> Result<u64, StoreError> {
        let removed = sqlx::query(
            "DELETE FROM annotations WHERE status IN ('done', 'wont_do') \
             AND updated < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?1)",
        )
        .bind(format!("-{KEEP_RESOLVED_DAYS} days"))
        .execute(&self.pool)
        .await?;
        Ok(removed.rows_affected())
    }

    /// Whether the database answers.
    ///
    /// # Errors
    ///
    /// Where it does not.
    pub async fn ready(&self) -> Result<(), StoreError> {
        sqlx::query("SELECT 1").execute(&self.pool).await?;
        Ok(())
    }

    /// Keeps `annotation` by `author`, open, and gives it back as kept.
    ///
    /// # Errors
    ///
    /// Where the database fails.
    pub async fn insert(
        &self,
        author: &str,
        annotation: NewAnnotation,
    ) -> Result<Annotation, StoreError> {
        let id = uuid::Uuid::now_v7().to_string();
        let body = serde_json::to_string(&annotation.body).map_err(|source| StoreError::Body {
            id: id.clone(),
            source,
        })?;
        sqlx::query(concat!(
            "INSERT INTO annotations (id, created, updated, author, status, app, path, version, body, crop, frame) \
             VALUES (?1, ",
            now!(),
            ", ",
            now!(),
            ", ?2, 'open', ?3, ?4, ?5, ?6, ?7, ?8)"
        ))
        .bind(&id)
        .bind(author)
        .bind(&annotation.body.app)
        .bind(&annotation.body.path)
        .bind(&annotation.body.version)
        .bind(body)
        .bind(annotation.crop.map(|png| png.0))
        .bind(annotation.frame.map(|png| png.0))
        .execute(&self.pool)
        .await?;
        self.get(&id)
            .await?
            .ok_or(StoreError::Database(sqlx::Error::RowNotFound))
    }

    /// The annotation `id`; none where there is no such.
    ///
    /// # Errors
    ///
    /// Where the database fails.
    pub async fn get(&self, id: &str) -> Result<Option<Annotation>, StoreError> {
        sqlx::query_as::<_, Row>(concat!(
            "SELECT ",
            columns!(),
            " FROM annotations WHERE id = ?1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .map(Row::annotation)
        .transpose()
    }

    /// The annotations that `filter` lets through, the newest first.
    ///
    /// # Errors
    ///
    /// Where the database fails.
    pub async fn list(&self, filter: &Filter) -> Result<Vec<Annotation>, StoreError> {
        sqlx::query_as::<_, Row>(concat!(
            "SELECT ",
            columns!(),
            " FROM annotations \
             WHERE (?1 IS NULL OR status = ?1) AND (?2 IS NULL OR app = ?2) AND (?3 IS NULL OR path = ?3) \
             AND (?4 IS NULL OR version = ?4) \
             ORDER BY created DESC, id DESC"
        ))
        .bind(filter.status.map(Status::as_str))
        .bind(filter.app.as_deref())
        .bind(filter.path.as_deref())
        .bind(filter.version.as_deref())
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(Row::annotation)
        .collect()
    }

    /// The picture `which` of the annotation `id`; none where it has none or there is no such annotation.
    ///
    /// # Errors
    ///
    /// Where the database fails.
    pub async fn picture(&self, id: &str, which: Picture) -> Result<Option<Vec<u8>>, StoreError> {
        let query = match which {
            Picture::Crop => "SELECT crop FROM annotations WHERE id = ?1",
            Picture::Frame => "SELECT frame FROM annotations WHERE id = ?1",
        };
        let picture: Option<Option<Vec<u8>>> = sqlx::query_scalar(query)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(picture.flatten())
    }

    /// Applies `update` to the annotation `id` and gives it back; none where there is no such. What it leaves out
    /// stays, and an empty answer or commit clears it.
    ///
    /// # Errors
    ///
    /// Where the database fails.
    pub async fn update(
        &self,
        id: &str,
        update: &StatusUpdate,
    ) -> Result<Option<Annotation>, StoreError> {
        let changed = sqlx::query(concat!(
            "UPDATE annotations SET status = coalesce(?2, status), \
             answer = CASE WHEN ?3 IS NULL THEN answer ELSE nullif(?3, '') END, \
             resolved_in = CASE WHEN ?4 IS NULL THEN resolved_in ELSE nullif(?4, '') END, updated = ",
            now!(),
            " WHERE id = ?1"
        ))
        .bind(id)
        .bind(update.status.map(Status::as_str))
        .bind(update.answer.as_deref())
        .bind(update.resolved_in.as_deref())
        .execute(&self.pool)
        .await?;
        if changed.rows_affected() == 0 {
            return Ok(None);
        }
        self.get(id).await
    }

    /// Reopens the annotation `id` of `author` where it is done or won't be, which clears its resolving commit, and
    /// gives it back; none where it is not such an annotation of theirs.
    ///
    /// # Errors
    ///
    /// Where the database fails.
    pub async fn reopen(&self, id: &str, author: &str) -> Result<Option<Annotation>, StoreError> {
        let changed = sqlx::query(concat!(
            "UPDATE annotations SET status = 'open', resolved_in = NULL, updated = ",
            now!(),
            " WHERE id = ?1 AND author = ?2 AND status IN ('done', 'wont_do')"
        ))
        .bind(id)
        .bind(author)
        .execute(&self.pool)
        .await?;
        if changed.rows_affected() == 0 {
            return Ok(None);
        }
        self.get(id).await
    }

    /// Removes the annotation `id` where `author` wrote it and it is still open, in one step; whether it did.
    ///
    /// # Errors
    ///
    /// Where the database fails.
    pub async fn delete_open(&self, id: &str, author: &str) -> Result<bool, StoreError> {
        let removed = sqlx::query(
            "DELETE FROM annotations WHERE id = ?1 AND author = ?2 AND status = 'open'",
        )
        .bind(id)
        .bind(author)
        .execute(&self.pool)
        .await?;
        Ok(removed.rows_affected() > 0)
    }
}
