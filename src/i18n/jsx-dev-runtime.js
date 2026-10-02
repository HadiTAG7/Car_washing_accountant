import { jsxDEV as nativeJsxDEV, Fragment } from 'react/jsx-dev-runtime';
import LocalizedElement from './LocalizedElement';
export { Fragment };
export function jsxDEV(type, props, key, staticChildren, source, self) {
  return typeof type === 'string' || type === Fragment
    ? nativeJsxDEV(LocalizedElement, { elementType: type, elementProps: props, staticChildren }, key, false, source, self)
    : nativeJsxDEV(type, props, key, staticChildren, source, self);
}
