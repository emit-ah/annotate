-- The annotations (ADR-0001). The body is the JSON of annotations::AnnotationBody; its app, path, version and status
-- are columns of their own, as lists filter by them. The app's context and the console's entries are JSON, and the
-- pictures PNG, each served on its own.
CREATE TABLE annotations (
    id TEXT PRIMARY KEY NOT NULL,
    created TEXT NOT NULL,
    updated TEXT NOT NULL,
    author TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'done', 'wont_do')),
    answer TEXT,
    resolved_in TEXT,
    app TEXT NOT NULL,
    path TEXT NOT NULL,
    version TEXT NOT NULL,
    body TEXT NOT NULL,
    crop BLOB,
    frame BLOB,
    context TEXT,
    console TEXT
) STRICT;

CREATE INDEX annotations_by_status ON annotations (app, status, created);
CREATE INDEX annotations_by_path ON annotations (app, path, created);
