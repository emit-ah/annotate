import { describe, expect, it } from "vitest";
import { keyUse, type At, type Press } from "../src/keys";

const press = (key: string, more: Partial<Press> = {}): Press => ({
  key,
  code: "",
  alt: false,
  shift: false,
  ctrl: false,
  meta: false,
  composing: false,
  ...more,
});
const off: At = {
  on: false,
  picking: false,
  picked: false,
  ours: false,
  typing: false,
  control: false,
};
const on: At = { ...off, on: true, picking: true };
const shortcut = press("A", { code: "KeyA", alt: true, shift: true });

describe("what a key does", () => {
  it("Alt+Shift+A switches the mode, except in a field", () => {
    expect(keyUse(shortcut, off)).toEqual({ use: "switch" });
    expect(keyUse(shortcut, on)).toEqual({ use: "switch" });
    // A Mac's Option key makes the letter "Å", and AZERTY has the A where QWERTY has the Q.
    expect(keyUse({ ...shortcut, key: "Å" }, off)).toEqual({ use: "switch" });
    expect(keyUse({ ...shortcut, code: "KeyQ" }, off)).toEqual({
      use: "switch",
    });
    expect(keyUse(shortcut, { ...on, typing: true })).toEqual({
      use: "withhold",
    });
    expect(keyUse({ ...shortcut, ctrl: true }, off)).toEqual({ use: "pass" });
  });

  it("while the mode is off every other key goes to the page", () => {
    for (const key of ["Escape", "Enter", " ", "a", "Tab"]) {
      expect(keyUse(press(key), off)).toEqual({ use: "pass" });
    }
  });

  it("Escape goes back from anywhere and the mode's own controls take their keys", () => {
    expect(keyUse(press("Escape"), on)).toEqual({ use: "back" });
    expect(
      keyUse(press("Escape"), { ...on, ours: true, typing: true }),
    ).toEqual({ use: "back" });
    expect(keyUse(press("Enter"), { ...on, ours: true })).toEqual({
      use: "pass",
    });
    expect(keyUse(press("x"), { ...on, ours: true, typing: true })).toEqual({
      use: "pass",
    });
  });

  it("Enter or A pin what the keyboard picked, and Space scrolls", () => {
    const picked = { ...on, picked: true };
    for (const key of ["Enter", "a", "A"]) {
      expect(keyUse(press(key), picked)).toEqual({ use: "pin" });
    }
    expect(keyUse(press(" "), picked)).toEqual({ use: "browser" });
    expect(keyUse(press("Enter"), on)).toEqual({ use: "withhold" });
    expect(keyUse(press("Enter"), { ...off, on: true, picked: true })).toEqual({
      use: "withhold",
    });
    expect(keyUse(press("Enter", { ctrl: true }), picked)).toEqual({
      use: "withhold",
    });
  });

  it("the arrows move a pick by keyboard and else scroll", () => {
    const picked = { ...on, picked: true };
    expect(keyUse(press("ArrowUp"), picked)).toEqual({
      use: "move",
      step: "out",
    });
    expect(keyUse(press("ArrowDown"), picked)).toEqual({
      use: "move",
      step: "in",
    });
    expect(keyUse(press("ArrowLeft"), picked)).toEqual({
      use: "move",
      step: "back",
    });
    expect(keyUse(press("ArrowRight"), picked)).toEqual({
      use: "move",
      step: "on",
    });
    expect(keyUse(press("ArrowDown"), on)).toEqual({ use: "browser" });
    expect(keyUse(press("PageDown"), picked)).toEqual({ use: "browser" });
    expect(keyUse(press("ArrowDown"), { ...on, control: true })).toEqual({
      use: "withhold",
    });
  });

  it("Tab and the browser's shortcuts go to the browser and the rest nowhere", () => {
    expect(keyUse(press("Tab"), on)).toEqual({ use: "browser" });
    expect(keyUse(press("l", { ctrl: true }), on)).toEqual({ use: "browser" });
    expect(keyUse(press("r"), on)).toEqual({ use: "withhold" });
    expect(keyUse(press("e", { composing: true }), on)).toEqual({
      use: "withhold",
    });
  });
});
