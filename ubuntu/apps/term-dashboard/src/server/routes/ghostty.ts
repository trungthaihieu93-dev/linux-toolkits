import type { Hono } from 'hono';
import {
  API_PATHS,
  type GhosttyConfigView,
  type GhosttySavePreview,
  type GhosttySaveResult,
  type GhosttySchema,
  type NameList,
} from '@linux-toolchain/term-config';
import {
  parseGhosttySaveRequest,
  type GhosttyService,
} from '../../ghostty/ghostty-service';
import { jsonBody } from './http';

/** `/api/ghostty/{schema,config,themes,fonts}` (GET) and `{preview,save}` (POST). */
export function ghosttyRoutes(app: Hono, g: GhosttyService): void {
  app.get(API_PATHS.ghosttySchema, async (c) =>
    c.json<GhosttySchema>(await g.schema()),
  );
  app.get(API_PATHS.ghosttyConfig, async (c) =>
    c.json<GhosttyConfigView>(await g.config()),
  );
  app.get(API_PATHS.ghosttyThemes, async (c) =>
    c.json<NameList>(await g.themes()),
  );
  app.get(API_PATHS.ghosttyFonts, async (c) =>
    c.json<NameList>(await g.fonts()),
  );
  app.post(API_PATHS.ghosttyPreview, async (c) =>
    c.json<GhosttySavePreview>(
      await g.preview(parseGhosttySaveRequest(await jsonBody(c))),
    ),
  );
  app.post(API_PATHS.ghosttySave, async (c) =>
    c.json<GhosttySaveResult>(
      await g.save(parseGhosttySaveRequest(await jsonBody(c))),
    ),
  );
}
