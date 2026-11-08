import { MoonIcon, SunIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import { useTheme } from '../../lib/theme';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} theme`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          onClick={() => setTheme(next)}
        >
          {theme === 'dark' ? (
            <SunIcon aria-hidden />
          ) : (
            <MoonIcon aria-hidden />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
