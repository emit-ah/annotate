//! How the API answers what it refuses: problem details of RFC 9457 (EMIT ADR-0025), also where a body, a query or a
//! path does not read.

use axum::Json;
use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::extract::{FromRequest, FromRequestParts, Path, Query, Request};
use axum::http::StatusCode;
use axum::http::header::CONTENT_TYPE;
use axum::http::request::Parts;
use axum::response::{IntoResponse, Response};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::store::{KEEP_RESOLVED_DAYS, StoreError};

/// The media type of a problem.
const PROBLEM_JSON: &str = "application/problem+json";

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
pub(crate) struct ApiError {
    status: StatusCode,
    detail: String,
}

impl ApiError {
    pub(crate) fn new(status: StatusCode, detail: impl Into<String>) -> Self {
        Self {
            status,
            detail: detail.into(),
        }
    }

    pub(crate) fn not_found() -> Self {
        Self::new(StatusCode::NOT_FOUND, "there is no such annotation")
    }

    pub(crate) fn invalid(detail: impl Into<String>) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, detail)
    }
}

impl From<StoreError> for ApiError {
    fn from(error: StoreError) -> Self {
        if matches!(error, StoreError::Full) {
            tracing::warn!("the database is full");
            return Self::new(
                StatusCode::INSUFFICIENT_STORAGE,
                format!(
                    "the annotation service is full; annotations done go after {KEEP_RESOLVED_DAYS} days"
                ),
            );
        }
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
        (self.status, [(CONTENT_TYPE, PROBLEM_JSON)], Json(problem)).into_response()
    }
}

/// A JSON body, refused as a problem where it does not read.
pub(crate) struct Body<T>(pub(crate) T);

impl<T: DeserializeOwned, S: Send + Sync> FromRequest<S> for Body<T> {
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        let Json(value) = Json::<T>::from_request(request, state).await?;
        Ok(Self(value))
    }
}

/// A query, refused as a problem where it does not read.
pub(crate) struct Filters<T>(pub(crate) T);

impl<T: DeserializeOwned, S: Send + Sync> FromRequestParts<S> for Filters<T> {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Query(value) = Query::<T>::from_request_parts(parts, state).await?;
        Ok(Self(value))
    }
}

/// Path parameters, refused as a problem where they do not read.
pub(crate) struct Params<T>(pub(crate) T);

impl<T: DeserializeOwned + Send, S: Send + Sync> FromRequestParts<S> for Params<T> {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Path(value) = Path::<T>::from_request_parts(parts, state).await?;
        Ok(Self(value))
    }
}
