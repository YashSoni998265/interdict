import { Footer } from '@/components/layout/Footer';
import { SandboxPanel } from '@/components/sandbox/SandboxPanel';
import './SandboxPage.css';

export default function SandboxPage() {
  return (
    <div className="sandbox-page">
      <div className="sandbox-page__block">
        <header>
          <h1 className="sandbox-page__heading">Break it yourself</h1>
          <p className="sandbox-page__text">
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
