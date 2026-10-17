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
            Change your private copy of the graph and watch the proof react: certificates issued earlier stop being
            current, and the next investigation plans from the changed graph. Nothing outside your sandbox changes.
          </p>
        </header>
        <SandboxPanel />
      </div>
      <Footer />
    </div>
  );
}
