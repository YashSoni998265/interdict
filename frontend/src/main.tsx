import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { createApiClient } from './api/client';
import { App } from './App';
import { AppProviders } from './app/AppProviders';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const client = await createApiClient();

createRoot(root).render(
  <StrictMode>
    <AppProviders client={client}>
      <App />
    </AppProviders>
  </StrictMode>,
);
