import { getToolchain, type Toolchain } from '@linux-toolchain/toolchains';
import { ScriptedPrompts } from '../testing/helpers';
import {
  isPromptAbort,
  promptChoices,
  promptToolchains,
  resolveChoices,
} from './prompts';

const java = getToolchain('java') as Toolchain;
const go = getToolchain('go') as Toolchain;
const docker = getToolchain('docker') as Toolchain;
const ADDONS = 'Add-ons (recommended are pre-checked)';

describe('promptChoices', () => {
  it('pre-checks the recommended add-ons and default values', async () => {
    const prompts = new ScriptedPrompts();
    const choices = await promptChoices(java, {}, prompts);

    const addons = prompts.calls.find((c) => c.message === ADDONS);
    expect(addons?.kind).toBe('checkbox');
    expect(
      addons?.choices?.filter((c) => c.checked).map((c) => c.value),
    ).toEqual(['maven', 'gradle']);
    const jdk = prompts.calls.find((c) => c.message === 'JDK versions');
    expect(jdk?.choices?.filter((c) => c.checked).map((c) => c.value)).toEqual([
      '21',
    ]);
    expect(choices).toEqual({
      jdk: ['21'],
      default: '21',
      addons: ['maven', 'gradle'],
    });
  });

  it('limits the default JDK to the JDKs chosen just before', async () => {
    const prompts = new ScriptedPrompts()
      .answer('JDK versions', ['25', '17'])
      .answer('Default JDK', '17');
    const choices = await promptChoices(java, {}, prompts);

    const def = prompts.calls.find((c) => c.message === 'Default JDK');
    expect(def?.choices?.map((c) => c.value)).toEqual(['17', '25']);
    // 21 (the catalog default) is not installed, so the highest chosen JDK is preselected.
    expect(def?.default).toBe('25');
    expect(choices).toMatchObject({ jdk: ['17', '25'], default: '17' });
  });

  it('does not ask the default JDK when only one JDK is chosen', async () => {
    const prompts = new ScriptedPrompts().answer('JDK versions', ['17']);
    const choices = await promptChoices(java, {}, prompts);
    expect(prompts.calls.map((c) => c.message)).not.toContain('Default JDK');
    expect(choices['default']).toBe('17');
  });

  it('does not re-ask options set with --opt', async () => {
    const prompts = new ScriptedPrompts();
    const choices = await promptChoices(
      java,
      { jdk: ['17', '21'], addons: ['maven'] },
      prompts,
    );
    expect(prompts.calls.map((c) => c.message)).toEqual(['Default JDK']);
    expect(prompts.calls[0]?.choices?.map((c) => c.value)).toEqual([
      '17',
      '21',
    ]);
    expect(choices).toEqual({
      jdk: ['17', '21'],
      default: '21',
      addons: ['maven'],
    });
  });

  it('skips single-choice selects and asks confirms', async () => {
    const goPrompts = new ScriptedPrompts();
    expect(await promptChoices(go, {}, goPrompts)).toEqual({
      version: 'latest',
      addons: ['gopls', 'golangci-lint'],
    });
    expect(goPrompts.calls.map((c) => c.message)).toEqual([ADDONS]);

    const prompts = new ScriptedPrompts()
      .answer('Add the user to the docker group', false)
      .answer(ADDONS, ['dive', 'lazydocker']);
    // Answers come back in catalog order regardless of pick order.
    expect(await promptChoices(docker, {}, prompts)).toEqual({
      group: false,
      addons: ['lazydocker', 'dive'],
    });
  });

  it('enforces the minimum of a multi option', async () => {
    const prompts = new ScriptedPrompts().answer('JDK versions', []);
    await expect(promptChoices(java, {}, prompts)).rejects.toThrow(
      'select at least 1',
    );
  });
});

describe('resolveChoices', () => {
  it('uses defaults, then --opt overrides', () => {
    expect(resolveChoices(java)).toEqual({
      jdk: ['21'],
      default: '21',
      addons: ['maven', 'gradle'],
    });
    expect(resolveChoices(java, { addons: [] })['addons']).toEqual([]);
  });

  it('moves an unset default JDK onto the chosen JDKs', () => {
    expect(resolveChoices(java, { jdk: ['17'] })['default']).toBe('17');
    expect(resolveChoices(java, { jdk: ['17', '25'] })['default']).toBe('25');
    // An explicit default is kept; the installer warns if it is not installed.
    expect(
      resolveChoices(java, { jdk: ['17'], default: '25' })['default'],
    ).toBe('25');
  });
});

describe('promptToolchains', () => {
  it('offers the whole catalog with descriptions', async () => {
    const prompts = new ScriptedPrompts().answer(
      'Select toolchains to install',
      ['go'],
    );
    expect(await promptToolchains([java, go], prompts)).toEqual(['go']);
    expect(prompts.calls[0]?.choices).toEqual([
      { name: java.label, value: 'java', description: java.description },
      { name: go.label, value: 'go', description: go.description },
    ]);
  });
});

describe('isPromptAbort', () => {
  it('recognises the Ctrl+C error of @inquirer/prompts', () => {
    const abort = new Error('User force closed the prompt');
    abort.name = 'ExitPromptError';
    expect(isPromptAbort(abort)).toBe(true);
    expect(isPromptAbort(new Error('other'))).toBe(false);
  });
});
