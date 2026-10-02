import { jsx as nativeJsx, jsxs as nativeJsxs, Fragment } from 'react/jsx-runtime';
import LocalizedElement from './LocalizedElement';
export { Fragment };
// Only DOM elements from our source use the presentation boundary. React components
// (including context providers, Recharts and third-party components) are untouched.
export function jsx(type, props, key) {
  return typeof type === 'string' || type === Fragment
    ? nativeJsx(LocalizedElement, { elementType: type, elementProps: props }, key)
    : nativeJsx(type, props, key);
}
export function jsxs(type, props, key) {
  return typeof type === 'string' || type === Fragment
    ? nativeJsx(LocalizedElement, { elementType: type, elementProps: props, staticChildren: true }, key)
    : nativeJsxs(type, props, key);
}
