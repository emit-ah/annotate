//! What every request and answer of the API goes through (ADR-0001): changes only from the app's own pages, answers
//! that no other site reads, and, while the service runs open, requests for the loopback's names only.

use axum::extract::Request;
use axum::http::header::{CACHE_CONTROL, CONTENT_SECURITY_POLICY, HOST, X_CONTENT_TYPE_OPTIONS};
use axum::http::{HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::problem::ApiError;

/// The host names the service answers while it runs open.
const LOOPBACK_HOSTS: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

/// A request that changes something comes from the app's own pages or from a client that is no browser, such as `make
/// annotation-status`: a browser marks a request another site makes with `Sec-Fetch-Site`, and as it sends the basic
/// auth along by itself, the service refuses such a change rather than trust the proxy's login alone.
pub(crate) async fn same_origin_changes(request: Request, next: Next) -> Response {
    let changes = !matches!(*request.method(), Method::GET | Method::HEAD);
    let cross_site = request
        .headers()
        .get(HeaderName::from_static("sec-fetch-site"))
        .is_some_and(|site| site.as_bytes() != b"same-origin" && site.as_bytes() != b"none");
    if changes && cross_site {
        return ApiError::new(
            StatusCode::FORBIDDEN,
            "a change comes from the app's own pages only",
        )
        .into_response();
    }
    next.run(request).await
}

/// Every answer of the API: never sniffed, never run as a page, never cached, and never read by another site's page.
pub(crate) async fn guard_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(
        HeaderName::from_static("cross-origin-resource-policy"),
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'; sandbox"),
    );
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// The host a `Host` header names, without its port.
fn host_name(host: &str) -> &str {
    match host.strip_prefix('[') {
        Some(rest) => rest.find(']').map_or(host, |end| &host[..end + 2]),
        None => host.split(':').next().unwrap_or(host),
    }
}

/// While the service runs open, it answers only requests for the loopback's names: a page of another site whose name
/// leads to the loopback, as by DNS rebinding, reads and writes nothing.
pub(crate) async fn loopback_hosts(request: Request, next: Next) -> Response {
    let local = request
        .headers()
        .get(HOST)
        .and_then(|host| host.to_str().ok())
        .is_some_and(|host| LOOPBACK_HOSTS.contains(&host_name(host)));
    if !local {
        return ApiError::new(
            StatusCode::MISDIRECTED_REQUEST,
            "the service runs open and answers requests for localhost only",
        )
        .into_response();
    }
    next.run(request).await
}
