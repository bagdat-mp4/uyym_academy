import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './management.css';
import './dark-surfaces.css';
import './appearance.css';
import './design-system.css';
import './course-hero.css';
import './neo-system.css';
import './landing-flow.css';
import './player-controls.css';
import './protected-player.css';
import './group-enrollment.css';
import {savedLanguage,savedTheme,preferenceStorage} from './i18n';
import {applyTheme} from './theme';

document.documentElement.lang=savedLanguage(preferenceStorage);
applyTheme(savedTheme(preferenceStorage));

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
