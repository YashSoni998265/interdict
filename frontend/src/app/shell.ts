import { createContext } from 'react';

import type { SandboxOperation } from '@/api/types';

export interface ShellActions {
  /** Open the sandbox drawer, optionally pre-filled with an operation. */
  openSandbox(preset?: SandboxOperation): void;
}

export const ShellContext = createContext<ShellActions>({ openSandbox: () => undefined });
