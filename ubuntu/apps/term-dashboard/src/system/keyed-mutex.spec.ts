import { KeyedMutex } from './keyed-mutex';

const tick = () => new Promise((r) => setTimeout(r, 1));

describe('KeyedMutex', () => {
  it('runs tasks with the same key one at a time, in call order', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name} start`);
      await tick();
      log.push(`${name} end`);
      return name;
    };
    const results = await Promise.all([
      mutex.run('a', task('one')),
      mutex.run('a', task('two')),
      mutex.run('a', task('three')),
    ]);
    expect(results).toEqual(['one', 'two', 'three']);
    expect(log).toEqual([
      'one start',
      'one end',
      'two start',
      'two end',
      'three start',
      'three end',
    ]);
  });

  it('runs different keys concurrently', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    await Promise.all(
      ['a', 'b'].map((key) =>
        mutex.run(key, async () => {
          log.push(`${key} start`);
          await tick();
          log.push(`${key} end`);
        }),
      ),
    );
    expect(log.slice(0, 2).sort()).toEqual(['a start', 'b start']);
  });

  it('releases the lock when a task fails', async () => {
    const mutex = new KeyedMutex();
    await expect(
      mutex.run('a', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(mutex.run('a', async () => 'next')).resolves.toBe('next');
  });

  it('holds several keys at once without deadlocking on overlap', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    const hold = (keys: string[], name: string) =>
      mutex.runAll(keys, async () => {
        log.push(`${name} start`);
        await tick();
        log.push(`${name} end`);
      });
    await Promise.all([
      hold(['a', 'b'], 'ab'),
      hold(['b', 'a'], 'ba'),
      mutex.run('b', async () => {
        log.push('b start');
        log.push('b end');
      }),
    ]);
    expect(log).toHaveLength(6);
    // Never two tasks inside the lock at once: starts and ends alternate.
    log.forEach((entry, i) =>
      expect(entry.endsWith(i % 2 === 0 ? 'start' : 'end')).toBe(true),
    );
  });
});
