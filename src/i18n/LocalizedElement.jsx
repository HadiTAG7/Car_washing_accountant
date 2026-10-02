import { useContext } from 'react';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { LanguageContext } from './LanguageContext';
import { translate, localizeClassName } from './locale';

const ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'aria-description', 'alt'];
function localizeChildren(value, language) {
  if (Array.isArray(value)) return value.map(child => localizeChildren(child, language));
  return typeof value === 'string' ? translate(value, language) : value;
}
/** A React render boundary, not a DOM mutation observer. The same host node survives
 * language changes, so refs, forms, portals, selection and event handlers are retained.
 * Canonical option values, name/id, input value, records and callbacks pass unchanged.
 */
export default function LocalizedElement({ elementType, elementProps, staticChildren = false }) {
  const { language } = useContext(LanguageContext);
  const props = { ...elementProps };
  const create = staticChildren ? jsxs : jsx;
  if (elementType === Fragment) return create(Fragment, { children: localizeChildren(props.children, language) });
  if (props.translate === 'no' || props['data-no-translate']) return create(elementType, props);
  for (const attribute of ATTRIBUTES) props[attribute] = translate(props[attribute], language);
  props.children = localizeChildren(props.children, language);
  props.className = localizeClassName(props.className, language);
  if (props.dir === 'rtl') props.dir = language === 'en' ? 'ltr' : 'rtl';
  return create(elementType, props);
}
