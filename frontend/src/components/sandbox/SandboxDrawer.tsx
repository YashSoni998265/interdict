import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { SandboxOperation } from '@/api/types';

import { Sheet } from '../ui/sheet';

import { SandboxPanel } from './SandboxPanel';

export function SandboxDrawer({
  open,
  onOpenChange,
  preset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset?: SandboxOperation | undefined;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      title="Break it yourself"
      description="Make a typed change to your private copy of the graph, then re-run an investigation and watch the verdicts recompute. Nothing outside your sandbox changes."
      headerExtra={
        <Link
          to="/sandbox"
          onClick={() => onOpenChange(false)}
          className="mt-0.5 inline-flex items-center gap-1 rounded text-2xs text-fg-muted hover:text-fg"
        >
          Full page
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      }
    >
      <SandboxPanel preset={preset} compact />
    </Sheet>
  );
}
