//! The annotation service's binary: `serve` runs it with the settings of its environment (see
//! [`annotations_server::settings`]), `health` asks a running one whether it is ready, as the image has no other client
//! for Compose's health check.

use std::io::{Read as _, Write as _};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use annotations_server::api::router;
use annotations_server::settings::Settings;
use annotations_server::store::{KEEP_RESOLVED_DAYS, PURGE_EVERY, Store, purge_every};
use anyhow::{Context as _, bail};
use tokio::signal::unix::{SignalKind, signal};

/// How long the health check waits for the service to connect and to answer.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(3);
/// The bytes of the answer the health check reads: its status line.
const HEALTH_ANSWER_BYTES: u64 = 64;

fn main() -> anyhow::Result<()> {
    match std::env::args().nth(1).as_deref() {
        Some("serve") | None => serve(),
        Some("health") => health(),
        Some(other) => bail!("no command {other}: serve or health"),
    }
}

fn serve() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_target(false).init();
    let Settings {
        listen,
        database,
        access,
    } = Settings::from_env()?;
    tokio::runtime::Runtime::new()?.block_on(async {
        let store = Store::open(&database)
            .await
            .with_context(|| format!("opening {}", database.display()))?;
        let listener = tokio::net::TcpListener::bind(listen).await?;
        tracing::info!(%listen, open = access.open(), apps = ?access.apps, "the annotation service runs");
        let purging = purge_every(store.clone(), PURGE_EVERY, KEEP_RESOLVED_DAYS);
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
        purging.abort();
        store.close().await;
        tracing::info!("the annotation service stopped");
        anyhow::Ok(())
    })
}

/// Asks the service on this host whether it is ready; fails where it does not say 200.
fn health() -> anyhow::Result<()> {
    let listen = Settings::from_env()?.listen;
    let local = SocketAddr::from(([127, 0, 0, 1], listen.port()));
    let mut stream = TcpStream::connect_timeout(&local, HEALTH_TIMEOUT)?;
    stream.set_read_timeout(Some(HEALTH_TIMEOUT))?;
    stream.write_all(b"GET /health/ready HTTP/1.0\r\nHost: localhost\r\n\r\n")?;
    let mut answer = String::new();
    stream
        .take(HEALTH_ANSWER_BYTES)
        .read_to_string(&mut answer)?;
    if answer.starts_with("HTTP/1.1 200") || answer.starts_with("HTTP/1.0 200") {
        Ok(())
    } else {
        bail!("not ready: {}", answer.lines().next().unwrap_or_default())
    }
}
