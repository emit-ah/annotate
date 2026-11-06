//! The API's OpenAPI document is committed as `openapi.json` (EMIT ADR-0025), so every change of the API shows in a
//! review: this test fails while the code and the file differ, and `UPDATE_OPENAPI=1` writes the file anew.

use annotations_server::api::ApiDoc;
use utoipa::OpenApi as _;

#[test]
fn the_committed_openapi_document_is_the_api_s() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("openapi.json");
    let generated = format!(
        "{}\n",
        ApiDoc::openapi()
            .to_pretty_json()
            .expect("the document as JSON")
    );
    if std::env::var_os("UPDATE_OPENAPI").is_some() {
        std::fs::write(&path, &generated).expect("openapi.json written");
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        committed == generated,
        "openapi.json differs from the API; run UPDATE_OPENAPI=1 cargo test -p annotations-server --test openapi"
    );
}

/// The `keyword` of the field `field` of the schema `schema` in the API's document, where it has one.
fn limit(document: &serde_json::Value, schema: &str, field: &str, keyword: &str) -> Option<u64> {
    let schemas = &document["components"]["schemas"][schema];
    let properties = schemas["properties"]
        .as_object()
        .or_else(|| schemas["allOf"][1]["properties"].as_object())?;
    let field = &properties[field];
    field[keyword]
        .as_u64()
        .or_else(|| field["items"][keyword].as_u64())
}

#[test]
fn the_document_publishes_the_model_s_limits() {
    use annotations::{
        MAX_APP, MAX_COMMENT, MAX_CONSOLE, MAX_ITEMS, MAX_STACK, MAX_TEXT, MAX_VERSION, MAX_WORD,
    };
    let document = serde_json::to_value(ApiDoc::openapi()).expect("the document as JSON");
    let as_u64 = |value: usize| u64::try_from(value).ok();
    for (schema, field, keyword, most) in [
        ("AnnotationBody", "app", "maxLength", MAX_APP),
        ("AnnotationBody", "comment", "maxLength", MAX_COMMENT),
        ("AnnotationBody", "version", "maxLength", MAX_VERSION),
        ("AnnotationBody", "path", "maxLength", MAX_TEXT),
        ("AnnotationBody", "state", "maxItems", MAX_ITEMS),
        ("NewAnnotation", "console", "maxItems", MAX_CONSOLE),
        ("ConsoleEntry", "stack", "maxLength", MAX_STACK),
        ("ConsoleEntry", "method", "maxLength", MAX_WORD),
        ("ConsoleEntry", "time", "maxLength", MAX_WORD),
        ("Element", "dom_path", "maxLength", MAX_TEXT),
        ("Element", "text_ids", "maxItems", MAX_ITEMS),
        ("StatusUpdate", "answer", "maxLength", MAX_COMMENT),
    ] {
        assert_eq!(
            limit(&document, schema, field, keyword),
            as_u64(most),
            "{schema}.{field}"
        );
    }
}
