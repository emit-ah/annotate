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
