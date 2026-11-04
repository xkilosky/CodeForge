/**
 * Vite aliases declared in vite.config.ts.
 *
 * Monaco's exports map forces ".js" onto every subpath, so its CSS cannot be
 * imported by bare specifier. The bundler resolves these aliases; TypeScript 6
 * (TS2882) requires a declaration for side-effect imports, hence this file.
 */
declare module 'monaco-codicon-css';
declare module 'monaco-codicon-modifiers-css';
