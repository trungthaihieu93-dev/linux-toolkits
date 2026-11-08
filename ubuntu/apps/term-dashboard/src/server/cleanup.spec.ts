import { createCleanupRegistry } from './cleanup';

describe('createCleanupRegistry', () => {
  it('runs hooks last-registered first, once', async () => {
    const order: string[] = [];
    const registry = createCleanupRegistry();
    registry.register(() => void order.push('server'));
    registry.register(async () => void order.push('pty'));
    await registry.runAll();
    await registry.runAll();
    expect(order).toEqual(['pty', 'server']);
  });

  it('reports a failing hook and keeps going', async () => {
    const report = vi.fn();
    const ran = vi.fn();
    const registry = createCleanupRegistry(report);
    registry.register(ran);
    registry.register(() => {
      throw new Error('boom');
    });
    await registry.runAll();
    expect(ran).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith('td: cleanup failed: boom');
  });

  it('can unregister a hook', async () => {
    const hook = vi.fn();
    const registry = createCleanupRegistry();
    const unregister = registry.register(hook);
    unregister();
    await registry.runAll();
    expect(hook).not.toHaveBeenCalled();
  });
});
