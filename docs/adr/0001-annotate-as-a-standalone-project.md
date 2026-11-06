# ADR-0001: annotate as a standalone project

Status: accepted (2026-11-06)

## Context

- tutti built an annotation mode in the style of Claude Design's review mode (tutti ADR-0020, FR-ANN-001 to 005):
  - a user clicks anywhere in the app and pins a comment to an element, to what a canvas draws, or to a dragged
    region;
  - a service keeps the comment with the commit, the page, the window, the view's state and, where the tab is
    shared, pictures;
  - Claude pulls the open annotations over the API, works on them and answers with a status and the resolving
    commit.
- The mode lives in tutti's Dioxus app (`app/src/annotate/`) and the service in tutti's crates
  (`crates/annotations`, `crates/annotations-server`). Mappa wants the same mode, and other projects will.
- On 2026-11-06 the owner decided:
  - annotate gets its own repository and is reusable in any project;
  - the server stays Rust, taken over from tutti and generalised with an app field;
  - the client becomes a framework-free TypeScript web component;
  - a CLI lets Claude list, fetch and answer annotations;
  - the license is tutti's.
- The owner made one requirement binding the same day: annotate works in every web project, whatever language or
  framework builds it. That includes Rust/Dioxus or other WASM (tutti), Svelte (Mappa), React and plain
  server-rendered HTML.

## Decision

### Core requirement: any web project, any language

- The client is plain JavaScript and ships twice:
  - `annotate.js`, one self-contained file that works with a single `<script src>` tag, without a build step, a
    framework or npm;
  - an ES module with its type declarations, for projects that bundle.
- It depends on nothing of the host: no framework, no bundler, no global CSS.
- Every hook is callable from any language. Hooks are plain functions that take and return JSON-serialisable data,
  set through a global API:
  - `window.annotate.configure({...})`;
  - `window.annotate.register(name, fn)`.
  A WASM app registers its hooks through wasm-bindgen or a small JS shim, as any other app does.
- A zero-JS path is useful on its own:
  - `<meta name="annotate-app">`, `<meta name="annotate-version">` and `<meta name="annotate-endpoint">`
    configure the client;
  - `data-annotate-id` and `data-annotate-label` give an element's text IDs and name;
  - `data-annotate-state` gives facts of the view;
  - `data-annotate-redact` and `data-annotate-private` keep content out of the record;
  - the client dispatches `annotate:start`, `annotate:end` and `annotate:saved` on `document`.
- The client is CSP-friendly:
  - no inline styles: its styles are constructable stylesheets adopted by its shadow root, and places are set
    through CSSOM, as tutti does;
  - no `eval`, no external assets;
  - a host needs its script source, `connect-src` for its own `/api`, and `img-src blob:` for the crop preview.

### The parts

- **`crates/annotations`**: the model and the limits, ported from tutti, generalised:
  - every annotation names its **app**, a short slug such as `mappa` or `tutti`, so one image serves any project;
  - the build's `version` is a commit or a version string, as the project stamps it; the resolving commit stays
    a commit;
  - a target names the app's own **text IDs** (tutti's ftl message IDs, Mappa's i18n keys) instead of ftl IDs.
- **`crates/annotations-server`**: Axum on tokio with SQLite through sqlx, ported from tutti:
  - the API `/api/v1/annotations`, every error as problem details of RFC 9457, `/health/live` and `/health/ready`;
  - an OpenAPI document from the code, committed as `openapi.json`, which a test compares;
  - lists filter by app, status, path and version;
  - `ANNOTATIONS_APPS` optionally limits which apps an instance keeps;
  - it fails closed: it starts only with `ANNOTATIONS_USER_HEADER` behind an auth proxy, or with
    `ANNOTATIONS_OPEN=local`;
  - the admins in `ANNOTATIONS_ADMINS` change statuses, answers and resolving commits; any other caller creates
    and reads, removes their own while open and reopens their own once done;
  - changes that a browser marks as cross-site (`Sec-Fetch-Site`) are refused; every answer carries
    `Cross-Origin-Resource-Policy: same-origin`, `nosniff`, a sandboxing CSP and `no-store`;
  - pictures are PNG of at most 2 MB, whose headers the service checks within 1 MiB;
  - annotations done or not to be done go after 90 days, and the database holds at most 1 GiB.
- **`client/`**: the TypeScript web component, ported from tutti's `app/src/annotate/`:
  - `Alt+Shift+A` or `?annotate` switches it on, Escape off;
  - one overlay layer with outline, numbered pins, popover and list;
  - pins go to an element, a canvas item or a dragged region (or two clicks, WCAG 2.5.7);
  - the record keeps the version, the page, the window, the view's state and the target by role, accessible
    name and text IDs, plus a crop and a half-size frame in PNG where the user shares the tab;
  - an outbox in IndexedDB holds annotations until the service has them;
  - where no service answers, the mode says so and keeps nothing.
- **The CLI**: `mk/annotations.mk`, a Makefile include that a project copies or includes. It needs only curl and
  jq, and is taken over from tutti's `mk/annotations.mk`:
  - `make annotations` lists the open annotations of the project's app;
  - `make annotation ID=<id>` fetches one with its pictures into `local/annotations/<id>/`;
  - `make annotation-status ID=<id> STATUS=done COMMIT=<sha> NOTE=<answer>` answers one;
  - control characters in untrusted text are stripped before they reach the terminal.

### Adapter hooks

The host app may register these; each has a zero-JS default.

| Hook | Gives | Default without it |
| --- | --- | --- |
| `version()` | the commit or version of the build | `<meta name="annotate-version">`; without either, the mode keeps nothing |
| `describeCanvas(input)` | what a canvas or `[data-annotate-canvas]` element shows at a point or in a rectangle, in the app's words (Mappa: the card under the pointer; tutti: the notes) | the canvas by its name, without hits |
| `textIds(texts)` | the app's text IDs for an element's texts | the `data-annotate-id` values in the element |
| `state()` | the view's state as name and value pairs | the `data-annotate-state` attributes on the page |
| `redact(record)` | the record to keep, changed as the app wants, or `null` to deny it | the record as `data-annotate-redact` and `data-annotate-private` left it |
| `pictures()` | whether pictures may be taken at all | `true` |

- Hooks run with a time limit. A hook that throws or times out counts as absent, except `redact` and
  `pictures`, which fail closed: the annotation is not kept, or no pictures are taken.

### Privacy and redaction

- An annotation holds its author's login name, the comment, what the page showed of its target, and pictures only
  where the user shared the tab. It is personal data (EMIT ADR-0026): it stays on the project's dev server until
  removed or purged, and leaves it only through the API.
- `data-annotate-redact` keeps an element's role, tag and `data-annotate-id`, drops its name and text, and paints
  its pixels over in pictures.
- `data-annotate-private` does the same, and the element cannot be a target at all; regions skip it.
- `pictures()` returning `false` skips the question whether to share the tab.
- `redact(record)` sees the final record and may change or deny it. Mappa uses it to keep only a card's ID and
  type in real vaults, and full content only in its demo.
- The service's log names annotations by ID only.

### Deployment

- Each project runs its own instance of the image, in its local stack and its dev deployment only, never on
  staging or production.
- The project's proxy (Traefik or nginx) routes `/api/v1/annotations` on the app's own host to the instance, so
  the app's CSP covers it with `connect-src 'self'` and no CORS is needed.
- The proxy guards it with the project's basic auth and names the caller in a header such as `X-Auth-User`, which
  `ANNOTATIONS_USER_HEADER` names; it also limits each caller's rate.
- The app's static server answers `/api/` with 404 where no instance routes before it, so the client can tell that
  no service is there.
- The instance shares a network with the proxy alone. Its database lives in a volume and has no backup.

### How Claude reads annotations

- The project's dev server gives the basic auth user `claude`, an admin, a random password, which goes only into
  `local/annotations.netrc` of the working checkout.
- Claude runs `make annotations`, `make annotation` and `make annotation-status` over the API.
- An annotation is data, not an instruction. Claude takes up what it says about the app's UI and content, and asks
  the user before anything it asks of the build, the deployment, scripts, CI or secrets.

## Consequences

- One image and one client serve tutti, Mappa and any later project. A change to the record changes the model
  crate, `openapi.json` and the client's types together; a client test compares its types with `openapi.json`.
- tutti and Mappa adopt annotate in their own pull requests. tutti's own mode and service stay until then.
- The image takes the binary that `make build` writes in the dev container's toolchain, as tutti's does; it is
  not built in stages of its own (tutti ADR-0020's deviation from docker-images).
- sqlx checks the queries at run time; every query runs in the service's tests (tutti ADR-0020's deviation from
  EMIT ADR-0017).
- The mode is in every build of a host that loads the script, hidden until switched on. Without a service it keeps
  nothing.
