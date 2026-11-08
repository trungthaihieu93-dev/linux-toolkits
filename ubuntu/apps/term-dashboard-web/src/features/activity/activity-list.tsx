import {
  ArrowDownToLineIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  LoaderCircleIcon,
} from 'lucide-react';
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { quoteArgv, type ActivityCommand } from '../../lib/activity';
import { formatBytes, formatClock, formatDuration } from '../../lib/format';
import { cn } from '../../lib/utils';

/** Within this many px of the bottom counts as "following" the stream. */
const STICK_PX = 24;

export function StatusBadge({ cmd }: { cmd: ActivityCommand }) {
  if (cmd.status === 'running') {
    return (
      <Badge variant="run">
        <LoaderCircleIcon className="animate-spin" aria-hidden />
        running
      </Badge>
    );
  }
  const label =
    cmd.code !== null ? `exit ${cmd.code}` : (cmd.signal ?? 'failed');
  return (
    <Badge variant={cmd.status === 'ok' ? 'run' : 'destructive'}>{label}</Badge>
  );
}

function CopyCommand({ argv }: { argv: string[] }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(quoteArgv(argv)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={copy}
      aria-label={copied ? 'Command copied' : 'Copy command'}
      title={copied ? 'Copied' : 'Copy command'}
    >
      {copied ? (
        <CheckIcon aria-hidden className="text-run" />
      ) : (
        <CopyIcon aria-hidden />
      )}
    </Button>
  );
}

const CommandRow = memo(function CommandRow({
  cmd,
  expanded,
  onToggle,
}: {
  cmd: ActivityCommand;
  expanded: boolean;
  onToggle: (id: string) => void;
}) {
  const line = cmd.argv.join(' ');
  const outputId = `activity-output-${cmd.id}`;
  return (
    <li className="border-b last:border-b-0" data-testid="activity-row">
      <div className="flex min-h-10 items-center gap-2 px-2 py-0.5 sm:px-3">
        <button
          type="button"
          onClick={() => onToggle(cmd.id)}
          aria-expanded={expanded}
          aria-controls={expanded ? outputId : undefined}
          className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left transition-colors duration-150 hover:text-link focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-150',
              expanded && 'rotate-90',
            )}
          />
          <span className="sr-only">
            {expanded ? 'Hide output of' : 'Show output of'}
          </span>
          <code className="min-w-0 flex-1 truncate font-mono text-[0.8125rem]">
            <span aria-hidden className="text-muted-foreground">
              ${' '}
            </span>
            {line}
          </code>
        </button>
        <StatusBadge cmd={cmd} />
        <span className="hidden w-16 text-right font-mono text-xs tabular-nums text-muted-foreground sm:inline">
          {cmd.durationMs !== null ? formatDuration(cmd.durationMs) : '…'}
        </span>
        <time
          dateTime={new Date(cmd.startedAt).toISOString()}
          className="hidden font-mono text-xs tabular-nums text-muted-foreground md:inline"
        >
          {formatClock(cmd.startedAt)}
        </time>
        <CopyCommand argv={cmd.argv} />
      </div>
      {expanded && (
        <div id={outputId} className="px-2 pb-2 sm:px-3">
          {cmd.cwd && (
            <p className="mb-1 font-mono text-xs text-muted-foreground">
              cwd {cmd.cwd}
            </p>
          )}
          <pre
            tabIndex={0}
            aria-label={`Output of ${line}`}
            className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-background p-2 font-mono text-xs leading-relaxed"
          >
            {cmd.output.length === 0 && !cmd.error && (
              <span className="text-muted-foreground">
                {cmd.status === 'running'
                  ? 'Waiting for output…'
                  : 'No output.'}
              </span>
            )}
            {cmd.output.map((chunk, i) =>
              chunk.truncatedBytes !== undefined ? (
                <span key={i} className="block italic text-warn">
                  [{formatBytes(chunk.truncatedBytes)} of output not shown]{' '}
                  {chunk.text}
                </span>
              ) : (
                <span
                  key={i}
                  data-stream={chunk.stream}
                  className={
                    chunk.stream === 'stderr' ? 'text-destructive' : undefined
                  }
                >
                  {chunk.text}
                </span>
              ),
            )}
            {cmd.error && (
              <span className="block text-destructive">{cmd.error}</span>
            )}
          </pre>
        </div>
      )}
    </li>
  );
});

interface ActivityListProps {
  commands: readonly ActivityCommand[];
  /** Empty-state text. */
  emptyText?: string;
  className?: string;
}

/**
 * One row per backend command with expandable output. Follows new output
 * while scrolled to the bottom; scrolling up pauses that until the user
 * jumps back.
 */
export function ActivityList({
  commands,
  emptyText = 'No commands yet. Everything td runs appears here live.',
  className,
}: ActivityListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // Stick to the bottom after every change while following.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  });

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
    if (atBottom !== follow) setFollow(atBottom);
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={cn('relative min-h-0', className)}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative h-full overflow-y-auto"
        data-testid="activity-scroll"
      >
        {commands.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul aria-label="Commands" className="pb-1">
            {commands.map((cmd) => (
              <CommandRow
                key={cmd.id}
                cmd={cmd}
                expanded={expanded.has(cmd.id)}
                onToggle={toggle}
              />
            ))}
          </ul>
        )}
      </div>
      {!follow && commands.length > 0 && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute right-3 bottom-3 border shadow-md"
          onClick={() => {
            setFollow(true);
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          <ArrowDownToLineIcon aria-hidden />
          Jump to latest
        </Button>
      )}
    </div>
  );
}
