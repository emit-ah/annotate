// A canvas app that registers its hooks through `window.annotate`, as an app in any language would (ADR-0001).
import { expect, test } from '@playwright/test';
import { standIn } from './service';

test('a click on a canvas pins the item the app names there, with its context', async ({ page }) => {
  const service = await standIn(page);
  await page.goto('/canvas.html');
  await page.keyboard.press('Alt+Shift+A');
  await page.getByRole('button', { name: 'Without pictures' }).click();
  const map = page.locator('canvas');
  await map.click({ position: { x: 250, y: 150 } });
  await expect(page.getByRole('dialog', { name: 'event card c2' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Comment' }).fill('The date is missing.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Annotation 1' })).toBeVisible();
  expect(service.posted[0]).toMatchObject({
    app: 'demo',
    version: '2.0.0-demo',
    target: {
      kind: 'canvas',
      canvas: 'map',
      rect: { width: 0, height: 0 },
      hits: [
        {
          kind: 'card',
          words: 'event card c2',
          details: [
            { name: 'id', value: 'c2' },
            { name: 'type', value: 'event' },
          ],
        },
      ],
    },
    context: { lastTurn: { tool: 'propose_changes', ms: 412 } },
  });
});

test('a region over the canvas holds the items the app names in it', async ({ page }) => {
  const service = await standIn(page);
  await page.goto('/canvas.html');
  await page.keyboard.press('Alt+Shift+A');
  await page.getByRole('button', { name: 'Without pictures' }).click();
  const box = await page.locator('canvas').boundingBox();
  if (box === null) {
    throw new Error('the canvas has no box');
  }
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 390, box.y + 230, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('textbox', { name: 'Comment' }).fill('Too crowded.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Annotation 1' })).toBeVisible();
  const target = service.posted[0]?.['target'] as { kind: string; items: { hits: { words: string }[] }[] };
  expect(target.kind).toBe('region');
  expect(target.items[0]?.hits.map((hit) => hit.words)).toEqual(['note card c1', 'event card c2']);
});
