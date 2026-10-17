import { useApi } from '@/app/services';
import './Footer.css';

export function Footer() {
  const client = useApi();
  return (
    <footer className="footer">
      <div className="footer__row">
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
