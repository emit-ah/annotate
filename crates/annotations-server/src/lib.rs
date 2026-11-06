//! The annotation service (ADR-0001): keeps the annotations that the client of any app sends in SQLite and serves
//! them, with their pictures, statuses and answers, over an HTTP API. Each project runs its own instance, in its
//! local stack and its dev deployment only.

pub mod api;
pub mod store;
