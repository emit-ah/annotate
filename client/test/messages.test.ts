import { describe, expect, it } from "vitest";
import { ENGLISH, messagesWith, say } from "../src/messages";

describe("the mode's texts", () => {
  it("fill their placeholders, and an app gives its own words as plain JSON", () => {
    const german = messagesWith({
      save: "Speichern",
      pin: "Anmerkung {number}",
      unknown: "x",
      done: 5,
    });
    expect(say(german, "save")).toBe("Speichern");
    expect(say(german, "pin", { number: 3 })).toBe("Anmerkung 3");
    expect(say(german, "done")).toBe(ENGLISH.done);
    expect(say(german, "refused")).toBe("Not saved: {reason}");
  });
});
