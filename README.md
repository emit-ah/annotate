# annotate

An annotation mode for any web app, in the style of Claude Design's review mode. Testers press `Alt+Shift+A`
(or open the app with `?annotate`), click an element, a canvas item or a dragged region, and write a comment.
The comment goes to a small service with the version, the page, the window, the view's state, the target by role,
accessible name and text IDs, and pictures where the tab is shared. Claude lists the open annotations, works on
them and answers with a status and the resolving commit.

It was extracted from tutti; [ADR-0001](docs/adr/0001-annotate-as-a-standalone-project.md) records the decision.

## Parts

- `client/`: the browser client, plain JavaScript built from TypeScript. `annotate.js` works with one script tag;
  an ES module serves bundlers.
- `crates/annotations`: the record and its limits.
- `crates/annotations-server`: the service, Axum and SQLite, under `/api/v1/annotations`.
- `mk/annotations.mk`: the CLI for Claude, a Makefile include.
- `image/`: the service's container image.

[docs/integrating.md](docs/integrating.md) shows how a project wires it in.

## Develop

`make help` lists the commands; `make setup` installs the pinned tools through mise, and `make ci` runs every
check.
