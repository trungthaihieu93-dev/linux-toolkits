import {
  API_PATHS,
  PTY_SUBPROTOCOL,
  type PtyClientMessage,
  type PtyServerMessage,
} from '@linux-toolchain/term-config';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { RotateCwIcon, TerminalSquareIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StatePanel } from '../../components/state-panel';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useInventory } from '../../app/shell-data';
import { describeError, useApi } from '../../lib/api';
import { useTheme } from '../../lib/theme';

type Session =
  | { state: 'connecting' }
  | { state: 'ready'; pid: number; shell: string }
  | { state: 'exited'; code: number | null; signal: string | null }
  | { state: 'closed'; reason: string };

const ANSI_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
] as const;

/** Same stack as `--font-mono` in global.css (self-hosted JetBrains Mono). */
const TERMINAL_FONT =
  "'JetBrains Mono Variable', ui-monospace, 'SFMono-Regular', monospace";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** xterm theme from the `--term-*` and `--ansi-*` tokens of the active theme. */
export function terminalTheme(
  root: HTMLElement = document.documentElement,
): ITheme {
  const css = getComputedStyle(root);
  const v = (name: string) => css.getPropertyValue(`--${name}`).trim();
  const theme: Record<string, string> = {
    background: v('term-bg'),
    foreground: v('term-fg'),
    cursor: v('term-cursor'),
    cursorAccent: v('term-bg'),
    selectionBackground: v('term-selection'),
  };
  for (const key of ANSI_KEYS) {
    theme[key] = v(`ansi-${key}`);
    theme[`bright${capitalize(key)}`] = v(`ansi-bright-${key}`);
  }
  return theme as ITheme;
}

function ptyUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}${API_PATHS.pty}`;
}

function describeClose(event: CloseEvent): string {
  if (event.code === 1011) return 'td could not start the shell.';
  if (event.code === 1009)
    return 'A message was too large; the connection closed.';
  if (event.code === 1006) return 'The connection to td was lost.';
  return event.reason || `Connection closed (code ${event.code}).`;
}

/**
 * The xterm.js surface and its PTY WebSocket. One shell per mount; the
 * socket (and with it the shell) closes on unmount, on tab close, and on
 * "Reconnect", which starts a new shell.
 */
function TerminalView({ token }: { token: string }) {
  const { theme } = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [session, setSession] = useState<Session>({ state: 'connecting' });
  const [generation, setGeneration] = useState(0);

  // Terminal + socket lifecycle.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      fontFamily: TERMINAL_FONT,
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: !window.matchMedia('(prefers-reduced-motion: reduce)')
        .matches,
      scrollback: 5000,
      allowProposedApi: false,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;

    const encoder = new TextEncoder();
    const ws = new WebSocket(ptyUrl(), [PTY_SUBPROTOCOL, token]);
    ws.binaryType = 'arraybuffer';
    setSession({ state: 'connecting' });

    let last = { cols: 0, rows: 0 };
    const sendSize = () => {
      try {
        fit.fit();
      } catch {
        return; // Hidden or zero-sized host.
      }
      const { cols, rows } = term;
      if (ws.readyState !== WebSocket.OPEN) return;
      if (cols === last.cols && rows === last.rows) return;
      last = { cols, rows };
      const msg: PtyClientMessage = { type: 'resize', cols, rows };
      ws.send(JSON.stringify(msg));
    };

    const observer = new ResizeObserver(() => sendSize());
    observer.observe(host);
    // Measure again once the web font is in, so cell size is right.
    void document.fonts?.ready.then(() => sendSize());

    ws.onopen = () => {
      sendSize();
      term.focus();
    };
    ws.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      if (typeof event.data !== 'string') {
        term.write(new Uint8Array(event.data));
        return;
      }
      let msg: PtyServerMessage;
      try {
        msg = JSON.parse(event.data) as PtyServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        setSession({ state: 'ready', pid: msg.pid, shell: msg.shell });
        sendSize();
      } else if (msg.type === 'exit') {
        setSession({ state: 'exited', code: msg.code, signal: msg.signal });
      } else {
        setSession({ state: 'closed', reason: msg.message });
      }
    };
    ws.onclose = (event) => {
      setSession((s) =>
        s.state === 'exited' || s.state === 'closed'
          ? s
          : { state: 'closed', reason: describeClose(event) },
      );
    };

    const send = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encoder.encode(data));
    };
    const onData = term.onData(send);
    const onBinary = term.onBinary((data) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const bytes = Uint8Array.from(data, (c) => c.charCodeAt(0) & 0xff);
      ws.send(bytes);
    });

    // Closing the tab closes the socket; td then ends the shell session.
    const onUnload = () => ws.close(1000, 'page closed');
    window.addEventListener('pagehide', onUnload);

    return () => {
      window.removeEventListener('pagehide', onUnload);
      observer.disconnect();
      onData.dispose();
      onBinary.dispose();
      ws.onclose = null;
      ws.close(1000, 'terminal closed');
      term.dispose();
      termRef.current = null;
    };
  }, [token, generation]);

  // Follow the app theme.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = terminalTheme();
  }, [theme]);

  const reconnect = useCallback(() => setGeneration((n) => n + 1), []);
  const ended = session.state === 'exited' || session.state === 'closed';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        className="flex min-h-9 flex-wrap items-center gap-2"
        aria-live="polite"
      >
        {session.state === 'connecting' && (
          <Badge variant="warn">connecting</Badge>
        )}
        {session.state === 'ready' && (
          <>
            <Badge variant="run">live</Badge>
            <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
              {session.shell} · pid {session.pid}
            </span>
          </>
        )}
        {session.state === 'exited' && (
          <>
            <Badge variant={session.code === 0 ? 'muted' : 'destructive'}>
              {session.code !== null
                ? `exit ${session.code}`
                : (session.signal ?? 'ended')}
            </Badge>
            <span className="text-sm text-muted-foreground">
              The shell ended.
            </span>
          </>
        )}
        {session.state === 'closed' && (
          <>
            <Badge variant="destructive">disconnected</Badge>
            <span className="min-w-0 text-sm text-muted-foreground">
              {session.reason}
            </span>
          </>
        )}
        {ended && (
          <Button size="sm" className="ml-auto" onClick={reconnect}>
            <RotateCwIcon aria-hidden />
            Reconnect
          </Button>
        )}
      </div>
      <div
        className="min-h-64 flex-1 overflow-hidden rounded-lg border bg-term-bg p-2"
        role="region"
        aria-label="Terminal"
      >
        <div ref={hostRef} className="size-full" />
      </div>
    </div>
  );
}

export function TerminalPage() {
  const api = useApi();
  const inventory = useInventory();

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <TerminalSquareIcon
          className="size-5 text-muted-foreground"
          aria-hidden
        />
        <h1 className="font-mono text-xl font-semibold">Terminal</h1>
      </div>
      {inventory.status === 'loading' && (
        <StatePanel tone="loading" title="Checking the terminal backend…" />
      )}
      {inventory.status === 'error' && (
        <StatePanel
          tone="error"
          title="Could not check the terminal backend"
          action={
            <Button variant="outline" size="sm" onClick={inventory.reload}>
              <RotateCwIcon aria-hidden />
              Retry
            </Button>
          }
        >
          {describeError(inventory.error, 'the inventory the terminal needs')}
        </StatePanel>
      )}
      {inventory.status === 'ready' && !inventory.data.pty.available && (
        <StatePanel tone="error" title="Terminal unavailable">
          {inventory.data.pty.reason ??
            'td cannot start a terminal on this machine.'}
        </StatePanel>
      )}
      {inventory.status === 'ready' && inventory.data.pty.available && (
        <TerminalView token={api.token} />
      )}
    </div>
  );
}
