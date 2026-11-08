import type { Context, Hono } from 'hono';
import {
  API_PATHS,
  type BackupContent,
  type BackupsView,
  type GSettingsRestoreResult,
  type SavePreview,
  type SaveResult,
} from '@linux-toolchain/term-config';
import { previewWrite } from '../../files/preview';
import type { Services } from '../services';
import { fileIdOf, mtimeField, optionalObjectBody, tsParam } from './http';

const FILE = '/api/backups/files/:fileId/:ts';

const fileParams = (c: Context) => ({
  fileId: fileIdOf(c.req.param('fileId')),
  ts: tsParam(c),
});

/**
 * - `GET /api/backups` → `BackupsView`
 * - `GET files/:fileId/:ts` → `BackupContent`
 * - `POST files/:fileId/:ts/preview` → `SavePreview` (restoring it)
 * - `POST files/:fileId/:ts/restore`, optional body `BackupRestoreRequest` → `SaveResult`
 * - `POST gsettings/:ts/restore` → `GSettingsRestoreResult`
 */
export function backupRoutes(app: Hono, s: Services): void {
  app.get(API_PATHS.backups, async (c) =>
    c.json<BackupsView>({
      dir: s.files.backupsDir,
      files: await s.files.listBackups(),
      gsettings: await s.gsettings.listBackups(),
    }),
  );
  app.get(FILE, async (c) => {
    const { fileId, ts } = fileParams(c);
    return c.json<BackupContent>(await s.files.readBackup(fileId, ts));
  });
  app.post(`${FILE}/preview`, async (c) => {
    const { fileId, ts } = fileParams(c);
    const { content } = await s.files.readBackup(fileId, ts);
    return c.json<SavePreview>(await previewWrite(s.files, fileId, content));
  });
  app.post(`${FILE}/restore`, async (c) => {
    const { fileId, ts } = fileParams(c);
    const body = await optionalObjectBody(c);
    const base = 'baseMtimeMs' in body ? mtimeField(body) : undefined;
    return c.json<SaveResult>(await s.files.restore(fileId, ts, base));
  });
  app.post('/api/backups/gsettings/:ts/restore', async (c) =>
    c.json<GSettingsRestoreResult>(await s.gsettings.restore(tsParam(c))),
  );
}
