//! The annotation service's HTTP API (EMIT ADR-0025): `/api/v1/annotations` in JSON, every error as problem details
//! of RFC 9457, and `/health/live` and `/health/ready` for Compose. Who calls comes from a header that the reverse
//! proxy sets after its basic auth (ADR-0001); the service refuses to start without one unless it is told it runs
//! open, as in the local stack, where every caller is `local` and may do all. An instance keeps the annotations of
//! any app, or of those its settings name.

use std::sync::Arc;

use annotations::{
    Annotation, MAX_CONSOLE, MAX_CONTEXT_BYTES, MAX_PNG_BYTES, MAX_STACK, MAX_TEXT, NewAnnotation,
    Status, StatusUpdate,
};
use axum::extract::{DefaultBodyLimit, FromRequestParts, State};
use axum::http::StatusCode;
use axum::http::header::CONTENT_TYPE;
use axum::http::request::Parts;
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use utoipa::OpenApi;

use crate::guard::{guard_headers, loopback_hosts, same_origin_changes};
use crate::pictures::check_png;
use crate::problem::{ApiError, Body, Filters, Params, Problem};
use crate::settings::Access;
use crate::store::{Attachment, Filter, Picture, Store};

/// The most bytes the console's entries have in JSON: each a message, an address and a stack, of characters of up to
/// 4 bytes, escaped at worst to 6.
const CONSOLE_BYTES: usize = MAX_CONSOLE * (2 * MAX_TEXT + MAX_STACK) * 6;
/// The most bytes a request has: two pictures of [`MAX_PNG_BYTES`] each in Base64, the context, the console, and 1 MB
/// for the rest.
const BODY_LIMIT: usize =
    2 * MAX_PNG_BYTES.div_ceil(3) * 4 + MAX_CONTEXT_BYTES + CONSOLE_BYTES + 1_000_000;
/// The annotations a list holds where it names no limit, and the most it may name.
const DEFAULT_LIST_LIMIT: u32 = 100;
const MAX_LIST_LIMIT: u32 = 500;
/// The name of every caller while the service runs open.
const LOCAL_CALLER: &str = "local";

#[derive(Clone)]
struct App {
    store: Store,
    access: Arc<Access>,
}

/// The service's routes over `store`, with `access`.
pub fn router(store: Store, access: Access) -> Router {
    let open = access.open();
    let app = App {
        store,
        access: Arc::new(access),
    };
    let routes = Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .route("/api/v1/annotations", get(list).post(create))
        .route(
            "/api/v1/annotations/{id}",
            get(one).patch(update).delete(remove),
        )
        .route("/api/v1/annotations/{id}/{part}", get(part))
        .fallback(|| async { ApiError::new(StatusCode::NOT_FOUND, "there is no such resource") })
        .method_not_allowed_fallback(|| async {
            ApiError::new(
                StatusCode::METHOD_NOT_ALLOWED,
                "the resource does not take this method",
            )
        })
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(middleware::from_fn(same_origin_changes));
    let routes = if open {
        routes.layer(middleware::from_fn(loopback_hosts))
    } else {
        routes
    };
    routes
        .layer(middleware::from_fn(guard_headers))
        .with_state(app)
}

/// The API's OpenAPI document, which `openapi.json` holds as committed.
#[derive(OpenApi)]
#[openapi(
    info(
        title = "annotate",
        version = "1",
        description = "The annotations of an app's testers and Claude's answers (ADR-0001).",
        license(name = "Proprietary, all rights reserved")
    ),
    paths(list, create, one, update, remove, part, live, ready),
    components(schemas(Problem))
)]
pub struct ApiDoc;

/// Who calls, and whether they change statuses and answers.
struct Caller {
    name: String,
    admin: bool,
}

impl FromRequestParts<App> for Caller {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, app: &App) -> Result<Self, Self::Rejection> {
        let Some(header) = &app.access.user_header else {
            return Ok(Self {
                name: LOCAL_CALLER.to_owned(),
                admin: true,
            });
        };
        // Exactly as the proxy wrote it, which overwrites whatever the client sent in this header.
        let name = parts
            .headers
            .get(header)
            .and_then(|value| value.to_str().ok())
            .filter(|name| !name.is_empty())
            .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "the request names no user"))?;
        Ok(Self {
            admin: app.access.admins.iter().any(|admin| admin == name),
            name: name.to_owned(),
        })
    }
}

/// The query of a list.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
struct ListQuery {
    /// Only those of this status.
    status: Option<Status>,
    /// Only those of this app.
    app: Option<String>,
    /// Only those of this page.
    path: Option<String>,
    /// Only those of this version.
    version: Option<String>,
    /// The most it holds: 100 where it names none, 500 at most.
    limit: Option<u32>,
}

/// The service runs.
#[utoipa::path(get, path = "/health/live", responses((status = 200, description = "It runs.")))]
async fn live() -> &'static str {
    "ok"
}

/// The service and its database answer.
#[utoipa::path(get, path = "/health/ready", responses(
    (status = 200, description = "It answers."),
    (status = 503, description = "Its database does not.", body = Problem, content_type = "application/problem+json"),
))]
async fn ready(State(app): State<App>) -> Result<&'static str, ApiError> {
    app.store.ready().await.map(|()| "ok").map_err(|_| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "the database does not answer",
        )
    })
}

/// The annotations, the newest first.
#[utoipa::path(get, path = "/api/v1/annotations", params(ListQuery), responses(
    (status = 200, description = "The annotations, without their pictures.", body = [Annotation]),
    (status = 400, description = "The query does not read, or its limit is out of range.", body = Problem, content_type = "application/problem+json"),
    (status = 421, description = "The service runs open and the request is for another host than localhost.", body = Problem, content_type = "application/problem+json"),
    (status = 401, description = "No user is named.", body = Problem, content_type = "application/problem+json"),
))]
async fn list(
    State(app): State<App>,
    _caller: Caller,
    Filters(query): Filters<ListQuery>,
) -> Result<Json<Vec<Annotation>>, ApiError> {
    let limit = query.limit.unwrap_or(DEFAULT_LIST_LIMIT);
    if !(1..=MAX_LIST_LIMIT).contains(&limit) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("limit is not between 1 and {MAX_LIST_LIMIT}"),
        ));
    }
    let filter = Filter {
        status: query.status,
        app: query.app,
        path: query.path,
        version: query.version,
        limit,
    };
    Ok(Json(app.store.list(&filter).await?))
}

/// Keeps a new annotation, open, by the caller.
#[utoipa::path(post, path = "/api/v1/annotations", request_body = NewAnnotation, responses(
    (status = 201, description = "It is kept.", body = Annotation),
    (status = 401, description = "No user is named.", body = Problem, content_type = "application/problem+json"),
    (status = 403, description = "Another site's page asks for it.", body = Problem, content_type = "application/problem+json"),
    (status = 413, description = "It is larger than the service takes.", body = Problem, content_type = "application/problem+json"),
    (status = 422, description = "It does not read, breaks a limit, names an app the service does not keep, or a picture is no PNG.", body = Problem, content_type = "application/problem+json"),
    (status = 507, description = "The database holds as much as it may.", body = Problem, content_type = "application/problem+json"),
))]
async fn create(
    State(app): State<App>,
    caller: Caller,
    Body(annotation): Body<NewAnnotation>,
) -> Result<(StatusCode, Json<Annotation>), ApiError> {
    annotation
        .check()
        .map_err(|invalid| ApiError::invalid(invalid.to_string()))?;
    if !app.access.keeps(&annotation.body.app) {
        return Err(ApiError::invalid(format!(
            "app {} is not kept by this service",
            annotation.body.app
        )));
    }
    for (field, picture) in [("crop", &annotation.crop), ("frame", &annotation.frame)] {
        if let Some(png) = picture {
            check_png(&png.0).map_err(|reason| ApiError::invalid(format!("{field} {reason}")))?;
        }
    }
    let kept = app.store.insert(&caller.name, annotation).await?;
    tracing::info!(id = %kept.id, "an annotation came");
    Ok((StatusCode::CREATED, Json(kept)))
}

/// One annotation.
#[utoipa::path(get, path = "/api/v1/annotations/{id}", params(("id" = String, Path, description = "Its ID.")), responses(
    (status = 200, description = "The annotation, without its pictures.", body = Annotation),
    (status = 404, description = "There is no such.", body = Problem, content_type = "application/problem+json"),
))]
async fn one(
    State(app): State<App>,
    _caller: Caller,
    Params(id): Params<String>,
) -> Result<Json<Annotation>, ApiError> {
    app.store
        .get(&id)
        .await?
        .map(Json)
        .ok_or_else(ApiError::not_found)
}

/// Changes an annotation: an admin its status, answer or resolving commit, and its author only reopens it, where it
/// is done or won't be. Reopening clears its resolving commit.
#[utoipa::path(patch, path = "/api/v1/annotations/{id}", params(("id" = String, Path, description = "Its ID.")),
    request_body = StatusUpdate, responses(
    (status = 200, description = "It is changed.", body = Annotation),
    (status = 403, description = "The caller may not, or another site's page asks for it.", body = Problem, content_type = "application/problem+json"),
    (status = 404, description = "There is no such.", body = Problem, content_type = "application/problem+json"),
    (status = 409, description = "Its author reopens only what is done or won't be.", body = Problem, content_type = "application/problem+json"),
    (status = 422, description = "The change does not read or breaks a limit.", body = Problem, content_type = "application/problem+json"),
    (status = 507, description = "The database holds as much as it may.", body = Problem, content_type = "application/problem+json"),
))]
async fn update(
    State(app): State<App>,
    caller: Caller,
    Params(id): Params<String>,
    Body(change): Body<StatusUpdate>,
) -> Result<Json<Annotation>, ApiError> {
    change
        .check()
        .map_err(|invalid| ApiError::invalid(invalid.to_string()))?;
    if caller.admin {
        let changed = app
            .store
            .update(&id, &change)
            .await?
            .ok_or_else(ApiError::not_found)?;
        tracing::info!(id = %changed.id, status = %changed.status, "an annotation changed");
        return Ok(Json(changed));
    }
    let annotation = app.store.get(&id).await?.ok_or_else(ApiError::not_found)?;
    if annotation.author != caller.name || change != StatusUpdate::reopen() {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "only an admin changes an annotation; its author only reopens it",
        ));
    }
    let reopened = app.store.reopen(&id, &caller.name).await?.ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "only an annotation that is done or won't be reopens",
        )
    })?;
    tracing::info!(id = %reopened.id, "an annotation reopened");
    Ok(Json(reopened))
}

/// Removes an annotation, which only its author does, while it is open.
#[utoipa::path(delete, path = "/api/v1/annotations/{id}", params(("id" = String, Path, description = "Its ID.")), responses(
    (status = 204, description = "It is removed."),
    (status = 403, description = "The caller may not, or another site's page asks for it.", body = Problem, content_type = "application/problem+json"),
    (status = 404, description = "There is no such.", body = Problem, content_type = "application/problem+json"),
))]
async fn remove(
    State(app): State<App>,
    caller: Caller,
    Params(id): Params<String>,
) -> Result<StatusCode, ApiError> {
    if app.store.delete_open(&id, &caller.name).await? {
        return Ok(StatusCode::NO_CONTENT);
    }
    match app.store.get(&id).await? {
        Some(_) => Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "only its author removes an annotation, while it is open",
        )),
        None => Err(ApiError::not_found()),
    }
}

/// One of an annotation's parts: `crop.png`, around its target, `frame.png`, the whole window, `context.json`, what
/// the app attached, or `console.json`, the console's entries.
#[utoipa::path(get, path = "/api/v1/annotations/{id}/{part}", params(
    ("id" = String, Path, description = "Its ID."),
    ("part" = String, Path, description = "`crop.png`, `frame.png`, `context.json` or `console.json`."),
), responses(
    (status = 200, description = "The picture in PNG, or the context or console in JSON.", content((Vec<u8> = "image/png"), (serde_json::Value = "application/json"))),
    (status = 404, description = "There is no such annotation or part.", body = Problem, content_type = "application/problem+json"),
))]
async fn part(
    State(app): State<App>,
    _caller: Caller,
    Params((id, part)): Params<(String, String)>,
) -> Result<Response, ApiError> {
    let missing = || ApiError::new(StatusCode::NOT_FOUND, "there is no such part");
    let (bytes, kind) = match part.as_str() {
        "crop.png" => (app.store.picture(&id, Picture::Crop).await?, "image/png"),
        "frame.png" => (app.store.picture(&id, Picture::Frame).await?, "image/png"),
        "context.json" => (
            app.store
                .attachment(&id, Attachment::Context)
                .await?
                .map(String::into_bytes),
            "application/json",
        ),
        "console.json" => (
            app.store
                .attachment(&id, Attachment::Console)
                .await?
                .map(String::into_bytes),
            "application/json",
        ),
        _ => return Err(missing()),
    };
    let bytes = bytes.ok_or_else(missing)?;
    Ok(([(CONTENT_TYPE, kind)], bytes).into_response())
}
