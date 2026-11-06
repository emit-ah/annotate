// A page that wires annotate in with one script tag, `<meta>` tags and `data-annotate-*` attributes only, served
// under a strict CSP (ADR-0001).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { standIn } from "./service";

/** Switches the mode on by its shortcut and goes on without sharing the tab. */
async function startWithoutPictures(page: Page): Promise<void> {
  await page.keyboard.press("Alt+Shift+A");
  await expect(
    page.getByRole("dialog", { name: "Share this tab?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Without pictures" }).click();
  await expect(page.getByRole("region", { name: "Annotating" })).toBeVisible();
}

/** What the page's console said against its Content Security Policy, during each test. */
let violations: string[] = [];

test.beforeEach(({ page }) => {
  violations = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().includes("Content Security Policy")
    ) {
      violations.push(message.text());
    }
  });
});

test.afterEach(() => {
  expect(violations).toEqual([]);
});

test("a comment pinned to a button keeps its role, name, text ID, state, app and version", async ({
  page,
}) => {
  const service = await standIn(page);
  await page.goto("/");
  await startWithoutPictures(page);
  await page.getByRole("button", { name: "Save changes" }).click();
  const comment = page.getByRole("textbox", { name: "Comment" });
  await expect(comment).toBeFocused();
  await comment.fill("The label should say what is saved.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Annotation 1" }),
  ).toBeVisible();
  const [posted] = service.posted;
  expect(posted).toMatchObject({
    app: "demo",
    version: "1.4.0",
    path: "/",
    comment: "The label should say what is saved.",
    target: {
      kind: "element",
      role: "button",
      name: "Save changes",
      text_ids: ["settings-save"],
      redacted: false,
    },
    state: [
      { name: "view", value: "settings" },
      { name: "tab", value: "account" },
    ],
  });
  expect(posted).not.toHaveProperty("crop");
});

test("a redacted element keeps its role but not its name or text, and a private one is not annotated", async ({
  page,
}) => {
  const service = await standIn(page);
  await page.goto("/");
  await startWithoutPictures(page);
  await page.getByText("4,200.00 EUR").click();
  await page
    .getByRole("textbox", { name: "Comment" })
    .fill("Align the amount.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Annotation 1" }),
  ).toBeVisible();
  const target = service.posted[0]?.["target"];
  expect(target).toMatchObject({
    kind: "element",
    tag: "p",
    text: "",
    redacted: true,
  });
  expect(JSON.stringify(service.posted[0])).not.toContain("4,200");

  await page.getByText("alpha-bravo-charlie").click();
  await expect(page.getByRole("status")).toHaveText(
    "This part of the app is not annotated.",
  );
  await expect(page.getByRole("textbox", { name: "Comment" })).toHaveCount(0);
});

test("?annotate starts the mode, Escape ends it, and the page works again", async ({
  page,
}) => {
  await standIn(page);
  await page.goto("/?annotate");
  await expect(
    page.getByRole("dialog", { name: "Share this tab?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Without pictures" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Annotating" })).toHaveCount(0);
  await page.getByLabel("Nickname").fill("Grace");
  await expect(page.getByLabel("Nickname")).toHaveValue("Grace");
});

test("where no service answers, the mode says so and keeps nothing", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Alt+Shift+A");
  const dialog = page.getByRole("dialog", { name: "Nothing can be kept here" });
  await expect(dialog).toContainText("No annotation service answers here");
  await dialog.getByRole("button", { name: "Leave" }).click();
  await expect(dialog).toHaveCount(0);
});

test("a service that is down leaves the annotation in the outbox, which goes once it is back", async ({
  page,
}) => {
  const service = await standIn(page);
  await page.goto("/");
  await startWithoutPictures(page);
  service.up = false;
  await page.getByRole("heading", { name: "Account" }).click();
  await page.getByRole("textbox", { name: "Comment" }).fill("Bigger heading.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(/Kept in this browser/);
  service.up = true;
  await page.keyboard.press("Escape");
  await startWithoutPictures(page);
  await expect(
    page.getByRole("button", { name: "Annotation 1" }),
  ).toBeVisible();
  expect(service.posted).toHaveLength(1);
});

test("the console and failed requests go with an annotation", async ({
  page,
}) => {
  const service = await standIn(page);
  await page.goto("/");
  await page.evaluate(async () => {
    console.error(new Error("the greeting failed"));
    await fetch("/missing.json?token=secret").catch(() => undefined);
  });
  await startWithoutPictures(page);
  await page.getByRole("heading", { name: "Account" }).click();
  await page.getByRole("textbox", { name: "Comment" }).fill("Something broke.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Annotation 1" }),
  ).toBeVisible();
  const entries = service.posted[0]?.["console"];
  expect(entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "error",
        message: "Error: the greeting failed",
        stack: expect.any(String),
      }),
      expect.objectContaining({
        kind: "network",
        method: "GET",
        url: "/missing.json",
        status: 404,
      }),
    ]),
  );
  expect(JSON.stringify(entries)).not.toContain("secret");
});

test("the mode, its popover and its list have no violations axe finds", async ({
  page,
}) => {
  await standIn(page);
  await page.goto("/");
  await startWithoutPictures(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Save changes" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "On this page: 0" }).click();
  await expect(
    page.getByRole("heading", { name: "This page · 0" }),
  ).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("by keyboard, the focus or the arrows pick an element and Enter annotates it", async ({
  page,
}) => {
  await standIn(page);
  await page.goto("/");
  await startWithoutPictures(page);
  // As a Tab from the page's start does; the mode's own parts come after the page in the order of Tab.
  await page.getByLabel("Nickname").focus();
  await expect(page.getByRole("region", { name: "Annotating" })).toContainText(
    "Focused: textbox · Nickname",
  );
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("region", { name: "Annotating" })).toContainText(
    "Focused: textbox · Nickname",
  );
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "textbox · Nickname" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Nickname")).toBeFocused();
});
