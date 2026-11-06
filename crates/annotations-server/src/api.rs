//! The annotation service's HTTP API (EMIT ADR-0025): `/api/v1/annotations` in JSON, every error as problem details
//! of RFC 9457, and `/health/live` and `/health/ready` for Compose. Who calls comes from a header that the reverse
//! proxy sets after its basic auth (ADR-0001); the service refuses to start without one unless it is told it runs
//! open, as in the local stack, where every caller is `local` and may do all. An instance keeps the annotations of
//! any app, or of those its settings name.

use std::sync::Arc;

use annotations::{Annotation, MAX_PNG_BYTES, NewAnnotation, Status, StatusUpdate, is_app_name};
use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::extract::{DefaultBodyLimit, FromRequest, FromRequestParts, Path, Query, Request, State};
use axum::http::header::{
    CACHE_CONTROL, CONTENT_SECURITY_POLICY, CONTENT_TYPE, X_CONTENT_TYPE_OPTIONS,
};
use axum::http::request::Parts;
use axum::http::{HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use utoipa::OpenApi;

use crate::store::{Filter, Picture, Store, StoreError};

/// The most bytes a request has: two pictures of [`MAX_PNG_BYTES`] each in Base64, and 1 MB for the rest.
const BODY_LIMIT: usize = 2 * MAX_PNG_BYTES.div_ceil(3) * 4 + 1_000_000;
/// The most pixels a picture has on either side.
const MAX_PICTURE_SIDE: u32 = 16_384;
/// The most bytes the check of a picture's header holds in memory, far below the service's limit.
const PNG_CHECK_BYTES: usize = 1 << 20;

/// Who may do what.
#[derive(Debug, Clone, Default)]
pub struct Access {
    /// The header that names the caller, set by the reverse proxy; none where every caller is `local`.
    pub user_header: Option<HeaderName>,
    /// The callers who change statuses and answers, such as `claude`.
    pub admins: Vec<String>,
    /// The apps whose annotations the service keeps; any where none is named.
    pub apps: Vec<String>,
}

impl Access {
    /// Who may do what, from the service's settings by name: the caller's header from `ANNOTATIONS_USER_HEADER`,
    /// the admins from `ANNOTATIONS_ADMINS` and the apps kept from `ANNOTATIONS_APPS`, both separated by commas.
    /// Without a header the service runs open only where `ANNOTATIONS_OPEN` is `local`, so a slip of its settings
    /// opens nothing.
    ///
    /// # Errors
    ///
    /// Where the header is no header's name, an app is no app's name, or neither the header nor
    /// `ANNOTATIONS_OPEN=local` is set.
    pub fn from_settings(setting: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let setting = |name: &str| {
            setting(name)
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        };
        let user_header = setting("ANNOTATIONS_USER_HEADER")
            .map(|name| {
                HeaderName::try_from(name)
                    .map_err(|_| "ANNOTATIONS_USER_HEADER is no header name".to_owned())
            })
            .transpose()?;
        if user_header.is_none() && setting("ANNOTATIONS_OPEN").as_deref() != Some("local") {
            return Err(
                "set ANNOTATIONS_USER_HEADER behind an auth proxy, or ANNOTATIONS_OPEN=local in the local stack only"
                    .to_owned(),
            );
        }
        let list = |name: &str| -> Vec<String> {
            setting(name)
                .unwrap_or_default()
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(str::to_owned)
                .collect()
        };
        let apps = list("ANNOTATIONS_APPS");
        if let Some(app) = apps.iter().find(|app| !is_app_name(app)) {
            return Err(format!(
                "ANNOTATIONS_APPS names {app}, which is no app's name"
            ));
        }
        Ok(Self {
            user_header,
            admins: list("ANNOTATIONS_ADMINS"),
            apps,
        })
    }

    /// Whether the service keeps the annotations of `app`.
    fn keeps(&self, app: &str) -> bool {
        self.apps.is_empty() || self.apps.iter().any(|kept| kept == app)
    }
}

#[derive(Clone)]
struct App {
    store: Store,
    access: Arc<Access>,
}

/// The service's routes over `store`, with `access`.
pub fn router(store: Store, access: Access) -> Router {
    let app = App {
        store,
        access: Arc::new(access),
    };
    Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .route("/api/v1/annotations", get(list).post(create))
        .route(
            "/api/v1/annotations/{id}",
            get(one).patch(update).delete(remove),
        )
        .route("/api/v1/annotations/{id}/{picture}", get(picture))
        .fallback(|| async { ApiError::new(StatusCode::NOT_FOUND, "there is no such resource") })
        .method_not_allowed_fallback(|| async {
            ApiError::new(
                StatusCode::METHOD_NOT_ALLOWED,
                "the resource does not take this method",
            )
        })
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(middleware::from_fn(same_origin_changes))
        .layer(middleware::from_fn(guard_headers))
        .with_state(app)
}

/// A request that changes something comes from the app's own pages or from a client that is no browser, such as `make
/// annotation-status`: a browser marks a request another site makes with `Sec-Fetch-Site`, and as it sends the basic
/// auth along by itself, the service refuses such a change rather than trust the proxy's login alone.
async fn same_origin_changes(request: Request, next: Next) -> Response {
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
async fn guard_headers(request: Request, next: Next) -> Response {
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

/// The API's OpenAPI document, which `openapi.json` holds as committed.
#[derive(OpenApi)]
#[openapi(
    info(
        title = "annotate",
        version = "1",
        description = "The annotations of an app's testers and Claude's answers (ADR-0001).",
        license(name = "Proprietary, all rights reserved")
    ),
    paths(list, create, one, update, remove, picture, live, ready),
    components(schemas(Problem))
)]
pub struct ApiDoc;

/// A problem as RFC 9457 describes it.
#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct Problem {
    /// Always `about:blank`: the status tells the kind.
    #[serde(rename = "type")]
    pub kind: String,
    /// The status in words.
    pub title: String,
    /// The HTTP status.
    pub status: u16,
    /// What went wrong here.
    pub detail: String,
}

/// An error the API answers with as a problem.
#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    detail: String,
}

impl ApiError {
    fn new(status: StatusCode, detail: impl Into<String>) -> Self {
        Self {
            status,
            detail: detail.into(),
        }
    }

    fn not_found() -> Self {
        Self::new(StatusCode::NOT_FOUND, "there is no such annotation")
    }

    fn invalid(detail: impl Into<String>) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, detail)
    }
}

impl From<StoreError> for ApiError {
    fn from(error: StoreError) -> Self {
        tracing::error!(%error, "the store failed");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "the annotations could not be read or written",
        )
    }
}

impl From<JsonRejection> for ApiError {
    fn from(rejection: JsonRejection) -> Self {
        Self::new(rejection.status(), rejection.body_text())
    }
}

impl From<QueryRejection> for ApiError {
    fn from(rejection: QueryRejection) -> Self {
        Self::new(rejection.status(), rejection.body_text())
    }
}

impl From<PathRejection> for ApiError {
    fn from(rejection: PathRejection) -> Self {
        Self::new(rejection.status(), rejection.body_text())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let problem = Problem {
            kind: "about:blank".to_owned(),
            title: self.status.canonical_reason().unwrap_or("Error").to_owned(),
            status: self.status.as_u16(),
            detail: self.detail,
        };
        (
            self.status,
            [(CONTENT_TYPE, "application/problem+json")],
            Json(problem),
        )
            .into_response()
    }
}

/// A JSON body, refused as a problem where it does not read.
struct Body<T>(T);

impl<T: DeserializeOwned, S: Send + Sync> FromRequest<S> for Body<T> {
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        let Json(value) = Json::<T>::from_request(request, state).await?;
        Ok(Self(value))
    }
}

/// A query, refused as a problem where it does not read.
struct Filters<T>(T);

impl<T: DeserializeOwned, S: Send + Sync> FromRequestParts<S> for Filters<T> {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Query(value) = Query::<T>::from_request_parts(parts, state).await?;
        Ok(Self(value))
    }
}

/// Path parameters, refused as a problem where they do not read.
struct Params<T>(T);

impl<T: DeserializeOwned + Send, S: Send + Sync> FromRequestParts<S> for Params<T> {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Path(value) = Path::<T>::from_request_parts(parts, state).await?;
        Ok(Self(value))
    }
}

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
                name: "local".to_owned(),
                admin: true,
            });
        };
        let name = parts
            .headers
            .get(header)
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
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
    (status = 400, description = "The query does not read.", body = Problem, content_type = "application/problem+json"),
    (status = 401, description = "No user is named.", body = Problem, content_type = "application/problem+json"),
))]
async fn list(
    State(app): State<App>,
    _caller: Caller,
    Filters(query): Filters<ListQuery>,
) -> Result<Json<Vec<Annotation>>, ApiError> {
    let filter = Filter {
        status: query.status,
        app: query.app,
        path: query.path,
        version: query.version,
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

/// Whether `bytes` begin as a PNG with sides of at most [`MAX_PICTURE_SIDE`] pixels. Only its header is read, within
/// [`PNG_CHECK_BYTES`], past its colour profile and texts, so no picture can make the check take the service's memory.
fn check_png(bytes: &[u8]) -> Result<(), &'static str> {
    let mut decoder = png::Decoder::new_with_limits(
        std::io::Cursor::new(bytes),
        png::Limits {
            bytes: PNG_CHECK_BYTES,
        },
    );
    decoder.set_ignore_iccp_chunk(true);
    decoder.set_ignore_text_chunk(true);
    let reader = decoder.read_info().map_err(|_| "is no PNG")?;
    let info = reader.info();
    if info.width > MAX_PICTURE_SIDE || info.height > MAX_PICTURE_SIDE {
        return Err("is larger than 16384 pixels on a side");
    }
    Ok(())
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
/// is done or won't be, which clears its commit.
#[utoipa::path(patch, path = "/api/v1/annotations/{id}", params(("id" = String, Path, description = "Its ID.")),
    request_body = StatusUpdate, responses(
    (status = 200, description = "It is changed.", body = Annotation),
    (status = 403, description = "The caller may not, or another site's page asks for it.", body = Problem, content_type = "application/problem+json"),
    (status = 404, description = "There is no such.", body = Problem, content_type = "application/problem+json"),
    (status = 409, description = "Its author reopens only what is done or won't be.", body = Problem, content_type = "application/problem+json"),
    (status = 422, description = "The change does not read or breaks a limit.", body = Problem, content_type = "application/problem+json"),
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

/// One of an annotation's pictures: `crop.png`, around its target, or `frame.png`, the whole window.
#[utoipa::path(get, path = "/api/v1/annotations/{id}/{picture}", params(
    ("id" = String, Path, description = "Its ID."),
    ("picture" = String, Path, description = "`crop.png` or `frame.png`."),
), responses(
    (status = 200, description = "The picture.", content_type = "image/png", body = Vec<u8>),
    (status = 404, description = "There is no such annotation or picture.", body = Problem, content_type = "application/problem+json"),
))]
async fn picture(
    State(app): State<App>,
    _caller: Caller,
    Params((id, picture)): Params<(String, String)>,
) -> Result<Response, ApiError> {
    let which = match picture.as_str() {
        "crop.png" => Picture::Crop,
        "frame.png" => Picture::Frame,
        _ => {
            return Err(ApiError::new(
                StatusCode::NOT_FOUND,
                "there is no such picture",
            ));
        }
    };
    let bytes = app
        .store
        .picture(&id, which)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "there is no such picture"))?;
    Ok(([(CONTENT_TYPE, "image/png")], bytes).into_response())
}
