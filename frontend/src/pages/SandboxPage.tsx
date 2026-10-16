import { Footer } from '@/components/layout/Footer';
import { SandboxPanel } from '@/components/sandbox/SandboxPanel';

export default function SandboxPage() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-fg">Break it yourself</h1>
          <p className="mt-1 max-w-2xl text-ui text-fg-muted">
            Make a typed change to your private copy of the graph, then re-run an investigation and watch the verdicts
            recompute. Every change bumps the sandbox revision, so certificates issued earlier stop being current.
            Nothing outside your sandbox changes.
          </p>
        </header>
        <SandboxPanel />
      </div>
      <Footer />
    </div>
  );
}
