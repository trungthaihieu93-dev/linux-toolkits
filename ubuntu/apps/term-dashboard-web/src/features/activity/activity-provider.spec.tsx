// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { ApiContext, type ApiClient } from '../../lib/api';
import { ActivityProvider } from './activity-provider';

afterEach(cleanup);

/** An API whose activity fetch never ends; records each call's signal. */
function streamingApi(signals: AbortSignal[]): ApiClient {
  const fetch = (_path: string, init?: RequestInit) => {
    if (init?.signal) signals.push(init.signal);
    return Promise.resolve(
      new Response(new ReadableStream(), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
  };
  return { fetch } as unknown as ApiClient;
}

function pageTransition(type: 'pagehide' | 'pageshow', persisted: boolean) {
  const event = new Event(type) as PageTransitionEvent;
  Object.defineProperty(event, 'persisted', { value: persisted });
  window.dispatchEvent(event);
}

describe('ActivityProvider', () => {
  it('closes the stream on pagehide and reopens it when the page comes back', async () => {
    const signals: AbortSignal[] = [];
    render(
      <ApiContext.Provider value={streamingApi(signals)}>
        <ActivityProvider onUnauthorized={() => undefined}>
          <span />
        </ActivityProvider>
      </ApiContext.Provider>,
    );
    await act(() => Promise.resolve());
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    act(() => pageTransition('pagehide', true));
    expect(signals[0].aborted).toBe(true);

    await act(async () => pageTransition('pageshow', true));
    expect(signals).toHaveLength(2);
    expect(signals[1].aborted).toBe(false);

    // A normal first show (not from the cache) does not open a second stream.
    await act(async () => pageTransition('pageshow', false));
    expect(signals).toHaveLength(2);
  });
});
