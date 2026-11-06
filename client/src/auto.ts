// `annotate.js`: the client for one `<script src>` tag. It hears the console at once, offers `window.annotate`, and
// mounts the mode as soon as the page has a body.

import { hear } from "./diagnostics";
import { install, mount } from "./index";

hear(window);
install();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => mount(), { once: true });
} else {
  mount();
}
