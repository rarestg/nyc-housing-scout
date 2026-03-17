import React from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardApp } from './DashboardApp.jsx';

const container = document.querySelector('#root');

if (!container) {
  throw new Error('Dashboard root element was not found.');
}

createRoot(container).render(
  <React.StrictMode>
    <DashboardApp />
  </React.StrictMode>,
);
