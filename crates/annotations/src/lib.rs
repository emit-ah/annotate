//! What an annotation holds (ADR-0001): a comment on something the user saw in an app, which app and build it was,
//! what it is about, the state of the view and, once the annotation service keeps it, its author, status and Claude's
//! answer. The client sends a [`NewAnnotation`]; the service keeps an [`Annotation`]. Both speak this JSON, and
//! [`AnnotationBody::check`] holds the limits both keep.

use std::fmt;
use std::str::FromStr;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// The most characters a comment or an answer has.
pub const MAX_COMMENT: usize = 4_000;
/// The most characters any other text has, such as a name, a path or a description.
pub const MAX_TEXT: usize = 2_000;
/// The most entries a list has, such as the state's, a region's elements or a canvas's items.
pub const MAX_ITEMS: usize = 100;
// The OpenAPI document repeats these limits as literals, which the service's test of `openapi.json` compares.

/// The most bytes a picture has.
pub const MAX_PNG_BYTES: usize = 2_000_000;
/// The most characters an app's name has.
pub const MAX_APP: usize = 64;
/// The most characters a build's version has.
pub const MAX_VERSION: usize = 64;
/// The most bytes the JSON of an app's context has.
pub const MAX_CONTEXT_BYTES: usize = 262_144;
/// The most entries of the console an annotation keeps.
pub const MAX_CONSOLE: usize = 50;
/// The most characters of a stack trace.
pub const MAX_STACK: usize = 4_000;
/// The most characters of a request's method or of a time.
pub const MAX_WORD: usize = 64;

/// What the user wrote, about what, and where: the part of an annotation the client sends and the service gives back.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AnnotationBody {
    /// The app or project annotated, a slug such as `mappa` or `tutti`.
    #[cfg_attr(
        feature = "openapi",
        schema(max_length = 64, pattern = "^[a-z0-9_-]+$")
    )]
    pub app: String,
    /// What the user says.
    #[cfg_attr(feature = "openapi", schema(max_length = 4000))]
    pub comment: String,
    /// The page: the path of its address, such as `/practice/ode-to-joy`.
    #[cfg_attr(feature = "openapi", schema(max_length = 2000))]
    pub path: String,
    /// The query of its address, without the `?` and without the parameter that switched the mode on; empty for none.
    #[serde(default)]
    #[cfg_attr(feature = "openapi", schema(max_length = 2000))]
    pub query: String,
    /// The build annotated: a commit, with `+dirty` where its tree had changes, or a version such as `1.4.0`.
    #[cfg_attr(
        feature = "openapi",
        schema(max_length = 64, pattern = "^[A-Za-z0-9._+-]+$")
    )]
    pub version: String,
    /// The browser's window.
    pub viewport: Viewport,
    /// The browser and its version, in brief.
    #[serde(default)]
    #[cfg_attr(feature = "openapi", schema(max_length = 2000))]
    pub browser: String,
    /// What the comment is about.
    pub target: Target,
    /// What describes the view, such as the document, the zoom and the options, each by its name.
    #[serde(default)]
    #[cfg_attr(feature = "openapi", schema(max_items = 100))]
    pub state: Vec<Entry>,
}

/// An annotation as the client sends it: its body and the pictures of what the user saw, where the tab was shared.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct NewAnnotation {
    /// What the user wrote, about what, and where.
    #[serde(flatten)]
    pub body: AnnotationBody,
    /// The pixels around the target.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop: Option<Png>,
    /// The whole window at half its size.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame: Option<Png>,
    /// What the app attached as the annotation was saved, such as a trace of its last steps: any JSON of at most
    /// [`MAX_CONTEXT_BYTES`]. The app decides what it holds and redacts it; the service keeps it as data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
    /// The console's latest errors and warnings, uncaught errors and failed requests, the oldest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "openapi", schema(max_items = 50))]
    pub console: Vec<ConsoleEntry>,
}

/// What the console said, or a request that failed, before an annotation was saved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ConsoleEntry {
    /// What kind of entry.
    pub kind: ConsoleKind,
    /// When, in UTC, RFC 3339.
    #[cfg_attr(feature = "openapi", schema(max_length = 64))]
    pub time: String,
    /// What it said.
    #[cfg_attr(feature = "openapi", schema(max_length = 2000))]
    pub message: String,
    /// Its stack trace, where it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "openapi", schema(max_length = 4000))]
    pub stack: Option<String>,
    /// A failed request's method.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "openapi", schema(max_length = 64))]
    pub method: Option<String>,
    /// A failed request's address, without its query.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "openapi", schema(max_length = 2000))]
    pub url: Option<String>,
    /// A failed request's HTTP status; 0 where no answer came.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

/// The kind of a console's entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ConsoleKind {
    /// `console.error`.
    Error,
    /// `console.warn`.
    Warn,
    /// An error nothing caught.
    Uncaught,
    /// A promise rejected that nothing handled.
    Rejection,
    /// A request that failed.
    Network,
}

/// An annotation as the service keeps it; its pictures, context and console it gives on their own.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Annotation {
    /// Its ID, a UUID of version 7, which sorts by time.
    pub id: String,
    /// When it came, in UTC, RFC 3339.
    pub created: String,
    /// When it last changed, in UTC, RFC 3339.
    pub updated: String,
    /// Who wrote it, as the service knows them.
    pub author: String,
    /// Where it stands.
    pub status: Status,
    /// Claude's answer, where there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "openapi", schema(max_length = 4000))]
    pub answer: Option<String>,
    /// The commit that resolved it, where one did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_in: Option<String>,
    /// Whether it has the crop around its target.
    pub has_crop: bool,
    /// Whether it has the whole window.
    pub has_frame: bool,
    /// Whether the app attached a context.
    pub has_context: bool,
    /// Whether it has the console's entries.
    pub has_console: bool,
    /// What the user wrote, about what, and where.
    #[serde(flatten)]
    pub body: AnnotationBody,
}

/// A change of an annotation's status, answer or resolving commit: what it leaves out stays, and an empty answer or
/// commit clears it. An admin changes all; an annotation's author only reopens it, which clears its commit.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct StatusUpdate {
    /// The new status.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<Status>,
    /// The answer; empty to clear it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "openapi", schema(max_length = 4000))]
    pub answer: Option<String>,
    /// The commit that resolved it; empty to clear it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_in: Option<String>,
}

impl StatusUpdate {
    /// The change that reopens an annotation, which its author may make.
    #[must_use]
    pub fn reopen() -> Self {
        Self {
            status: Some(Status::Open),
            ..Self::default()
        }
    }

    /// Whether it keeps the limits: an answer of at most [`MAX_COMMENT`] characters, and a commit of 7 to 40
    /// hexadecimal digits, with `+dirty` or not, or empty.
    ///
    /// # Errors
    ///
    /// The first field that breaks one.
    pub fn check(&self) -> Result<(), Invalid> {
        length(
            "answer",
            self.answer.as_deref().unwrap_or_default(),
            MAX_COMMENT,
        )?;
        match self.resolved_in.as_deref() {
            Some(commit) if !commit.is_empty() => check_commit("resolved_in", commit),
            _ => Ok(()),
        }
    }
}

/// Where an annotation stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// Not taken up yet.
    Open,
    /// Claude works on it.
    InProgress,
    /// Resolved, as its answer says.
    Done,
    /// Not done, as its answer says why.
    WontDo,
}

impl Status {
    /// Every status, in the order of its course.
    pub const ALL: [Self; 4] = [Self::Open, Self::InProgress, Self::Done, Self::WontDo];

    /// Its name, as JSON and the service's database write it.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::InProgress => "in_progress",
            Self::Done => "done",
            Self::WontDo => "wont_do",
        }
    }
}

impl fmt::Display for Status {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Status {
    type Err = Invalid;

    fn from_str(name: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .into_iter()
            .find(|status| status.as_str() == name)
            .ok_or_else(|| Invalid::new("status", "is none of open, in_progress, done and wont_do"))
    }
}

/// The browser's window: its size in CSS pixels and how many device pixels one has.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Viewport {
    /// Its width.
    pub width: u32,
    /// Its height.
    pub height: u32,
    /// The device pixels of one CSS pixel.
    pub pixel_ratio: f64,
}

/// A rectangle in CSS pixels: of the window, or of a canvas for a canvas's items.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Rect {
    /// Its left edge.
    pub x: f64,
    /// Its top edge.
    pub y: f64,
    /// Its width.
    pub width: f64,
    /// Its height.
    pub height: f64,
}

/// A value by its name, such as `zoom` and `180 %`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Entry {
    /// Its name.
    #[cfg_attr(feature = "openapi", schema(max_length = 2000))]
    pub name: String,
    /// Its value.
    #[cfg_attr(feature = "openapi", schema(max_length = 2000))]
    pub value: String,
}

/// What an annotation is about.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Target {
    /// An element of the page.
    Element(Element),
    /// What a canvas draws at a point or in a rectangle.
    Canvas(CanvasItems),
    /// A rectangle of the window, with what it covers.
    Region(Region),
}

/// An element of the page, named as tests find elements: by role and accessible name, and by the app's IDs of its
/// texts, which lead to the code.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Element {
    /// Its role, given or implied by its tag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "openapi", schema(max_length = 2000))]
    pub role: Option<String>,
    /// Its accessible name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "openapi", schema(max_length = 2000))]
    pub name: Option<String>,
    /// Its tag, such as `button`.
    #[cfg_attr(feature = "openapi", schema(max_length = 2000))]
    pub tag: String,
    /// The app's IDs of the texts it shows, such as the message IDs of its translations.
    #[serde(default)]
    #[cfg_attr(feature = "openapi", schema(max_items = 100))]
    pub text_ids: Vec<String>,
    /// The start of its text.
    #[serde(default)]
    #[cfg_attr(feature = "openapi", schema(max_length = 2000))]
    pub text: String,
    /// The components it lies in, the outermost first, as their roots name them.
    #[serde(default)]
    #[cfg_attr(feature = "openapi", schema(max_items = 100))]
    pub components: Vec<String>,
    /// Its path in the page, from the root, as tags with their place among their siblings.
    #[cfg_attr(feature = "openapi", schema(max_length = 2000))]
    pub dom_path: String,
    /// Where it lies in the window.
    pub rect: Rect,
    /// Whether the app kept its name and text out of the record.
    #[serde(default)]
    pub redacted: bool,
}

/// What a canvas draws at a point or in a rectangle, in the app's own words.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CanvasItems {
    /// Which canvas, such as `notation` or `map`.
    #[cfg_attr(feature = "openapi", schema(max_length = 2000))]
    pub canvas: String,
    /// The point, as a rectangle without size, or the rectangle, in the canvas's CSS pixels.
    pub rect: Rect,
    /// What lies there, the nearest first.
    #[cfg_attr(feature = "openapi", schema(max_items = 100))]
    pub hits: Vec<Hit>,
}

/// One thing a canvas draws, such as a note or a card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Hit {
    /// Its kind, such as `note` or `card`.
    #[cfg_attr(feature = "openapi", schema(max_length = 2000))]
    pub kind: String,
    /// It in words, such as "G4, measure 2, beat 1, right hand".
    #[cfg_attr(feature = "openapi", schema(max_length = 2000))]
    pub words: String,
    /// Its details by name, such as `pitch` and `measure`.
    #[serde(default)]
    #[cfg_attr(feature = "openapi", schema(max_items = 100))]
    pub details: Vec<Entry>,
}

/// A rectangle of the window, with the elements and canvas items it covers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Region {
    /// The rectangle.
    pub rect: Rect,
    /// The elements in it, the outermost that lie wholly in it.
    #[serde(default)]
    #[cfg_attr(feature = "openapi", schema(max_items = 100))]
    pub elements: Vec<Element>,
    /// The canvas items in it.
    #[serde(default)]
    #[cfg_attr(feature = "openapi", schema(max_items = 100))]
    pub items: Vec<CanvasItems>,
}

/// A picture in PNG, which JSON carries in Base64.
#[derive(Clone, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "openapi", schema(value_type = String, format = Byte))]
pub struct Png(pub Vec<u8>);

impl fmt::Debug for Png {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Png({} bytes)", self.0.len())
    }
}

impl Png {
    /// The picture that `text` holds in Base64, as a data URL has it after its comma.
    ///
    /// # Errors
    ///
    /// Where `text` is no Base64.
    pub fn from_base64(text: &str) -> Result<Self, Invalid> {
        STANDARD
            .decode(text)
            .map(Png)
            .map_err(|error| Invalid::new("png", format!("is no Base64: {error}")))
    }
}

impl Serialize for Png {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&STANDARD.encode(&self.0))
    }
}

impl<'de> Deserialize<'de> for Png {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        Png::from_base64(&text).map_err(serde::de::Error::custom)
    }
}

/// What makes an annotation invalid: the field and why, in words for the problem details of RFC 9457.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invalid {
    /// The field, such as `comment` or `target.name`.
    pub field: String,
    /// Why, such as "is empty".
    pub reason: String,
}

impl Invalid {
    fn new(field: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            field: field.into(),
            reason: reason.into(),
        }
    }
}

impl fmt::Display for Invalid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.field, self.reason)
    }
}

impl std::error::Error for Invalid {}

impl NewAnnotation {
    /// Whether it keeps the limits: its body's (see [`AnnotationBody::check`]), pictures of at most
    /// [`MAX_PNG_BYTES`], a context of at most [`MAX_CONTEXT_BYTES`] as JSON, and at most [`MAX_CONSOLE`] entries of
    /// the console, each with texts of at most [`MAX_TEXT`] characters and a stack of at most [`MAX_STACK`].
    ///
    /// # Errors
    ///
    /// The first field that breaks one.
    pub fn check(&self) -> Result<(), Invalid> {
        self.body.check()?;
        for (field, png) in [("crop", &self.crop), ("frame", &self.frame)] {
            if png.as_ref().is_some_and(|png| png.0.len() > MAX_PNG_BYTES) {
                return Err(Invalid::new(
                    field,
                    format!("has more than {MAX_PNG_BYTES} bytes"),
                ));
            }
        }
        if let Some(context) = &self.context
            && context_bytes(context) > MAX_CONTEXT_BYTES
        {
            return Err(Invalid::new(
                "context",
                format!("has more than {MAX_CONTEXT_BYTES} bytes as JSON"),
            ));
        }
        if self.console.len() > MAX_CONSOLE {
            return Err(Invalid::new(
                "console",
                format!("has more than {MAX_CONSOLE} entries"),
            ));
        }
        self.console.iter().try_for_each(ConsoleEntry::check)
    }
}

/// The bytes of `context` as compact JSON.
fn context_bytes(context: &serde_json::Value) -> usize {
    context.to_string().len()
}

impl ConsoleEntry {
    fn check(&self) -> Result<(), Invalid> {
        length("console.time", &self.time, MAX_WORD)?;
        length("console.message", &self.message, MAX_TEXT)?;
        length(
            "console.stack",
            self.stack.as_deref().unwrap_or_default(),
            MAX_STACK,
        )?;
        length(
            "console.method",
            self.method.as_deref().unwrap_or_default(),
            MAX_WORD,
        )?;
        length(
            "console.url",
            self.url.as_deref().unwrap_or_default(),
            MAX_TEXT,
        )
    }
}

impl AnnotationBody {
    /// Whether it keeps the limits:
    /// - an app's name as [`is_app_name`] takes it;
    /// - a comment of 1 to [`MAX_COMMENT`] characters;
    /// - a path that starts with `/`;
    /// - a version as [`is_version`] takes it;
    /// - texts of at most [`MAX_TEXT`] characters, and lists of at most [`MAX_ITEMS`] entries.
    ///
    /// # Errors
    ///
    /// The first field that breaks one.
    pub fn check(&self) -> Result<(), Invalid> {
        if !is_app_name(&self.app) {
            return Err(Invalid::new(
                "app",
                format!("is no name of 1 to {MAX_APP} lowercase letters, digits, - and _"),
            ));
        }
        if self.comment.trim().is_empty() {
            return Err(Invalid::new("comment", "is empty"));
        }
        length("comment", &self.comment, MAX_COMMENT)?;
        if !self.path.starts_with('/') {
            return Err(Invalid::new("path", "does not start with /"));
        }
        length("path", &self.path, MAX_TEXT)?;
        length("query", &self.query, MAX_TEXT)?;
        if !is_version(&self.version) {
            return Err(Invalid::new(
                "version",
                format!("is no version of 1 to {MAX_VERSION} letters, digits, ., _, + and -"),
            ));
        }
        length("browser", &self.browser, MAX_TEXT)?;
        entries("state", &self.state)?;
        match &self.target {
            Target::Element(element) => element.check("target"),
            Target::Canvas(items) => items.check("target"),
            Target::Region(region) => {
                count("target.elements", region.elements.len())?;
                count("target.items", region.items.len())?;
                for element in &region.elements {
                    element.check("target.elements")?;
                }
                for items in &region.items {
                    items.check("target.items")?;
                }
                Ok(())
            }
        }
    }
}

impl Element {
    fn check(&self, field: &str) -> Result<(), Invalid> {
        for (name, text) in [
            ("role", self.role.as_deref().unwrap_or_default()),
            ("name", self.name.as_deref().unwrap_or_default()),
            ("tag", &self.tag),
            ("text", &self.text),
            ("dom_path", &self.dom_path),
        ] {
            length(&format!("{field}.{name}"), text, MAX_TEXT)?;
        }
        texts(&format!("{field}.text_ids"), &self.text_ids)?;
        texts(&format!("{field}.components"), &self.components)
    }
}

impl CanvasItems {
    fn check(&self, field: &str) -> Result<(), Invalid> {
        length(&format!("{field}.canvas"), &self.canvas, MAX_TEXT)?;
        count(&format!("{field}.hits"), self.hits.len())?;
        for hit in &self.hits {
            length(&format!("{field}.hits.kind"), &hit.kind, MAX_TEXT)?;
            length(&format!("{field}.hits.words"), &hit.words, MAX_TEXT)?;
            entries(&format!("{field}.hits.details"), &hit.details)?;
        }
        Ok(())
    }
}

/// Whether `name` names an app: 1 to [`MAX_APP`] lowercase ASCII letters, digits, `-` and `_`, as a project's slug.
#[must_use]
pub fn is_app_name(name: &str) -> bool {
    (1..=MAX_APP).contains(&name.len())
        && name.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'_'
        })
}

/// Whether `version` names a build as a project stamps it: a commit such as `47d97f7+dirty`, or a version such as
/// `1.4.0-rc.1`; 1 to [`MAX_VERSION`] ASCII letters, digits, `.`, `_`, `+` and `-`.
#[must_use]
pub fn is_version(version: &str) -> bool {
    (1..=MAX_VERSION).contains(&version.len())
        && version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._+-".contains(&byte))
}

/// Whether `commit` names a commit as git abbreviates it or not: 7 to 40 hexadecimal digits, with `+dirty` where its
/// tree had changes.
fn check_commit(field: &str, commit: &str) -> Result<(), Invalid> {
    let hex = commit.strip_suffix("+dirty").unwrap_or(commit);
    if !(7..=40).contains(&hex.len()) || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(Invalid::new(
            field,
            "is no commit of 7 to 40 hexadecimal digits",
        ));
    }
    Ok(())
}

fn length(field: &str, text: &str, most: usize) -> Result<(), Invalid> {
    if text.chars().count() > most {
        return Err(Invalid::new(
            field,
            format!("has more than {most} characters"),
        ));
    }
    Ok(())
}

fn count(field: &str, len: usize) -> Result<(), Invalid> {
    if len > MAX_ITEMS {
        return Err(Invalid::new(
            field,
            format!("has more than {MAX_ITEMS} entries"),
        ));
    }
    Ok(())
}

fn texts(field: &str, texts: &[String]) -> Result<(), Invalid> {
    count(field, texts.len())?;
    texts
        .iter()
        .try_for_each(|text| length(field, text, MAX_TEXT))
}

fn entries(field: &str, entries: &[Entry]) -> Result<(), Invalid> {
    count(field, entries.len())?;
    entries.iter().try_for_each(|entry| {
        length(&format!("{field}.name"), &entry.name, MAX_TEXT)?;
        length(&format!("{field}.value"), &entry.value, MAX_TEXT)
    })
}

#[cfg(test)]
mod tests;
