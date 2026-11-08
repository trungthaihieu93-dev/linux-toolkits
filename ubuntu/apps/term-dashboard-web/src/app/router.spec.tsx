// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { RouterProvider, useRouter } from './router';

type Router = ReturnType<typeof useRouter>;

function mount() {
  const ref: { current: Router | null } = { current: null };
  function Probe() {
    const router = useRouter();
    useEffect(() => {
      ref.current = router;
    });
    return <output aria-label="path">{router.path}</output>;
  }
  const view = render(
    <RouterProvider>
      <Probe />
    </RouterProvider>,
  );
  const router = () => {
    if (!ref.current) throw new Error('router not mounted');
    return ref.current;
  };
  const shown = () => view.getByLabelText('path').textContent;
  return { router, shown };
}

/** Lets jsdom run its queued history traversals and their popstate. */
const traversed = () => act(() => new Promise((r) => setTimeout(r, 20)));

afterEach(cleanup);

describe('RouterProvider back/forward guard', () => {
  it('holds a back step without adding or cutting history entries', async () => {
    window.history.replaceState(null, '', '/');
    const { router, shown } = mount();
    act(() => router().navigate('/a'));
    act(() => router().navigate('/b'));
    const length = window.history.length;

    let proceed: (() => void) | null = null;
    const unblock = router().block((go) => {
      proceed = go;
      return true;
    });

    window.history.back();
    await traversed();
    await traversed();
    expect(proceed).not.toBeNull();
    expect(window.location.pathname).toBe('/b');
    expect(shown()).toBe('/b');
    expect(window.history.length).toBe(length);

    unblock();
    act(() => proceed?.());
    await waitFor(() => expect(shown()).toBe('/a'));
    expect(window.location.pathname).toBe('/a');
    expect(window.history.length).toBe(length);

    // The forward entry is still there.
    window.history.forward();
    await waitFor(() => expect(shown()).toBe('/b'));
    expect(window.history.length).toBe(length);
  });

  it('holds a forward step and keeps the rest of the forward stack', async () => {
    window.history.replaceState(null, '', '/');
    const { router, shown } = mount();
    act(() => router().navigate('/a'));
    act(() => router().navigate('/b'));
    act(() => router().navigate('/c'));
    window.history.go(-2);
    await waitFor(() => expect(shown()).toBe('/a'));
    const length = window.history.length;

    let proceed: (() => void) | null = null;
    const unblock = router().block((go) => {
      proceed = go;
      return true;
    });
    window.history.forward();
    await traversed();
    await traversed();
    expect(window.location.pathname).toBe('/a');
    expect(shown()).toBe('/a');

    unblock();
    act(() => proceed?.());
    await waitFor(() => expect(shown()).toBe('/b'));
    window.history.forward();
    await waitFor(() => expect(shown()).toBe('/c'));
    expect(window.history.length).toBe(length);
  });

  it('lets a step through when the blocker does not hold it', async () => {
    window.history.replaceState(null, '', '/');
    const { router, shown } = mount();
    act(() => router().navigate('/a'));
    router().block(() => false);
    window.history.back();
    await waitFor(() => expect(shown()).toBe('/'));
    expect(window.location.pathname).toBe('/');
  });
});
