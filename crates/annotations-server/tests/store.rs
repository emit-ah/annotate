//! The store's upkeep (ADR-0001): annotations done, or not to be done, go once their time is up, while the service
//! runs, not only when it starts.

use std::time::Duration;

use annotations::{
    AnnotationBody, NewAnnotation, Rect, Region, Status, StatusUpdate, Target, Viewport,
};
use annotations_server::store::{Filter, Store, purge_every};

fn annotation() -> NewAnnotation {
    NewAnnotation {
        body: AnnotationBody {
            app: "demo".to_owned(),
            comment: "Too dark.".to_owned(),
            path: "/".to_owned(),
            query: String::new(),
            version: "1.0.0".to_owned(),
            viewport: Viewport {
                width: 800,
                height: 600,
                pixel_ratio: 1.0,
            },
            browser: String::new(),
            target: Target::Region(Region {
                rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 1.0,
                    height: 1.0,
                },
                elements: Vec::new(),
                items: Vec::new(),
            }),
            state: Vec::new(),
        },
        crop: None,
        frame: None,
        context: None,
        console: Vec::new(),
    }
}

#[tokio::test]
async fn a_running_service_purges_what_is_done_once_its_time_is_up_and_keeps_what_is_open() {
    let store = Store::in_memory().await.expect("a store in memory");
    let done = store.insert("andreas", annotation()).await.expect("kept");
    let open = store.insert("andreas", annotation()).await.expect("kept");
    let resolved = StatusUpdate {
        status: Some(Status::Done),
        ..StatusUpdate::default()
    };
    store.update(&done.id, &resolved).await.expect("changed");
    // Kept for no day, and looked at every few milliseconds.
    let purging = purge_every(store.clone(), Duration::from_millis(10), 0);
    let mut left = Vec::new();
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(10)).await;
        left = store.list(&Filter::default()).await.expect("a list");
        if left.len() == 1 {
            break;
        }
    }
    purging.abort();
    assert_eq!(
        left.iter().map(|kept| kept.id.as_str()).collect::<Vec<_>>(),
        [open.id.as_str()]
    );
}
