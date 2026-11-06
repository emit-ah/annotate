//! The annotation service's API (ADR-0001) through its router, on a database in memory: what it keeps and gives
//! back, who may do what, and how it answers what it refuses.
#![expect(
    clippy::expect_used,
    reason = "a helper fails its test where the test's own setup fails, such as a request that does not build"
)]

use annotations_server::api::{Access, router};
use annotations_server::store::Store;
use axum::Router;
use axum::body::Body;
use axum::http::{HeaderName, Method, Request, StatusCode};
use http_body_util::BodyExt as _;
use serde_json::{Value, json};
use tower::ServiceExt as _;

const USER: &str = "x-auth-user";

/// A PNG of `width` by `height` grey pixels.
fn png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Grayscale);
        encoder.set_depth(png::BitDepth::Eight);
        let pixels = vec![128; (width * height) as usize];
        if let Ok(mut writer) = encoder.write_header() {
            let _ = writer.write_image_data(&pixels);
        }
    }
    bytes
}

fn base64(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// An annotation of the Repeat button, as the app sends it, with a crop.
fn repeat_button() -> Value {
    json!({
        "app": "tutti",
        "comment": "Its shortcut is hard to read.",
        "path": "/practice/ode-to-joy",
        "version": "47d97f7",
        "viewport": {"width": 1440, "height": 900, "pixel_ratio": 2.0},
        "browser": "Chrome 141",
        "target": {
            "kind": "element",
            "role": "button",
            "name": "Repeat",
            "tag": "button",
            "text_ids": ["practice-repeat"],
            "text": "Repeat R",
            "components": ["Session"],
            "dom_path": "main > button:nth-child(4)",
            "rect": {"x": 636.0, "y": 233.0, "width": 126.0, "height": 38.0}
        },
        "state": [{"name": "measure", "value": "1"}],
        "crop": base64(&png(4, 2))
    })
}

/// A service behind a proxy that names its callers, with `claude` as its admin.
async fn behind_proxy() -> Router {
    let store = Store::in_memory().await.expect("a store in memory");
    router(
        store,
        Access {
            user_header: Some(HeaderName::from_static(USER)),
            admins: vec!["claude".to_owned()],
            apps: Vec::new(),
        },
    )
}

/// Sends `method` to `uri` as `user`, with `body` as JSON; the status and the body, as JSON where it is.
async fn call(
    app: &Router,
    method: Method,
    uri: &str,
    user: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value, String) {
    let mut request = Request::builder().method(method).uri(uri);
    if let Some(user) = user {
        request = request.header(USER, user);
    }
    let request = match body {
        Some(body) => request
            .header("content-type", "application/json")
            .body(Body::from(body.to_string())),
        None => request.body(Body::empty()),
    }
    .expect("a request");
    let response = app.clone().oneshot(request).await.expect("an answer");
    let status = response.status();
    let kind = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("a body")
        .to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        kind,
    )
}

#[tokio::test]
async fn an_annotation_is_kept_open_by_its_author_and_found_by_its_app_page_and_version() {
    let app = behind_proxy().await;
    let (status, kept, _) = call(
        &app,
        Method::POST,
        "/api/v1/annotations",
        Some("andreas"),
        Some(repeat_button()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(kept["author"], json!("andreas"));
    assert_eq!(kept["status"], json!("open"));
    assert_eq!(kept["has_crop"], json!(true));
    assert_eq!(kept["has_frame"], json!(false));
    assert_eq!(kept["target"]["text_ids"], json!(["practice-repeat"]));
    assert!(
        kept["created"]
            .as_str()
            .is_some_and(|time| time.ends_with('Z'))
    );
    let id = kept["id"].as_str().expect("an id").to_owned();

    let (_, one, _) = call(
        &app,
        Method::GET,
        &format!("/api/v1/annotations/{id}"),
        Some("ben"),
        None,
    )
    .await;
    assert_eq!(one, kept);
    let (_, by_page, _) = call(
        &app,
        Method::GET,
        "/api/v1/annotations?app=tutti&path=/practice/ode-to-joy&status=open",
        Some("ben"),
        None,
    )
    .await;
    assert_eq!(by_page, json!([kept]));
    for other in ["version=0000000", "app=mappa"] {
        let (_, none, _) = call(
            &app,
            Method::GET,
            &format!("/api/v1/annotations?{other}"),
            Some("ben"),
            None,
        )
        .await;
        assert_eq!(none, json!([]), "{other}");
    }
}

#[tokio::test]
async fn one_service_keeps_the_annotations_of_several_apps_apart() {
    let app = behind_proxy().await;
    let mut of_mappa = repeat_button();
    of_mappa["app"] = json!("mappa");
    for body in [repeat_button(), of_mappa] {
        let (status, _, _) = call(
            &app,
            Method::POST,
            "/api/v1/annotations",
            Some("andreas"),
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
    }
    for name in ["tutti", "mappa"] {
        let (_, list, _) = call(
            &app,
            Method::GET,
            &format!("/api/v1/annotations?app={name}"),
            Some("andreas"),
            None,
        )
        .await;
        let apps: Vec<&Value> = list
            .as_array()
            .expect("a list")
            .iter()
            .map(|annotation| &annotation["app"])
            .collect();
        assert_eq!(apps, [&json!(name)], "{name}");
    }
}

#[tokio::test]
async fn a_service_named_for_some_apps_refuses_the_annotations_of_others() {
    let app = router(
        Store::in_memory().await.expect("a store in memory"),
        Access {
            apps: vec!["mappa".to_owned()],
            ..Access::default()
        },
    );
    let (status, problem, _) = call(
        &app,
        Method::POST,
        "/api/v1/annotations",
        None,
        Some(repeat_button()),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        problem["detail"],
        json!("app tutti is not kept by this service")
    );
    let mut of_mappa = repeat_button();
    of_mappa["app"] = json!("mappa");
    let (status, _, _) = call(
        &app,
        Method::POST,
        "/api/v1/annotations",
        None,
        Some(of_mappa),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn its_pictures_come_back_as_png_and_one_it_lacks_is_not_found() {
    let app = behind_proxy().await;
    let (_, kept, _) = call(
        &app,
        Method::POST,
        "/api/v1/annotations",
        Some("andreas"),
        Some(repeat_button()),
    )
    .await;
    let id = kept["id"].as_str().expect("an id");
    let request = Request::get(format!("/api/v1/annotations/{id}/crop.png"))
        .header(USER, "andreas")
        .body(Body::empty())
        .expect("a request");
    let response = app.clone().oneshot(request).await.expect("an answer");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "image/png");
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("a body")
        .to_bytes();
    assert_eq!(bytes.as_ref(), png(4, 2).as_slice());
    let (status, _, kind) = call(
        &app,
        Method::GET,
        &format!("/api/v1/annotations/{id}/frame.png"),
        Some("andreas"),
        None,
    )
    .await;
    assert_eq!(
        (status, kind.as_str()),
        (StatusCode::NOT_FOUND, "application/problem+json")
    );
}

#[tokio::test]
async fn only_the_admin_sets_a_status_and_its_answer() {
    let app = behind_proxy().await;
    let (_, kept, _) = call(
        &app,
        Method::POST,
        "/api/v1/annotations",
        Some("andreas"),
        Some(repeat_button()),
    )
    .await;
    let uri = format!(
        "/api/v1/annotations/{}",
        kept["id"].as_str().expect("an id")
    );
    let done = json!({"status": "done", "answer": "The chip reads at 4.6:1 now.", "resolved_in": "5c1e9a2"});
    let (status, problem, kind) = call(
        &app,
        Method::PATCH,
        &uri,
        Some("andreas"),
        Some(done.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(kind, "application/problem+json");
    assert_eq!(problem["status"], json!(403));
    let (status, changed, _) = call(&app, Method::PATCH, &uri, Some("claude"), Some(done)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(changed["status"], json!("done"));
    assert_eq!(changed["answer"], json!("The chip reads at 4.6:1 now."));
    assert_eq!(changed["resolved_in"], json!("5c1e9a2"));
    // What a change leaves out stays.
    let (_, again, _) = call(
        &app,
        Method::PATCH,
        &uri,
        Some("claude"),
        Some(json!({"status": "in_progress"})),
    )
    .await;
    assert_eq!(again["answer"], json!("The chip reads at 4.6:1 now."));
    let (status, _, _) = call(
        &app,
        Method::PATCH,
        "/api/v1/annotations/none",
        Some("claude"),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn its_author_removes_an_open_annotation_and_no_one_else() {
    let app = behind_proxy().await;
    let (_, kept, _) = call(
        &app,
        Method::POST,
        "/api/v1/annotations",
        Some("andreas"),
        Some(repeat_button()),
    )
    .await;
    let uri = format!(
        "/api/v1/annotations/{}",
        kept["id"].as_str().expect("an id")
    );
    for other in ["ben", "claude"] {
        let (status, _, _) = call(&app, Method::DELETE, &uri, Some(other), None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{other}");
    }
    let (status, _, _) = call(&app, Method::DELETE, &uri, Some("andreas"), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _, _) = call(&app, Method::DELETE, &uri, Some("andreas"), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Once taken up, it stays.
    let (_, kept, _) = call(
        &app,
        Method::POST,
        "/api/v1/annotations",
        Some("andreas"),
        Some(repeat_button()),
    )
    .await;
    let uri = format!(
        "/api/v1/annotations/{}",
        kept["id"].as_str().expect("an id")
    );
    call(
        &app,
        Method::PATCH,
        &uri,
        Some("claude"),
        Some(json!({"status": "in_progress"})),
    )
    .await;
    let (status, _, _) = call(&app, Method::DELETE, &uri, Some("andreas"), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn its_author_reopens_it_once_done_which_clears_its_commit_and_changes_nothing_else() {
    let app = behind_proxy().await;
    let (_, kept, _) = call(
        &app,
        Method::POST,
        "/api/v1/annotations",
        Some("andreas"),
        Some(repeat_button()),
    )
    .await;
    let uri = format!(
        "/api/v1/annotations/{}",
        kept["id"].as_str().expect("an id")
    );
    let reopen = json!({"status": "open"});
    let (status, _, _) = call(
        &app,
        Method::PATCH,
        &uri,
        Some("andreas"),
        Some(reopen.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    call(
        &app,
        Method::PATCH,
        &uri,
        Some("claude"),
        Some(json!({"status": "done", "answer": "Done.", "resolved_in": "5c1e9a2"})),
    )
    .await;
    let (status, _, _) = call(&app, Method::PATCH, &uri, Some("ben"), Some(reopen.clone())).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _, _) = call(
        &app,
        Method::PATCH,
        &uri,
        Some("andreas"),
        Some(json!({"status": "done"})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, reopened, _) =
        call(&app, Method::PATCH, &uri, Some("andreas"), Some(reopen)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(reopened["status"], json!("open"));
    assert!(reopened.get("resolved_in").is_none());
    assert_eq!(reopened["answer"], json!("Done."));
    // An admin clears an answer with an empty one.
    let (_, cleared, _) = call(
        &app,
        Method::PATCH,
        &uri,
        Some("claude"),
        Some(json!({"answer": ""})),
    )
    .await;
    assert!(cleared.get("answer").is_none());
    let (status, problem, _) = call(
        &app,
        Method::PATCH,
        &uri,
        Some("claude"),
        Some(json!({"resolved_in": "the fix"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        problem["detail"],
        json!("resolved_in is no commit of 7 to 40 hexadecimal digits")
    );
}

#[tokio::test]
async fn behind_the_proxy_a_request_without_a_user_is_refused() {
    let app = behind_proxy().await;
    let (status, problem, kind) = call(&app, Method::GET, "/api/v1/annotations", None, None).await;
    assert_eq!(
        (status, kind.as_str()),
        (StatusCode::UNAUTHORIZED, "application/problem+json")
    );
    assert_eq!(problem["detail"], json!("the request names no user"));
    let (status, _, _) = call(&app, Method::GET, "/api/v1/annotations", Some(" "), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn an_annotation_that_breaks_a_limit_or_brings_no_png_is_refused_with_its_reason() {
    let app = behind_proxy().await;
    let mut empty = repeat_button();
    empty["comment"] = json!(" ");
    let (status, problem, kind) = call(
        &app,
        Method::POST,
        "/api/v1/annotations",
        Some("andreas"),
        Some(empty),
    )
    .await;
    assert_eq!(
        (status, kind.as_str()),
        (StatusCode::UNPROCESSABLE_ENTITY, "application/problem+json")
    );
    assert_eq!(problem["detail"], json!("comment is empty"));

    let mut not_png = repeat_button();
    not_png["crop"] = json!(base64(b"GIF89a"));
    let (status, problem, _) = call(
        &app,
        Method::POST,
        "/api/v1/annotations",
        Some("andreas"),
        Some(not_png),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(problem["detail"], json!("crop is no PNG"));

    let mut huge = repeat_button();
    huge["frame"] = json!(base64(&png(16_385, 1)));
    let (status, problem, _) = call(
        &app,
        Method::POST,
        "/api/v1/annotations",
        Some("andreas"),
        Some(huge),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        problem["detail"],
        json!("frame is larger than 16384 pixels on a side")
    );
    let (_, none, _) = call(
        &app,
        Method::GET,
        "/api/v1/annotations",
        Some("andreas"),
        None,
    )
    .await;
    assert_eq!(none, json!([]));
}

#[tokio::test]
async fn without_a_proxy_every_caller_is_local_and_may_do_all() {
    let app = router(
        Store::in_memory().await.expect("a store in memory"),
        Access::default(),
    );
    let (_, kept, _) = call(
        &app,
        Method::POST,
        "/api/v1/annotations",
        None,
        Some(repeat_button()),
    )
    .await;
    assert_eq!(kept["author"], json!("local"));
    let uri = format!(
        "/api/v1/annotations/{}",
        kept["id"].as_str().expect("an id")
    );
    let (status, _, _) = call(
        &app,
        Method::PATCH,
        &uri,
        None,
        Some(json!({"status": "done"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn whatever_it_refuses_comes_as_a_problem_and_no_answer_is_sniffed_or_run() {
    let app = behind_proxy().await;
    let mut no_target = repeat_button();
    no_target
        .as_object_mut()
        .expect("an object")
        .remove("target");
    let refused = [
        (
            Method::POST,
            "/api/v1/annotations",
            Some(no_target),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            Method::GET,
            "/api/v1/annotations?status=closed",
            None,
            StatusCode::BAD_REQUEST,
        ),
        (
            Method::GET,
            "/api/v2/annotations",
            None,
            StatusCode::NOT_FOUND,
        ),
        (
            Method::PUT,
            "/api/v1/annotations",
            None,
            StatusCode::METHOD_NOT_ALLOWED,
        ),
    ];
    for (method, uri, body, expected) in refused {
        let (status, problem, kind) = call(&app, method, uri, Some("andreas"), body).await;
        assert_eq!(
            (status, kind.as_str()),
            (expected, "application/problem+json"),
            "{uri}"
        );
        assert_eq!(problem["status"], json!(expected.as_u16()), "{uri}");
    }
    let request = Request::get("/api/v1/annotations")
        .header(USER, "andreas")
        .body(Body::empty())
        .expect("a request");
    let response = app.clone().oneshot(request).await.expect("an answer");
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    assert_eq!(
        response.headers()["cross-origin-resource-policy"],
        "same-origin"
    );
    assert!(
        response.headers()["content-security-policy"]
            .to_str()
            .is_ok_and(|policy| policy.contains("sandbox"))
    );
}

#[tokio::test]
async fn a_change_another_site_s_page_asks_for_is_refused_and_one_of_the_app_s_own_pages_or_a_client_is_kept()
 {
    let app = behind_proxy().await;
    let create = |site: Option<&str>| {
        let mut request = Request::post("/api/v1/annotations")
            .header(USER, "andreas")
            .header("content-type", "application/json");
        if let Some(site) = site {
            request = request.header("sec-fetch-site", site);
        }
        request
            .body(Body::from(repeat_button().to_string()))
            .expect("a request")
    };
    for site in ["cross-site", "same-site"] {
        let response = app
            .clone()
            .oneshot(create(Some(site)))
            .await
            .expect("an answer");
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{site}");
    }
    for site in [Some("same-origin"), Some("none"), None] {
        let response = app.clone().oneshot(create(site)).await.expect("an answer");
        assert_eq!(response.status(), StatusCode::CREATED, "{site:?}");
    }
    // Reading stays open to the app's pages and clients, whatever the browser says of the page.
    let request = Request::get("/api/v1/annotations")
        .header(USER, "andreas")
        .header("sec-fetch-site", "cross-site")
        .body(Body::empty())
        .expect("a request");
    let response = app.clone().oneshot(request).await.expect("an answer");
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn the_service_tells_compose_that_it_runs_and_is_ready() {
    let app = behind_proxy().await;
    for uri in ["/health/live", "/health/ready"] {
        let request = Request::get(uri).body(Body::empty()).expect("a request");
        let response = app.clone().oneshot(request).await.expect("an answer");
        assert_eq!(response.status(), StatusCode::OK, "{uri}");
    }
}

#[test]
fn the_service_runs_open_only_where_its_settings_say_local_and_names_its_admins() {
    let settings = |pairs: &'static [(&'static str, &'static str)]| {
        move |name: &str| {
            pairs
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).to_owned())
        }
    };
    assert!(Access::from_settings(settings(&[])).is_err());
    assert!(Access::from_settings(settings(&[("ANNOTATIONS_OPEN", "yes")])).is_err());
    let open = Access::from_settings(settings(&[("ANNOTATIONS_OPEN", "local")]))
        .expect("open where local");
    assert!(open.user_header.is_none());
    let proxied = Access::from_settings(settings(&[
        ("ANNOTATIONS_USER_HEADER", "X-Auth-User"),
        ("ANNOTATIONS_ADMINS", " claude, ,ben"),
    ]))
    .expect("behind a proxy");
    assert_eq!(
        proxied.user_header,
        Some(HeaderName::from_static("x-auth-user"))
    );
    assert_eq!(proxied.admins, ["claude", "ben"]);
    assert!(proxied.apps.is_empty());
    assert!(Access::from_settings(settings(&[("ANNOTATIONS_USER_HEADER", "no header")])).is_err());
    let named = Access::from_settings(settings(&[
        ("ANNOTATIONS_OPEN", "local"),
        ("ANNOTATIONS_APPS", "mappa, tutti"),
    ]))
    .expect("open with apps");
    assert_eq!(named.apps, ["mappa", "tutti"]);
    assert!(
        Access::from_settings(settings(&[
            ("ANNOTATIONS_OPEN", "local"),
            ("ANNOTATIONS_APPS", "Mappa"),
        ]))
        .is_err()
    );
}

/// The body of `uri`'s answer as `user`, with its status and content type, as bytes.
async fn fetch_part(app: &Router, uri: &str) -> (StatusCode, String, Vec<u8>) {
    let request = Request::get(uri)
        .header(USER, "andreas")
        .body(Body::empty())
        .expect("a request");
    let response = app.clone().oneshot(request).await.expect("an answer");
    let status = response.status();
    let kind = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("a body")
        .to_bytes();
    (status, kind, bytes.to_vec())
}

#[tokio::test]
async fn the_app_s_context_and_the_console_are_kept_and_served_as_json_on_their_own() {
    let app = behind_proxy().await;
    let mut body = repeat_button();
    body["context"] = json!({"turns": [{"tool": "propose_changes", "ms": 412}]});
    body["console"] = json!([
        {"kind": "error", "time": "2026-11-06T10:00:00.000Z", "message": "TypeError: x", "stack": "at a (b.js:1:2)"},
        {"kind": "network", "time": "2026-11-06T10:00:01.000Z", "message": "GET /x 500", "method": "GET", "url": "/x", "status": 500}
    ]);
    let (status, kept, _) = call(
        &app,
        Method::POST,
        "/api/v1/annotations",
        Some("andreas"),
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(kept["has_context"], json!(true));
    assert_eq!(kept["has_console"], json!(true));
    assert!(kept.get("context").is_none(), "a list stays small");
    let id = kept["id"].as_str().expect("an id");
    let (status, kind, bytes) =
        fetch_part(&app, &format!("/api/v1/annotations/{id}/context.json")).await;
    assert_eq!(
        (status, kind.as_str()),
        (StatusCode::OK, "application/json")
    );
    let context: Value = serde_json::from_slice(&bytes).expect("JSON");
    assert_eq!(context["turns"][0]["ms"], json!(412));
    let (_, _, bytes) = fetch_part(&app, &format!("/api/v1/annotations/{id}/console.json")).await;
    let console: Value = serde_json::from_slice(&bytes).expect("JSON");
    assert_eq!(console[1]["status"], json!(500));

    let (_, plain, _) = call(
        &app,
        Method::POST,
        "/api/v1/annotations",
        Some("andreas"),
        Some(repeat_button()),
    )
    .await;
    assert_eq!(plain["has_context"], json!(false));
    let id = plain["id"].as_str().expect("an id");
    for part in ["context.json", "console.json", "other.txt"] {
        let (status, kind, _) = fetch_part(&app, &format!("/api/v1/annotations/{id}/{part}")).await;
        assert_eq!(
            (status, kind.as_str()),
            (StatusCode::NOT_FOUND, "application/problem+json"),
            "{part}"
        );
    }
}

#[tokio::test]
async fn a_context_larger_than_its_limit_is_refused() {
    let app = behind_proxy().await;
    let mut body = repeat_button();
    body["context"] = json!({ "trace": "x".repeat(annotations::MAX_CONTEXT_BYTES) });
    let (status, problem, _) = call(
        &app,
        Method::POST,
        "/api/v1/annotations",
        Some("andreas"),
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        problem["detail"],
        json!("context has more than 262144 bytes as JSON")
    );
}

#[tokio::test]
async fn a_full_database_says_so_and_keeps_what_it_has() {
    // A few pages hold the schema and one small annotation, but no context of 100 KB.
    let app = router(
        Store::in_memory_of(12).await.expect("a small store"),
        Access::default(),
    );
    let (status, _, _) = call(
        &app,
        Method::POST,
        "/api/v1/annotations",
        None,
        Some(repeat_button()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let mut big = repeat_button();
    big["context"] = json!({ "trace": "x".repeat(100_000) });
    let (status, problem, kind) =
        call(&app, Method::POST, "/api/v1/annotations", None, Some(big)).await;
    assert_eq!(
        (status, kind.as_str()),
        (StatusCode::INSUFFICIENT_STORAGE, "application/problem+json")
    );
    assert_eq!(
        problem["detail"],
        json!("the annotation service is full; annotations done go after 90 days")
    );
    let (_, list, _) = call(&app, Method::GET, "/api/v1/annotations", None, None).await;
    assert_eq!(list.as_array().map(Vec::len), Some(1));
}
