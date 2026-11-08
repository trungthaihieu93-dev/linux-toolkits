import type { Context, Hono } from 'hono';
import type {
  GSettingsSchemaView,
  NameList,
  ProfileCreated,
  TerminalProfilesView,
} from '@linux-toolchain/term-config';
import { badRequest } from '../../errors';
import type {
  GSettingsService,
  SchemaTarget,
} from '../../gsettings/gsettings-service';
import { kindParam, objectBody, optionalObjectBody } from './http';

const BASE = '/api/terminals/:kind';

/** The schema a route addresses; profile uuids are validated by the service. */
function target(
  c: Context,
  part: 'global' | 'shortcuts' | 'profile',
): SchemaTarget {
  if (part !== 'profile') return { part };
  const uuid = c.req.param('uuid');
  if (typeof uuid !== 'string') throw badRequest('missing profile uuid');
  return { part, uuid };
}

/**
 * `/api/terminals/:kind/...` for Ptyxis and GNOME Terminal:
 * - `GET {global|shortcuts|profiles/:uuid}` → `GSettingsSchemaView`
 * - `PUT` same, body `GSettingsSetRequest` → updated view
 * - `POST .../reset`, body `GSettingsResetRequest` → updated view
 * - `GET profiles` → `TerminalProfilesView`; `POST profiles` (`CreateProfileRequest`) → 201 `ProfileCreated`
 * - `POST profiles/:uuid/duplicate` (`DuplicateProfileRequest`) → 201 `ProfileCreated`
 * - `PUT profiles/:uuid/default` → 204; `DELETE profiles/:uuid` → 204 (422 for the default)
 * - `GET palettes` → `NameList` (Ptyxis only; 404 for GNOME Terminal)
 */
export function gsettingsRoutes(app: Hono, gs: GSettingsService): void {
  for (const [part, path] of [
    ['global', `${BASE}/global`],
    ['shortcuts', `${BASE}/shortcuts`],
    ['profile', `${BASE}/profiles/:uuid`],
  ] as const) {
    app.get(path, async (c) =>
      c.json<GSettingsSchemaView>(await gs.view(kindParam(c), target(c, part))),
    );
    app.put(path, async (c) => {
      const kind = kindParam(c);
      const t = target(c, part);
      const body = await objectBody(c);
      return c.json<GSettingsSchemaView>(
        await gs.setAndView(kind, t, body['key'], body['value']),
      );
    });
    app.post(`${path}/reset`, async (c) => {
      const kind = kindParam(c);
      const t = target(c, part);
      const body = await objectBody(c);
      return c.json<GSettingsSchemaView>(
        await gs.resetAndView(kind, t, body['key']),
      );
    });
  }

  app.get(`${BASE}/palettes`, async (c) =>
    c.json<NameList>({ names: await gs.palettes(kindParam(c)) }),
  );
  app.get(`${BASE}/profiles`, async (c) =>
    c.json<TerminalProfilesView>(await gs.profiles(kindParam(c))),
  );
  app.post(`${BASE}/profiles`, async (c) => {
    const kind = kindParam(c);
    const body = await objectBody(c);
    const uuid = await gs.createProfile(kind, body['label']);
    return c.json<ProfileCreated>({ uuid }, 201);
  });
  app.post(`${BASE}/profiles/:uuid/duplicate`, async (c) => {
    const kind = kindParam(c);
    const { uuid } = target(c, 'profile') as { uuid: string };
    const body = await optionalObjectBody(c);
    const copy = await gs.duplicateProfile(kind, uuid, body['label']);
    return c.json<ProfileCreated>({ uuid: copy }, 201);
  });
  app.put(`${BASE}/profiles/:uuid/default`, async (c) => {
    const kind = kindParam(c);
    const { uuid } = target(c, 'profile') as { uuid: string };
    await gs.setDefaultProfile(kind, uuid);
    return c.body(null, 204);
  });
  app.delete(`${BASE}/profiles/:uuid`, async (c) => {
    const kind = kindParam(c);
    const { uuid } = target(c, 'profile') as { uuid: string };
    await gs.deleteProfile(kind, uuid);
    return c.body(null, 204);
  });
}
