import { stripVTControlCharacters } from 'node:util';
import { createLogger } from './logger';

describe('logger', () => {
  it('writes ==> to stdout and [warn]/[error] to stderr', () => {
    let out = '';
    let err = '';
    const log = createLogger(
      { write: (s: string) => (out += s) },
      { write: (s: string) => (err += s) },
    );
    log.log('Installing Go');
    log.warn('careful');
    log.error('broken');
    expect(stripVTControlCharacters(out)).toBe('==> Installing Go\n');
    expect(stripVTControlCharacters(err)).toBe(
      '[warn] careful\n[error] broken\n',
    );
  });
});
