// The shared tab: Chromium accepts the request to share this tab by itself (`--auto-accept-this-tab-capture`).
import { expect, test } from '@playwright/test';
import { standIn } from './service';

test.use({ channel: 'chromium', launchOptions: { args: ['--auto-accept-this-tab-capture'] } });

test('with the tab shared, an annotation keeps a crop and the window, and redacted parts are painted over', async ({
  page,
}) => {
  const service = await standIn(page);
  await page.goto('/');
  await page.keyboard.press('Alt+Shift+A');
  await page.getByRole('button', { name: 'Share this tab' }).click();
  await expect(page.getByRole('region', { name: 'Annotating' })).toContainText('Tab shared');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('img', { name: 'What you saw around it, from the shared tab' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Comment' }).fill('Fine.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Annotation 1' })).toBeVisible();
  const posted = service.posted[0] ?? {};
  for (const picture of ['crop', 'frame']) {
    const bytes = Buffer.from(String(posted[picture]), 'base64');
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  }
  const balance = await page.getByRole('region', { name: 'Balance' }).boundingBox();
  if (balance === null) {
    throw new Error('the balance has no box');
  }
  // The window is kept at half its size; the middle of the redacted balance is black there.
  const pixel = await page.evaluate(
    async ({ frame, x, y }) => {
      const bytes = Uint8Array.from(atob(frame), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      context?.drawImage(bitmap, 0, 0);
      return Array.from(context?.getImageData(x, y, 1, 1).data ?? []);
    },
    {
      frame: String(posted['frame']),
      x: Math.round((balance.x + balance.width / 2) / 2),
      y: Math.round((balance.y + balance.height / 2) / 2),
    },
  );
  expect(pixel).toEqual([0, 0, 0, 255]);
});
