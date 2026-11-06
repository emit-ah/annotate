//! The annotation service's binary: `serve` runs it, `health` asks a running one whether it is ready, as the image
//! has no other client for Compose's health check.
//!
//! `serve` reads its settings from the environment:
//! - `ANNOTATIONS_LISTEN`: the address, `0.0.0.0:8080` where none is set;
//! - `ANNOTATIONS_DATABASE`: the SQLite file, `annotations.db` in the working directory where none is set;
//! - `ANNOTATIONS_USER_HEADER`: the header the reverse proxy names the caller in, after its auth;
//! - `ANNOTATIONS_OPEN`: `local` where the service runs without that header, every caller `local` and an admin, as
//!   in the local stack; without either, it does not start, so a slip of its settings opens nothing;
//! - `ANNOTATIONS_ADMINS`: the callers, separated by commas, who change statuses and answers;
//! - `ANNOTATIONS_APPS`: the apps, separated by commas, whose annotations it keeps; any where none is set.

use std::io::{Read as _, Write as _};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::time::Duration;

use annotations_server::api::{Access, router};
use annotations_server::store::Store;
use anyhow::{Context as _, bail};
use tokio::signal::unix::{SignalKind, signal};

const LISTEN: &str = "0.0.0.0:8080";
const DATABASE: &str = "annotations.db";

fn main() -> anyhow::Result<()> {
    match std::env::args().nth(1).as_deref() {
        Some("serve") | None => serve(),
        Some("health") => health(),
        Some(other) => bail!("no command {other}: serve or health"),
    }
}

fn setting(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn serve() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_target(false).init();
    let listen: SocketAddr = setting("ANNOTATIONS_LISTEN")
        .as_deref()
        .unwrap_or(LISTEN)
        .parse()
        .context("ANNOTATIONS_LISTEN is no address")?;
    let database =
        PathBuf::from(setting("ANNOTATIONS_DATABASE").unwrap_or_else(|| DATABASE.to_owned()));
    let access =
        Access::from_settings(|name| std::env::var(name).ok()).map_err(anyhow::Error::msg)?;
    tokio::runtime::Runtime::new()?.block_on(async {
        let store = Store::open(&database)
            .await
            .with_context(|| format!("opening {}", database.display()))?;
        let listener = tokio::net::TcpListener::bind(listen).await?;
        tracing::info!(%listen, open = access.user_header.is_none(), apps = ?access.apps, "the annotation service runs");
        let mut terminate = signal(SignalKind::terminate())?;
        axum::serve(listener, router(store.clone(), access))
            .with_graceful_shutdown(async move {
                // Docker stops a container with SIGTERM, a terminal with Ctrl-C.
                tokio::select! {
                    _ = terminate.recv() => {}
                    _ = tokio::signal::ctrl_c() => {}
                }
            })
            .await?;
        store.close().await;
        tracing::info!("the annotation service stopped");
        anyhow::Ok(())
    })
}

/// Asks the service on this host whether it is ready; fails where it does not say 200.
fn health() -> anyhow::Result<()> {
    let listen: SocketAddr = setting("ANNOTATIONS_LISTEN")
        .as_deref()
        .unwrap_or(LISTEN)
        .parse()?;
    let local = SocketAddr::from(([127, 0, 0, 1], listen.port()));
    let mut stream = TcpStream::connect_timeout(&local, Duration::from_secs(3))?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.write_all(b"GET /health/ready HTTP/1.0\r\nHost: localhost\r\n\r\n")?;
    let mut answer = String::new();
    stream.take(64).read_to_string(&mut answer)?;
    if answer.starts_with("HTTP/1.1 200") || answer.starts_with("HTTP/1.0 200") {
        Ok(())
    } else {
        bail!("not ready: {}", answer.lines().next().unwrap_or_default())
    }
}
