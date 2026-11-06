// A stand-in for the annotation service, behind the page's own `/api/v1/annotations`, which keeps what the page sends.
import type { Page, Route } from '@playwright/test';

/** What the stand-in was sent and keeps. */
export interface Service {
  /** The bodies the page posted. */
  posted: Record<string, unknown>[];
  /** Whether it answers posts for now, else fails as a service that is down. */
  up: boolean;
}

/** An annotation as the service would keep `body`. */
function kept(body: Record<string, unknown>, index: number): Record<string, unknown> {
  const { crop, frame, context, console, ...rest } = body;
  return {
    ...rest,
    id: `0190000${index}`,
    created: '2026-11-06T10:00:00.000Z',
    updated: '2026-11-06T10:00:00.000Z',
    author: 'tester',
    status: 'open',
    has_crop: crop !== undefined,
    has_frame: frame !== undefined,
    has_context: context !== undefined,
    has_console: console !== undefined,
  };
}

/** Answers the page's requests to the service. */
async function answer(service: Service, route: Route): Promise<void> {
  const request = route.request();
  if (request.method() === 'GET') {
    const path = new URL(request.url()).searchParams.get('path');
    const list = service.posted
      .map(kept)
      .filter((each) => each['path'] === path)
      .reverse();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) });
    return;
  }
  if (!service.up) {
    await route.fulfill({ status: 503, contentType: 'application/problem+json', body: '{"detail":"down"}' });
    return;
  }
  const body: unknown = request.postDataJSON();
  if (typeof body !== 'object' || body === null) {
    await route.fulfill({ status: 422, contentType: 'application/problem+json', body: '{"detail":"no JSON"}' });
    return;
  }
  service.posted.push(body as Record<string, unknown>);
  const created = kept(body as Record<string, unknown>, service.posted.length);
  await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) });
}

/** Puts the stand-in behind `page`. */
export async function standIn(page: Page): Promise<Service> {
  const service: Service = { posted: [], up: true };
  await page.route('**/api/v1/annotations**', (route) => answer(service, route));
  return service;
}
