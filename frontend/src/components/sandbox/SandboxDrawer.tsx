import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { SandboxOperation } from '@/api/types';

import { Sheet } from '../ui/sheet';

import { SandboxPanel } from './SandboxPanel';
import './SandboxDrawer.css';

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
          className="sandbox-drawer__link"
        >
          Full page
          <ExternalLink className="sandbox-drawer__icon" aria-hidden />
        </Link>
      }
    >
      <SandboxPanel preset={preset} compact />
    </Sheet>
  );
}
