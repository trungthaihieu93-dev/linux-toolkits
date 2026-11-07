import { RecordingRunner, type Logger } from '@linux-toolchain/core';
import { createInstallContext } from './install-context';

describe('createInstallContext', () => {
  const ctx = { isRoot: true, user: 'alice', home: '/home/alice' };

  it('collects warnings and forwards them to the logger', () => {
    const logged: string[] = [];
    const logger: Logger = { log: () => undefined, warn: (m) => logged.push(m), error: () => undefined };
    const ic = createInstallContext({ runner: new RecordingRunner(), ctx, logger });
    ic.warn('dive failed');
    ic.warn('hadolint failed');
    expect(ic.warnings).toEqual(['dive failed', 'hadolint failed']);
    expect(logged).toEqual(ic.warnings);
    expect(ic.yes).toBe(false);
  });

  it('uses real fs probes by default and injected ones when given', () => {
    const logger: Logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    const real = createInstallContext({ runner: new RecordingRunner(), ctx, logger });
    expect(real.exists('/')).toBe(true);
    expect(real.listDir('/no/such/dir/linux-toolchain')).toEqual([]);
    const fake = createInstallContext({
      runner: new RecordingRunner(),
      ctx,
      logger,
      yes: true,
      exists: () => false,
      listDir: () => ['x'],
    });
    expect(fake.exists('/')).toBe(false);
    expect(fake.listDir('/')).toEqual(['x']);
    expect(fake.yes).toBe(true);
  });
});
