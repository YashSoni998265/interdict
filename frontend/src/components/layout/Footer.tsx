import { useApi } from '@/app/services';

export function Footer() {
  const client = useApi();
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-5 text-2xs text-fg-subtle">
        <span>Interdict · MIT licence</span>
        <span>Synthetic data only · simulation only</span>
        <span>API: {client.mode === 'mock' ? 'recorded fixtures (mock)' : 'live'}</span>
        <span>
          Credits: Online Boutique layout (Apache-2.0), MITRE ATT&CK® labels, React Flow, Eclipse Layout Kernel
        </span>
      </div>
    </footer>
  );
}
