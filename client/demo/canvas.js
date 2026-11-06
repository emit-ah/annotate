// A canvas app's hooks, registered through the global API as any language would (ADR-0001): what lies under a point,
// the build's version and a context of the app's own.
const cards = [
  {
    id: "c1",
    type: "note",
    title: "Groceries",
    x: 20,
    y: 20,
    width: 160,
    height: 80,
  },
  {
    id: "c2",
    type: "event",
    title: "Dentist",
    x: 220,
    y: 120,
    width: 160,
    height: 80,
  },
];

const canvas = document.getElementById("map");
const context = canvas.getContext("2d");
for (const card of cards) {
  context.fillStyle = card.type === "note" ? "#fde68a" : "#bfdbfe";
  context.fillRect(card.x, card.y, card.width, card.height);
  context.fillStyle = "#111827";
  context.fillText(card.title, card.x + 8, card.y + 20);
}

const inside = (card, rect) =>
  rect.x < card.x + card.width &&
  rect.x + Math.max(rect.width, 1) > card.x &&
  rect.y < card.y + card.height &&
  rect.y + Math.max(rect.height, 1) > card.y;

window.annotate.configure({ version: "2.0.0-demo" });
window.annotate.register("canvas", ({ canvas: name, rect }) =>
  name !== "map"
    ? []
    : cards
        .filter((card) => inside(card, rect))
        .map((card) => ({
          kind: "card",
          words: `${card.type} card ${card.id}`,
          details: [
            { name: "id", value: card.id },
            { name: "type", value: card.type },
          ],
        })),
);
window.annotate.register("context", () => ({
  lastTurn: { tool: "propose_changes", ms: 412 },
}));
