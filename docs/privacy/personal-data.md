# Personal data in annotate

What annotate keeps of people (EMIT ADR-0026), where, for how long, and who reads it.

| Data | Where it comes from | Where it is kept | How long | Who reads it |
| --- | --- | --- | --- | --- |
| The author's login name | the project's proxy, after its basic auth | the service's SQLite database | until the annotation goes | everyone the basic auth lets in, Claude |
| The comment, and Claude's answer | the tester, Claude | the database | as above | as above |
| What the page showed of the target: role, name, text, text IDs, the view's state | the page, minus what the app redacts | the database | as above | as above |
| Pictures of the tab | only where the tester shares the tab; redacted parts painted over | the database | as above | as above |
| The app's context | the app's `context` hook; the app redacts it | the database | as above | as above |
| The console's latest entries | the browser's console and failed requests, scrubbed of queries, tokens, secrets and object values | the database | as above | as above |
| Annotations not yet sent | the tester's browser, IndexedDB | that browser only | until sent, a week at most | that browser's user |

- Annotations done or not to be done go 90 days after their last change; open ones stay until their author removes
  them or Claude answers them. The database holds at most 1 GiB and has no backup.
- The service runs only in a project's local stack and dev deployment, on the project's dev server in the EU,
  never on staging or production. Annotations leave it only through its API.
- The service's log names annotations by ID only; it keeps no IP address and no comment.
- The client sends nothing until a tester writes a comment and saves it, and only to the page's own host.
- A tester removes their own annotation while it is open (`DELETE /api/v1/annotations/{id}`). An export or erasure
  of everything a person wrote goes through the project's admin, who reads the database with the API.
- An app that shows personal or secret data marks it with `data-annotate-redact` or `data-annotate-private`, and
  may deny a record through its `redact` hook; in real data it should allow no pictures (`pictures` hook).
