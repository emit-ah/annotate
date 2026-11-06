// What annotate reads of the page itself: its `<meta name="annotate-…">` settings, which need no JavaScript (ADR-0001).

/** The content of the `<meta name="annotate-…">` tag of `name` in `document`; none where it is missing or empty. */
export function meta(document: Document, name: string): string | undefined {
  const content = document
    .querySelector(`meta[name="annotate-${name}"]`)
    ?.getAttribute("content")
    ?.trim();
  return content === undefined || content === "" ? undefined : content;
}

/** Whether `element` is the page's root or body, which stands for no element in particular. */
export function isPageRoot(element: Element): boolean {
  return element.localName === "body" || element.localName === "html";
}
