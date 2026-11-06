//! The service's settings (ADR-0001): it fails closed, runs open on the loopback only, and names its callers, admins
//! and apps as its settings say.
#![expect(
    clippy::expect_used,
    reason = "a test fails where the settings it expects to read do not"
)]

use std::net::SocketAddr;

use annotations_server::settings::{Settings, SettingsError};
use axum::http::HeaderName;

/// The settings of `pairs`, as the environment would give them.
fn read(pairs: &[(&str, &str)]) -> Result<Settings, SettingsError> {
    Settings::from_settings(|name| {
        pairs
            .iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| (*value).to_owned())
    })
}

fn address(text: &str) -> SocketAddr {
    text.parse().expect("an address")
}

#[test]
fn without_a_proxy_s_header_or_the_local_setting_the_service_does_not_start() {
    assert!(matches!(read(&[]), Err(SettingsError::Closed)));
    assert!(matches!(
        read(&[("ANNOTATIONS_OPEN", "yes")]),
        Err(SettingsError::Closed)
    ));
    assert!(matches!(
        read(&[("ANNOTATIONS_USER_HEADER", "no header")]),
        Err(SettingsError::UserHeader)
    ));
}

#[test]
fn open_it_listens_on_the_loopback_only() {
    let open = read(&[("ANNOTATIONS_OPEN", "local")]).expect("open settings");
    assert!(open.access.user_header.is_none());
    assert_eq!(open.listen, address("127.0.0.1:8080"));
    let other_port = read(&[
        ("ANNOTATIONS_OPEN", "local"),
        ("ANNOTATIONS_LISTEN", "[::1]:9000"),
    ])
    .expect("v6");
    assert_eq!(other_port.listen, address("[::1]:9000"));
    for wide in ["0.0.0.0:8080", "192.168.1.5:8080", "[::]:8080"] {
        assert!(
            matches!(
                read(&[("ANNOTATIONS_OPEN", "local"), ("ANNOTATIONS_LISTEN", wide)]),
                Err(SettingsError::OpenBeyondLoopback(_))
            ),
            "{wide}"
        );
    }
}

#[test]
fn behind_a_proxy_it_listens_on_every_address_and_names_its_admins_and_apps() {
    let proxied = read(&[
        ("ANNOTATIONS_USER_HEADER", " X-Auth-User "),
        ("ANNOTATIONS_ADMINS", " claude, ,ben"),
        ("ANNOTATIONS_APPS", "mappa, tutti"),
        ("ANNOTATIONS_DATABASE", "/data/annotations.db"),
    ])
    .expect("proxied settings");
    assert_eq!(
        proxied.access.user_header,
        Some(HeaderName::from_static("x-auth-user"))
    );
    assert_eq!(proxied.access.admins, ["claude", "ben"]);
    assert_eq!(proxied.access.apps, ["mappa", "tutti"]);
    assert_eq!(proxied.listen, address("0.0.0.0:8080"));
    assert_eq!(proxied.database.to_str(), Some("/data/annotations.db"));
    assert!(matches!(
        read(&[
            ("ANNOTATIONS_USER_HEADER", "X-Auth-User"),
            ("ANNOTATIONS_APPS", "Mappa")
        ]),
        Err(SettingsError::App(app)) if app == "Mappa"
    ));
    assert!(matches!(
        read(&[
            ("ANNOTATIONS_USER_HEADER", "X-Auth-User"),
            ("ANNOTATIONS_LISTEN", "port 8080")
        ]),
        Err(SettingsError::Listen(_))
    ));
}
