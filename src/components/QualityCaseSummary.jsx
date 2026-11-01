// Shared closed-card layout for every quality source. Source prose is never
// translated or interpreted as a financial charge by this presentation layer.
export default function QualityCaseSummary({ kind, sourceId, bikerLabel, bikerPrefix = 'اسم الموقع حسب الربط:', externalId, date, reason, figures }) {
  return <summary className="qv-case-summary">
    <span className="qv-case-heading"><strong>{kind} <bdi>{sourceId}</bdi></strong><bdi>{date || 'غير متاح'}</bdi></span>
    <span className="qv-case-biker">{bikerPrefix} {bikerLabel} {externalId && <bdi>· {externalId}</bdi>}</span>
    <span className="qv-preview" translate={reason ? 'no' : undefined}>{reason || 'السبب غير محفوظ'}</span>
    <span className="qv-case-figures">{figures}</span>
    <span className="qv-case-toggle">التفاصيل <span aria-hidden="true">⌄</span></span>
  </summary>;
}
