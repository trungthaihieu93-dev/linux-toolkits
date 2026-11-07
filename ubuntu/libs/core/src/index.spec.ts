import { coreName } from './index';

describe('@linux-toolchain/core', () => {
  it('exposes its package name', () => {
    expect(coreName).toBe('@linux-toolchain/core');
  });
});
