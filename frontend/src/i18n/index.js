import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import tr from './tr.js';
import en from './en.js';
import ru from './ru.js';
import ar from './ar.js';
import fr from './fr.js';

i18n.use(initReactI18next).init({
  resources: { tr, en, ru, ar, fr },
  lng: localStorage.getItem('gd360-lang') || 'tr',
  fallbackLng: 'tr',
  interpolation: { escapeValue: false },
});

export default i18n;
