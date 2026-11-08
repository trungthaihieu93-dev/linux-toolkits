import type { Hono } from 'hono';
import { API_PATHS, type Settings } from '@linux-toolchain/term-config';
import type { SettingsStore } from '../../settings/settings-store';
import { jsonBody } from './http';

/** `GET /api/settings`, `PUT /api/settings` (partial update, validated). */
export function settingsRoutes(app: Hono, settings: SettingsStore): void {
  app.get(API_PATHS.settings, async (c) =>
    c.json<Settings>(await settings.read()),
  );
  app.put(API_PATHS.settings, async (c) =>
    c.json<Settings>(await settings.update(await jsonBody(c))),
  );
}
