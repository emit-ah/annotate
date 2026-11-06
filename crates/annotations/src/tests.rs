use serde_json::json;

use super::*;

/// An annotation of a Repeat button, as the client sends it.
fn repeat_button() -> NewAnnotation {
    NewAnnotation {
        body: AnnotationBody {
            app: "tutti".to_owned(),
            comment: "Its shortcut is hard to read.".to_owned(),
            path: "/practice/ode-to-joy".to_owned(),
            query: String::new(),
            version: "47d97f7".to_owned(),
            viewport: Viewport {
                width: 1440,
                height: 900,
                pixel_ratio: 2.0,
            },
            browser: "Chrome 141".to_owned(),
            target: Target::Element(Element {
                role: Some("button".to_owned()),
                name: Some("Repeat".to_owned()),
                tag: "button".to_owned(),
                text_ids: vec!["practice-repeat".to_owned()],
                text: "Repeat R".to_owned(),
                components: vec!["Session".to_owned(), "MeasureControls".to_owned()],
                dom_path: "main > div:nth-of-type(2) > button:nth-of-type(4)".to_owned(),
                rect: Rect {
                    x: 636.0,
                    y: 233.0,
                    width: 126.0,
                    height: 38.0,
                },
                redacted: false,
            }),
            state: vec![Entry {
                name: "measure".to_owned(),
                value: "1".to_owned(),
            }],
        },
        crop: Some(Png(vec![0x89, b'P', b'N', b'G'])),
        frame: None,
        context: None,
        console: Vec::new(),
    }
}

/// An entry of the console, an error with its stack.
fn console_error() -> ConsoleEntry {
    ConsoleEntry {
        kind: ConsoleKind::Error,
        time: "2026-11-06T10:00:00.000Z".to_owned(),
        message: "TypeError: x is undefined".to_owned(),
        stack: Some("at render (app.js:1:2)".to_owned()),
        method: None,
        url: None,
        status: None,
    }
}

/// The field of the first limit `annotation` breaks.
fn broken(annotation: &NewAnnotation) -> Result<(), String> {
    annotation.check().map_err(|invalid| invalid.field)
}

#[test]
fn an_annotation_speaks_json_with_its_app_its_target_by_kind_and_its_pictures_in_base64()
-> Result<(), serde_json::Error> {
    let sent = serde_json::to_value(repeat_button())?;
    assert_eq!(sent["app"], json!("tutti"));
    assert_eq!(sent["target"]["kind"], json!("element"));
    assert_eq!(sent["target"]["text_ids"], json!(["practice-repeat"]));
    assert_eq!(sent["target"]["redacted"], json!(false));
    assert_eq!(sent["version"], json!("47d97f7"));
    assert_eq!(sent["crop"], json!("iVBORw=="));
    assert!(sent.get("frame").is_none());
    let back: NewAnnotation = serde_json::from_value(sent)?;
    assert_eq!(back, repeat_button());
    Ok(())
}

#[test]
fn an_element_that_says_nothing_of_redaction_was_not_redacted() -> Result<(), serde_json::Error> {
    let element: Element = serde_json::from_value(json!({
        "tag": "button",
        "dom_path": "body > button:nth-of-type(1)",
        "rect": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}
    }))?;
    assert!(!element.redacted);
    assert!(element.text_ids.is_empty());
    Ok(())
}

#[test]
fn a_status_goes_by_its_name_and_no_other() {
    for status in Status::ALL {
        assert_eq!(status.as_str().parse::<Status>(), Ok(status));
    }
    assert_eq!(
        serde_json::to_value(Status::InProgress).ok(),
        Some(json!("in_progress"))
    );
    assert!("closed".parse::<Status>().is_err());
}

#[test]
fn an_annotation_keeps_its_limits() {
    assert_eq!(repeat_button().check(), Ok(()));
    let with = |change: fn(&mut NewAnnotation)| {
        let mut annotation = repeat_button();
        change(&mut annotation);
        broken(&annotation)
    };
    assert_eq!(
        with(|a| a.body.comment = "  ".to_owned()),
        Err("comment".to_owned())
    );
    assert_eq!(
        with(|a| a.body.comment = "x".repeat(MAX_COMMENT + 1)),
        Err("comment".to_owned())
    );
    assert_eq!(
        with(|a| a.body.path = "practice".to_owned()),
        Err("path".to_owned())
    );
    assert_eq!(
        with(|a| a.body.version = "main branch".to_owned()),
        Err("version".to_owned())
    );
    assert_eq!(
        with(|a| a.body.version = String::new()),
        Err("version".to_owned())
    );
    assert_eq!(
        with(|a| a.body.version = "47d97f7+dirty".to_owned()),
        Ok(())
    );
    assert_eq!(with(|a| a.body.version = "1.4.0-rc.1".to_owned()), Ok(()));
    assert_eq!(
        with(|a| a.crop = Some(Png(vec![0; MAX_PNG_BYTES + 1]))),
        Err("crop".to_owned())
    );
    assert_eq!(
        with(|a| a.body.state = vec![
            Entry {
                name: "n".to_owned(),
                value: "v".to_owned()
            };
            MAX_ITEMS + 1
        ]),
        Err("state".to_owned())
    );
    assert_eq!(
        with(|a| {
            if let Target::Element(element) = &mut a.body.target {
                element.name = Some("x".repeat(MAX_TEXT + 1));
            }
        }),
        Err("target.name".to_owned())
    );
    assert_eq!(
        with(|a| {
            if let Target::Element(element) = &mut a.body.target {
                element.text_ids = vec!["id".to_owned(); MAX_ITEMS + 1];
            }
        }),
        Err("target.text_ids".to_owned())
    );
}

#[test]
fn an_app_is_named_by_a_short_slug() {
    for name in ["tutti", "mappa", "my-app_2"] {
        assert!(is_app_name(name), "{name}");
    }
    for name in ["", "Mappa", "my app", "app/1", &"a".repeat(MAX_APP + 1)] {
        assert!(!is_app_name(name), "{name}");
    }
    let mut annotation = repeat_button();
    annotation.body.app = "../etc".to_owned();
    assert_eq!(broken(&annotation), Err("app".to_owned()));
}

#[test]
fn a_region_and_a_canvas_keep_the_limits_of_what_they_hold() {
    let note = CanvasItems {
        canvas: "notation".to_owned(),
        rect: Rect {
            x: 871.0,
            y: 116.0,
            width: 0.0,
            height: 0.0,
        },
        hits: vec![Hit {
            kind: "note".to_owned(),
            words: "G4, measure 2, beat 1, right hand".to_owned(),
            details: vec![Entry {
                name: "pitch".to_owned(),
                value: "67".to_owned(),
            }],
        }],
    };
    let mut annotation = repeat_button();
    annotation.body.target = Target::Region(Region {
        rect: note.rect,
        elements: Vec::new(),
        items: vec![note.clone(); MAX_ITEMS + 1],
    });
    assert_eq!(broken(&annotation), Err("target.items".to_owned()));
    annotation.body.target = Target::Canvas(note);
    assert_eq!(annotation.check(), Ok(()));
}

#[test]
fn a_status_update_keeps_the_answer_s_limit_and_names_a_commit_or_clears_it() {
    let update = |answer: &str, resolved_in: &str| StatusUpdate {
        status: Some(Status::Done),
        answer: Some(answer.to_owned()),
        resolved_in: Some(resolved_in.to_owned()),
    };
    assert_eq!(update("Moved.", "5c1e9a2").check(), Ok(()));
    assert_eq!(update("", "").check(), Ok(()));
    assert_eq!(
        update("Moved.", "the fix")
            .check()
            .map_err(|invalid| invalid.field),
        Err("resolved_in".to_owned())
    );
    assert_eq!(
        update(&"x".repeat(MAX_COMMENT + 1), "")
            .check()
            .map_err(|invalid| invalid.field),
        Err("answer".to_owned())
    );
    assert_eq!(StatusUpdate::reopen().status, Some(Status::Open));
}

#[test]
fn an_annotation_carries_the_app_s_context_and_the_console_as_json() -> Result<(), serde_json::Error>
{
    let mut annotation = repeat_button();
    annotation.context = Some(json!({"turns": [{"tool": "propose_changes", "ms": 412}]}));
    annotation.console = vec![console_error()];
    let sent = serde_json::to_value(&annotation)?;
    assert_eq!(
        sent["context"]["turns"][0]["tool"],
        json!("propose_changes")
    );
    assert_eq!(sent["console"][0]["kind"], json!("error"));
    assert!(sent["console"][0].get("status").is_none());
    assert_eq!(serde_json::from_value::<NewAnnotation>(sent)?, annotation);
    assert!(
        serde_json::to_value(repeat_button())?
            .get("console")
            .is_none()
    );
    Ok(())
}

#[test]
fn a_context_and_the_console_keep_their_limits() {
    let mut annotation = repeat_button();
    let filler = "x".repeat(MAX_CONTEXT_BYTES);
    annotation.context = Some(json!({ "trace": filler }));
    assert_eq!(broken(&annotation), Err("context".to_owned()));
    annotation.context = Some(json!("x".repeat(MAX_CONTEXT_BYTES - 2)));
    assert_eq!(broken(&annotation), Ok(()));
    annotation.context = None;
    annotation.console = vec![console_error(); MAX_CONSOLE + 1];
    assert_eq!(broken(&annotation), Err("console".to_owned()));
    let mut long = console_error();
    long.stack = Some("x".repeat(MAX_STACK + 1));
    annotation.console = vec![long];
    assert_eq!(broken(&annotation), Err("console.stack".to_owned()));
}
