import { createContext } from 'react';
export const LanguageContext = createContext({ language: 'ar', pending: false, changeLanguage: async () => {} });
