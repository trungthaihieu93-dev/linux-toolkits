import { toolchainsName } from './index';

describe('@linux-toolchain/toolchains', () => {
  it('exposes its package name', () => {
    expect(toolchainsName).toBe('@linux-toolchain/toolchains');
  });
});
