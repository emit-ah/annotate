//! The service's settings, from its environment (ADR-0001). It fails closed: it starts only behind an auth proxy that
//! names the caller in a header, or open with `ANNOTATIONS_OPEN=local`, and open only on the loopback.
//!
//! - `ANNOTATIONS_USER_HEADER`: the header the reverse proxy names the caller in, after its auth;
//! - `ANNOTATIONS_OPEN`: `local` where the service runs without that header, every caller `local` and an admin;
//! - `ANNOTATIONS_LISTEN`: the address; `0.0.0.0:8080` behind a proxy, `127.0.0.1:8080` open, which takes no other
//!   address than the loopback's;
//! - `ANNOTATIONS_DATABASE`: the SQLite file, `annotations.db` in the working directory where none is set;
//! - `ANNOTATIONS_ADMINS`: the callers, separated by commas, who change statuses and answers;
//! - `ANNOTATIONS_APPS`: the apps, separated by commas, whose annotations it keeps; any where none is set.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

use annotations::is_app_name;
use axum::http::HeaderName;

/// The port the service listens on where its settings name no address.
pub const PORT: u16 = 8080;
/// The SQLite file where the settings name none.
const DATABASE: &str = "annotations.db";
/// The value of `ANNOTATIONS_OPEN` that runs the service open.
const OPEN: &str = "local";

/// Why the settings do not start the service.
#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    /// Neither a proxy's header nor the local setting is set.
    #[error(
        "set ANNOTATIONS_USER_HEADER behind an auth proxy, or ANNOTATIONS_OPEN=local on the loopback only"
    )]
    Closed,
    /// The proxy's header is no header's name.
    #[error("ANNOTATIONS_USER_HEADER is no header name")]
    UserHeader,
    /// The address does not read.
    #[error("ANNOTATIONS_LISTEN is no address: {0}")]
    Listen(String),
    /// The service would run open beyond the loopback.
    #[error("ANNOTATIONS_OPEN=local listens on the loopback only, not on {0}")]
    OpenBeyondLoopback(SocketAddr),
    /// An app is no app's name.
    #[error("ANNOTATIONS_APPS names {0}, which is no app's name")]
    App(String),
}

/// Who may do what.
#[derive(Debug, Clone, Default)]
pub struct Access {
    /// The header that names the caller, set by the reverse proxy; none where the service runs open and every caller
    /// is `local`.
    pub user_header: Option<HeaderName>,
    /// The callers who change statuses and answers, such as `claude`.
    pub admins: Vec<String>,
    /// The apps whose annotations the service keeps; any where none is named.
    pub apps: Vec<String>,
}

impl Access {
    /// Whether the service keeps the annotations of `app`.
    #[must_use]
    pub fn keeps(&self, app: &str) -> bool {
        self.apps.is_empty() || self.apps.iter().any(|kept| kept == app)
    }

    /// Whether the service runs open, without a proxy that names its callers.
    #[must_use]
    pub fn open(&self) -> bool {
        self.user_header.is_none()
    }
}

/// The service's settings.
#[derive(Debug, Clone)]
pub struct Settings {
    /// The address it listens on.
    pub listen: SocketAddr,
    /// Its SQLite file.
    pub database: PathBuf,
    /// Who may do what.
    pub access: Access,
}

impl Settings {
    /// The settings in the environment.
    ///
    /// # Errors
    ///
    /// As [`Settings::from_settings`].
    pub fn from_env() -> Result<Self, SettingsError> {
        Self::from_settings(|name| std::env::var(name).ok())
    }

    /// The settings that `setting` gives by name; a setting of only white space counts as none.
    ///
    /// # Errors
    ///
    /// Where the service would start neither behind a proxy nor open on the loopback, or a setting does not read.
    pub fn from_settings(setting: impl Fn(&str) -> Option<String>) -> Result<Self, SettingsError> {
        let setting = |name: &str| {
            setting(name)
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        };
        let list = |name: &str| -> Vec<String> {
            setting(name)
                .unwrap_or_default()
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(str::to_owned)
                .collect()
        };
        let user_header = setting("ANNOTATIONS_USER_HEADER")
            .map(|name| HeaderName::try_from(name).map_err(|_| SettingsError::UserHeader))
            .transpose()?;
        let open = setting("ANNOTATIONS_OPEN").as_deref() == Some(OPEN);
        if user_header.is_none() && !open {
            return Err(SettingsError::Closed);
        }
        let apps = list("ANNOTATIONS_APPS");
        if let Some(app) = apps.iter().find(|app| !is_app_name(app)) {
            return Err(SettingsError::App(app.clone()));
        }
        let access = Access {
            user_header,
            admins: list("ANNOTATIONS_ADMINS"),
            apps,
        };
        Ok(Self {
            listen: listen(setting("ANNOTATIONS_LISTEN"), access.open())?,
            database: PathBuf::from(
                setting("ANNOTATIONS_DATABASE").unwrap_or_else(|| DATABASE.to_owned()),
            ),
            access,
        })
    }
}

/// The address `given` names, else every address behind a proxy and the loopback where the service runs `open`, which
/// takes the loopback only.
fn listen(given: Option<String>, open: bool) -> Result<SocketAddr, SettingsError> {
    let fallback = if open {
        IpAddr::V4(Ipv4Addr::LOCALHOST)
    } else {
        IpAddr::V4(Ipv4Addr::UNSPECIFIED)
    };
    let address = match given {
        Some(text) => text
            .parse::<SocketAddr>()
            .map_err(|error| SettingsError::Listen(error.to_string()))?,
        None => SocketAddr::new(fallback, PORT),
    };
    if open && !address.ip().is_loopback() {
        return Err(SettingsError::OpenBeyondLoopback(address));
    }
    Ok(address)
}
