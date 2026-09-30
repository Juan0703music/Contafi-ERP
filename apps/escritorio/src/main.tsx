import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@contafi/ui/contafi.css';
import './app.css';
import { App } from './App.tsx';
import { aplicarApariencia } from './apariencia.ts';

aplicarApariencia();
createRoot(document.getElementById('app')!).render(<StrictMode><App /></StrictMode>);
