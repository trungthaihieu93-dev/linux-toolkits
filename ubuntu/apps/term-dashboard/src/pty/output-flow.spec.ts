import { OutputFlow } from './output-flow';

describe('OutputFlow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    let buffered = 0;
    const pause = vi.fn();
    const resume = vi.fn();
    const flow = new OutputFlow({
      buffered: () => buffered,
      pause,
      resume,
      highWater: 100,
      lowWater: 20,
      pollMs: 10,
    });
    return {
      flow,
      pause,
      resume,
      set: (n: number) => {
        buffered = n;
      },
    };
  }

  it('pauses above the high-water mark and resumes below the low-water mark', () => {
    const { flow, pause, resume, set } = setup();
    set(100);
    flow.sent();
    expect(pause).not.toHaveBeenCalled();
    set(101);
    flow.sent();
    flow.sent();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(flow.paused).toBe(true);
    set(50);
    vi.advanceTimersByTime(50);
    expect(resume).not.toHaveBeenCalled();
    set(20);
    vi.advanceTimersByTime(10);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(flow.paused).toBe(false);
    vi.advanceTimersByTime(100);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('stops polling when disposed while paused', () => {
    const { flow, resume, set } = setup();
    set(500);
    flow.sent();
    flow.dispose();
    set(0);
    vi.advanceTimersByTime(100);
    expect(resume).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
