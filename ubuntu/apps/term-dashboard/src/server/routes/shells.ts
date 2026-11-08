import type { Hono } from 'hono';
import type {
  OhMyZshCatalog,
  SavePreview,
  SaveResult,
  ShellFileView,
} from '@linux-toolchain/term-config';
import { MAX_FILE_BYTES } from '../../files/file-store';
import {
  parseShellBlockModel,
  type ShellService,
} from '../../shell/shell-service';
import {
  fileIdOf,
  mtimeField,
  objectBody,
  shellParam,
  stringField,
} from './http';

const BASE = '/api/shells/:shell';

/**
 * - `GET files/:fileId` → `ShellFileView`
 * - `POST config/{preview|save}` (`ShellConfigSaveRequest`) → `SavePreview` / `SaveResult`
 * - `POST raw/{preview|save}` (`ShellRawSaveRequest`) → `SavePreview` / `SaveResult`
 * - `GET oh-my-zsh` → `OhMyZshCatalog` (zsh only)
 */
export function shellRoutes(app: Hono, shells: ShellService): void {
  app.get(`${BASE}/files/:fileId`, async (c) =>
    c.json<ShellFileView>(
      await shells.fileView(shellParam(c), fileIdOf(c.req.param('fileId'))),
    ),
  );

  app.post(`${BASE}/config/preview`, async (c) => {
    const shell = shellParam(c);
    const body = await objectBody(c);
    return c.json<SavePreview>(
      await shells.previewConfig(
        shell,
        fileIdOf(body['fileId']),
        parseShellBlockModel(body['model']),
      ),
    );
  });
  app.post(`${BASE}/config/save`, async (c) => {
    const shell = shellParam(c);
    const body = await objectBody(c);
    return c.json<SaveResult>(
      await shells.saveConfig(
        shell,
        fileIdOf(body['fileId']),
        parseShellBlockModel(body['model']),
        mtimeField(body),
      ),
    );
  });

  app.post(`${BASE}/raw/preview`, async (c) => {
    const shell = shellParam(c);
    const body = await objectBody(c);
    return c.json<SavePreview>(
      await shells.previewRaw(
        shell,
        fileIdOf(body['fileId']),
        stringField(body, 'content', MAX_FILE_BYTES),
      ),
    );
  });
  app.post(`${BASE}/raw/save`, async (c) => {
    const shell = shellParam(c);
    const body = await objectBody(c);
    return c.json<SaveResult>(
      await shells.saveRaw(
        shell,
        fileIdOf(body['fileId']),
        stringField(body, 'content', MAX_FILE_BYTES),
        mtimeField(body),
      ),
    );
  });

  app.get(`${BASE}/oh-my-zsh`, async (c) =>
    c.json<OhMyZshCatalog>(await shells.ohMyZshCatalog(shellParam(c))),
  );
}
