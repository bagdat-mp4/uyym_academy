import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './management.css';
import './dark-surfaces.css';
import './appearance.css';
import './design-system.css';
import {savedLanguage,savedTheme,preferenceStorage} from './i18n';

document.documentElement.lang=savedLanguage(preferenceStorage);
document.documentElement.dataset.theme=savedTheme(preferenceStorage);

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
