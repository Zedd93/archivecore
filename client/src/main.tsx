import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n/config';
import './styles/index.css';
import { applyThemePreference, getStoredThemePreference } from './utils/theme';

applyThemePreference(getStoredThemePreference());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
