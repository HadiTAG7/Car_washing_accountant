import {
  Activity, AlertTriangle, BadgeCheck, BellRing, Bot,
  ClipboardCheck, ClipboardList, Crown, Database,
  ExternalLink, FileClock, FileText, Focus, Landmark, Maximize2, Minimize2,
  Minus, Plus, ReceiptText, RefreshCw, RotateCw, Scale, Settings, ShieldCheck,
  TrendingUp, UserRoundCog, UsersRound,
  WalletCards, Workflow, X,
} from 'lucide-react';
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { loadAgentCaseHistory, useAgentCommandCenter } from '../hooks/useAgentCommandCenter';
import {
  AGENT_STATUS,
  CONNECTION_LABELS,
  TASK_STATE_LABELS,
  COMMAND_CENTER_ROLES,
  EMPTY_COMMAND_CENTER_SNAPSHOT,
  WORKFLOW_AGENT_IDS,
  assembleAgentOrganization,
  formatAgentDate,
  toIsoTimestamp,
} from '../lib/agentCommandCenter';
import TopBar from './TopBar';
import {
  Card, SecondaryButton, StatusBadge,
} from './UI';
import './AgentCommandCenterPage.css';

const ICONS = Object.freeze({
  receipt: ReceiptText,
  clipboard: ClipboardCheck,
  scale: Scale,
  refresh: RefreshCw,
  cfo: UserRoundCog,
  settings: Settings,
  wallet: WalletCards,
  users: UsersRound,
  shield: ShieldCheck,
  badge: BadgeCheck,
  trend: TrendingUp,
  workflow: Workflow,
});

const TEAM_ICONS = Object.freeze({
  landmark: Landmark,
  workflow: Workflow,
  users: UsersRound,
  badge: BadgeCheck,
  trend: TrendingUp,
});

const STATUS_BADGE_KIND = Object.freeze({
  healthy: 'good',
  warning: 'overdue',
  critical: 'critical',
  unknown: 'neutral',
});

const NOOP = () => {};
const GRAPH_CENTER = 50;
const TEAM_RADIUS = 29;
const AGENT_RADIUS = 42;
const MOBILE_MAP_WIDTH = 920;
const MOBILE_MAP_HEIGHT = 700;
const MAP_ZOOM_DEFAULT = 0.82;
const MAP_ZOOM_MIN = 0.72;
const MAP_ZOOM_MAX = 1.42;
const MAP_ZOOM_STEP = 0.12;

const DRAWER_TABS = Object.freeze([
  { id: 'summary', label: 'الملخص' },
  { id: 'reports', label: 'التقارير' },
  { id: 'alerts', label: 'التنبيهات' },
  { id: 'sources', label: 'المصادر' },
  { id: 'history', label: 'السجل' },
]);

const EXECUTIVE_TABS = Object.freeze([
  { id: 'approvals', label: 'الموافقات', icon: ClipboardList },
  { id: 'activity', label: 'آخر النشاط', icon: Activity },
  { id: 'sources', label: 'صحة المصادر', icon: Database },
  { id: 'alerts', label: 'التنبيهات', icon: BellRing },
  { id: 'tasks', label: 'القضايا والمهام', icon: FileClock },
]);

function pointAt(angle, radius) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: Number((GRAPH_CENTER + Math.cos(radians) * radius).toFixed(2)),
    y: Number((GRAPH_CENTER + Math.sin(radians) * radius).toFixed(2)),
  };
}

function organizationLayout(organization) {
  return organization.teams.map((team) => ({
    ...team,
    point: pointAt(team.layout.angle, TEAM_RADIUS),
    memberPoints: new Map(team.memberAgentIds.map((agentId, index) => [
      agentId,
      pointAt(team.layout.memberArc[index] ?? team.layout.angle, AGENT_RADIUS),
    ])),
  }));
}

function aggregateTeamStatus(team) {
  const agents = [team.leader, ...team.members].filter(Boolean);
  if (agents.some((agent) => agent.status === 'critical')) return 'critical';
  if (agents.some((agent) => agent.status === 'warning')) return 'warning';
  if (agents.length && agents.every((agent) => agent.status === 'healthy')) return 'healthy';
  return 'unknown';
}

function agentCountLabel(count) {
  if (count === 1) return 'وكيل واحد';
  if (count === 2) return 'وكيلان';
  return `${count} وكلاء`;
}

function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  ));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(query);
    const update = () => setReduced(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

function StatusPill({ status = 'unknown', compact = false }) {
  const details = AGENT_STATUS[status] || AGENT_STATUS.unknown;
  return (
    <StatusBadge status={STATUS_BADGE_KIND[status] || 'neutral'}>
      {compact ? details.shortLabel : details.label}
    </StatusBadge>
  );
}

function AgentButton({ agent, onOpen, point, variant = 'orbit', dimmed = false }) {
  const Icon = ICONS[agent.icon] || Bot;
  const workHint = agent.currentTask
    ? `المهمة: ${agent.currentTask.title}\nالنتيجة: ${agent.currentTask.result || 'لم تصل'}\nالعائق: ${agent.currentTask.blocker || 'لم يُبلّغ عنه'}\nالخطوة التالية: ${agent.currentTask.nextStep || 'لم تُحدد'}`
    : agent.latestReport?.summary;
  const style = point
    ? { '--agent-x': `${point.x}%`, '--agent-y': `${point.y}%` }
    : undefined;
  return (
    <button
      type="button"
      className={`acc-agent acc-agent--${variant}`}
      data-status={agent.status}
      data-running={agent.isRunning ? 'true' : 'false'}
      data-dimmed={dimmed ? 'true' : 'false'}
      style={style}
      title={workHint}
      onClick={(event) => onOpen(agent, event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        onOpen(agent, event.currentTarget);
      }}
      aria-label={`${agent.name} — ${AGENT_STATUS[agent.status]?.label || AGENT_STATUS.unknown.label}${agent.isRunning ? ' — يعمل الآن' : ''}`}
    >
      <span className="acc-agent-ring" aria-hidden="true" />
      <span className="acc-agent-icon"><Icon size={variant === 'leader' ? 18 : 21} /></span>
      <span className="acc-agent-name">{agent.shortName}</span>
      <span className="acc-node-state">{agent.connection !== 'connected' ? CONNECTION_LABELS[agent.connection] : agent.currentTask && ['blocked', 'waiting-approval'].includes(agent.currentTask.state) ? TASK_STATE_LABELS[agent.currentTask.state] : agent.isRunning ? 'يعمل الآن' : 'متصل'}</span>
      <span className="acc-node-work" title={agent.currentTask?.title || agent.latestReport?.summary || undefined}>{agent.currentTask?.title || agent.latestReport?.title || 'لم تصل مهمة أو نتيجة'}</span>
      <span className="acc-agent-indicator" aria-hidden="true" />
    </button>
  );
}

function TeamNode({ team, activeTeamId, onSelectTeam, onOpenAgent }) {
  const Icon = TEAM_ICONS[team.icon] || Workflow;
  const status = aggregateTeamStatus(team);
  const active = activeTeamId === team.id;
  const dimmed = Boolean(activeTeamId && !active);
  const style = { '--team-x': `${team.point.x}%`, '--team-y': `${team.point.y}%` };
  return (
    <div
      className="acc-team-node"
      style={style}
      data-status={status}
      data-active={active ? 'true' : 'false'}
      data-dimmed={dimmed ? 'true' : 'false'}
    >
      <button
        type="button"
        className="acc-team-focus"
        onClick={() => onSelectTeam(team.id)}
        aria-pressed={active}
        aria-label={`${active ? 'إلغاء إبراز' : 'إبراز'} ${team.name}`}
      >
        <span className="acc-team-icon"><Icon size={18} /></span>
        <span><strong>{team.shortName}</strong><small>{agentCountLabel(team.agentCount)}</small></span>
      </button>
      {team.leader ? <AgentButton agent={team.leader} onOpen={onOpenAgent} variant="leader" dimmed={dimmed} /> : <span className="acc-team-neutral">عقدة تنظيمية</span>}
    </div>
  );
}

function OrganizationMap({ organization, activeTeamId, onSelectTeam, onOpenAgent, approvals, alerts }) {
  const teams = useMemo(() => organizationLayout(organization), [organization]);
  const mapShellRef = useRef(null);
  const viewportRef = useRef(null);
  const zoomAnchorRef = useRef(null);
  const [zoom, setZoom] = useState(MAP_ZOOM_DEFAULT);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const agentPoints = new Map();
  for (const team of teams) {
    for (const [agentId, point] of team.memberPoints) agentPoints.set(agentId, point);
  }
  const finance = teamById.get('finance');
  const workflowPoints = WORKFLOW_AGENT_IDS.map((agentId) => (
    agentId === finance?.leaderAgentId ? finance.point : agentPoints.get(agentId)
  )).filter(Boolean);

  const centerMap = useCallback((behavior = 'smooth') => {
    const viewport = viewportRef.current;
    if (!viewport?.scrollTo) return;
    viewport.scrollTo({
      left: Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2),
      top: Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2),
      behavior: behavior === 'auto' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : behavior,
    });
  }, []);

  const adjustZoom = useCallback((change) => {
    const viewport = viewportRef.current;
    if (viewport) {
      zoomAnchorRef.current = {
        x: (viewport.scrollLeft + viewport.clientWidth / 2) / Math.max(viewport.scrollWidth, 1),
        y: (viewport.scrollTop + viewport.clientHeight / 2) / Math.max(viewport.scrollHeight, 1),
      };
    }
    setZoom((current) => {
      const next = Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, Number((current + change).toFixed(2))));
      if (next === current) zoomAnchorRef.current = null;
      return next;
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => centerMap('auto'), 0);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => centerMap('auto')) : null;
    if (viewportRef.current) observer?.observe(viewportRef.current);
    return () => { window.clearTimeout(timer); observer?.disconnect(); };
  }, [centerMap]);

  useEffect(() => {
    const anchor = zoomAnchorRef.current;
    if (!anchor) return undefined;
    zoomAnchorRef.current = null;
    const timer = window.setTimeout(() => {
      const viewport = viewportRef.current;
      if (!viewport?.scrollTo) return;
      viewport.scrollTo({
        left: Math.max(0, anchor.x * viewport.scrollWidth - viewport.clientWidth / 2),
        top: Math.max(0, anchor.y * viewport.scrollHeight - viewport.clientHeight / 2),
        behavior: 'auto',
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [zoom]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === mapShellRef.current);
      window.setTimeout(() => centerMap('auto'), 0);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [centerMap]);

  const toggleFullscreen = useCallback(() => {
    const shell = mapShellRef.current;
    if (!shell) return;
    if (isFullscreen || document.fullscreenElement === shell) {
      const exitRequest = document.exitFullscreen?.();
      exitRequest?.catch(NOOP);
      return;
    }
    const enterRequest = shell.requestFullscreen?.();
    enterRequest?.catch(NOOP);
  }, [isFullscreen]);

  const handleViewportKeyDown = useCallback((event) => {
    if (event.target !== event.currentTarget) return;
    const movement = 72;
    const offsets = {
      ArrowLeft: [-movement, 0],
      ArrowRight: [movement, 0],
      ArrowUp: [0, -movement],
      ArrowDown: [0, movement],
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    event.currentTarget.scrollBy?.({ left: offset[0], top: offset[1], behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, []);

  const fullscreenSupported = typeof document !== 'undefined'
    && typeof document.documentElement?.requestFullscreen === 'function';
  const stageStyle = {
    '--acc-map-scale': zoom,
    '--acc-map-stage-width': `${Math.round(MOBILE_MAP_WIDTH * zoom)}px`,
    '--acc-map-stage-height': `${Math.round(MOBILE_MAP_HEIGHT * zoom)}px`,
  };

  return (
    <div ref={mapShellRef} className="acc-map-wrap" data-fullscreen={isFullscreen ? 'true' : 'false'}>
      <p id="acc-map-help" className="acc-map-help">اسحب الخريطة أفقيًا أو عموديًا، أو استخدم الأسهم عند التركيز على مساحة الخريطة. تتوفر أزرار للتكبير والتصغير وإعادة تمركز CEO. اختر قسمًا لعرض وكلائه بحجم مقروء.</p>
      <div className="acc-map-controls" role="group" aria-label="أدوات عرض خريطة الوكلاء">
        <button type="button" onClick={() => adjustZoom(MAP_ZOOM_STEP)} disabled={zoom >= MAP_ZOOM_MAX} aria-label="تكبير الخريطة"><Plus size={16} /></button>
        <output className="tabular-nums" aria-live="polite" aria-label={`مستوى التكبير ${Math.round(zoom * 100)} بالمئة`}>{Math.round(zoom * 100)}%</output>
        <button type="button" onClick={() => adjustZoom(-MAP_ZOOM_STEP)} disabled={zoom <= MAP_ZOOM_MIN} aria-label="تصغير الخريطة"><Minus size={16} /></button>
        <button type="button" onClick={() => centerMap()} aria-label="إعادة تمركز CEO"><Focus size={16} /></button>
        <button type="button" onClick={() => { onSelectTeam(null); setZoom(MAP_ZOOM_DEFAULT); window.setTimeout(() => centerMap('auto'), 0); }} aria-label="عرض الأقسام الرئيسية"><RotateCw size={16} /></button>
        <button type="button" onClick={toggleFullscreen} disabled={!fullscreenSupported} aria-label={isFullscreen ? 'إنهاء ملء الشاشة' : 'عرض الخريطة بملء الشاشة'} aria-pressed={isFullscreen}><span aria-hidden="true">{isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</span></button>
      </div>
      <div
        ref={viewportRef}
        className="acc-map-viewport"
        data-testid="agent-map-viewport"
        data-zoom={zoom.toFixed(2)}
        role="region"
        aria-label="خريطة الوكلاء التفاعلية"
        aria-describedby="acc-map-help"
        tabIndex={0}
        onKeyDown={handleViewportKeyDown}
      >
        <div className="acc-map-stage" style={stageStyle}>
          <div className="acc-map" data-testid="desktop-organization-map">
        <svg className="acc-map-lines" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          <defs>
            <marker id="acc-flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <circle className="acc-level-ring acc-level-ring--teams" cx="50" cy="50" r={TEAM_RADIUS} />
          <circle className="acc-level-ring acc-level-ring--agents" cx="50" cy="50" r={AGENT_RADIUS} />
          {teams.map((team) => {
            const dimmed = Boolean(activeTeamId && activeTeamId !== team.id);
            return (
              <g key={team.id} data-dimmed={dimmed ? 'true' : 'false'}>
                <line className="acc-ceo-link" x1="50" y1="50" x2={team.point.x} y2={team.point.y} />
                {activeTeamId === team.id ? team.members.map((member) => {
                  const point = team.memberPoints.get(member.id);
                  return point ? <line key={member.id} className="acc-team-link" x1={team.point.x} y1={team.point.y} x2={point.x} y2={point.y} /> : null;
                }) : null}
              </g>
            );
          })}
          {activeTeamId === 'finance' && workflowPoints.length === WORKFLOW_AGENT_IDS.length ? (
            <>
              <polyline className="acc-finance-flow" points={workflowPoints.map((point) => `${point.x},${point.y}`).join(' ')} markerEnd="url(#acc-flow-arrow)" />
              <line className="acc-executive-flow" x1={finance.point.x} y1={finance.point.y} x2="50" y2="50" markerEnd="url(#acc-flow-arrow)" />
            </>
          ) : null}
        </svg>

        <div className="acc-layer-label acc-layer-label--agents">{activeTeamId ? 'وكلاء القسم المختار' : 'اختر قسمًا لعرض وكلائه'}</div>
        <div className="acc-ceo-node" role="img" aria-label="CEO، مركز القيادة، عقدة تنظيمية لا تدخل ضمن عدد الوكلاء">
          <span className="acc-ceo-icon"><Crown size={24} /></span>
          <strong>CEO</strong>
          <small>مركز القيادة</small>
          <span>{approvals} موافقات · {alerts} تنبيهات</span>
        </div>

        {teams.map((team) => (
          <TeamNode key={team.id} team={team} activeTeamId={activeTeamId} onSelectTeam={onSelectTeam} onOpenAgent={onOpenAgent} />
        ))}
        {teams.filter((team) => team.id === activeTeamId).flatMap((team) => team.members.map((agent) => (
          <AgentButton
            key={agent.id}
            agent={agent}
            point={team.memberPoints.get(agent.id)}
            onOpen={onOpenAgent}
            dimmed={Boolean(activeTeamId && activeTeamId !== team.id)}
          />
        )))}
            <div className="acc-flow-label">{activeTeamId === 'finance' ? <><span>مسار المالية</span>تسجيل ← مراجعة ← مطابقة ← CFO ← CEO</> : <><span>مسار التقارير</span>الوكيل ← مدير القسم ← CEO</>}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabList({ tabs, activeId, onChange, label, idPrefix, counts = {} }) {
  const handleKeyDown = (event, index) => {
    let nextIndex = null;
    if (event.key === 'ArrowLeft') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    onChange(tabs[nextIndex].id);
    event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[nextIndex]?.focus();
  };

  return (
    <div className="acc-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        const active = activeId === tab.id;
        return (
          <button
            key={tab.id}
            id={`${idPrefix}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {Icon ? <Icon size={15} aria-hidden="true" /> : null}
            <span>{tab.label}</span>
            {Number.isFinite(counts[tab.id]) ? <small className="tabular-nums">{counts[tab.id]}</small> : null}
          </button>
        );
      })}
    </div>
  );
}

function CompactEmpty({ icon: Icon, title, hint }) {
  return (
    <div className="acc-compact-empty" role="status">
      {Icon ? <Icon size={17} aria-hidden="true" /> : null}
      <p><strong>{title}</strong>{hint ? <span>{hint}</span> : null}</p>
    </div>
  );
}

function EvidenceLinks({ links = [] }) {
  const safe = links.filter((link) => {
    try { const url = new URL(link); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
  });
  return safe.length ? <ul className="acc-evidence-links">{safe.map((link, index) => <li key={`${index}-${link}`}><a href={link} target="_blank" rel="noopener noreferrer">دليل {index + 1} <ExternalLink size={13} /></a></li>)}</ul> : <p className="acc-inline-empty">لم يصل رابط دليل.</p>;
}

function WorkSummary({ task, report }) {
  return <section className="acc-detail-section"><h3>العمل والنتيجة</h3><dl className="acc-work-summary">
    <div><dt>المهمة</dt><dd>{task ? `${task.title} — ${TASK_STATE_LABELS[task.state] || 'غير معروف'}` : 'لم تصل مهمة مرتبطة'}</dd></div>
    <div><dt>آخر نتيجة</dt><dd>{task?.result || report?.summary || 'لم تصل نتيجة'}</dd></div>
    <div><dt>العائق</dt><dd>{task?.blocker || 'لم يُبلّغ عن عائق'}</dd></div>
    <div><dt>الخطوة التالية</dt><dd>{task?.nextStep || 'لم تُحدد'}</dd></div>
  </dl>{task ? <EvidenceLinks links={task.evidence} /> : null}</section>;
}

function ManagerReview({ review }) {
  return (
    <section className="acc-detail-section">
      <h3>ملخص مراجعة المدير</h3>
      {review ? (
        <>
          <p className="acc-connection-note">{review.senderId ? `المرسل المعزول: ${review.senderId}` : 'أُرسل بالمفتاح المشترك؛ هوية المرسل غير معزولة.'} تصريح مراجعة مستلم، وليس تحققًا مستقلًا من الأدلة.</p>
          <dl className="acc-work-summary">
            <div><dt>النتائج</dt><dd>{review.results}</dd></div>
            <div><dt>الاستثناءات</dt><dd>{review.exceptions}</dd></div>
            <div><dt>التوصية</dt><dd>{review.recommendation}</dd></div>
          </dl>
          <EvidenceLinks links={review.evidence} />
          {review.reportIds?.length ? <p className="acc-connection-note">تقارير صرّح المدير بمراجعتها: {review.reportIds.join('، ')}</p> : null}
          <time>{formatAgentDate(review.reportedAt)}</time>
        </>
      ) : <p className="acc-inline-empty">لم يصل ملخص مراجعة من المدير. تجميع تقارير الفريق لا يثبت أنه راجعها.</p>}
    </section>
  );
}

function TaskCard({ task, onLoadCaseHistory }) {
  const [history, setHistory] = useState(null);
  const [historyState, setHistoryState] = useState('idle');
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const load = async () => {
    setHistoryState('loading');
    try {
      const rows = await onLoadCaseHistory(task.id);
      if (mountedRef.current) { setHistory(rows); setHistoryState('loaded'); }
    } catch { if (mountedRef.current) setHistoryState('failed'); }
  };
  const timeline = [...(history || task.timeline)].sort((a, b) => String(toIsoTimestamp(b.occurredAt)).localeCompare(String(toIsoTimestamp(a.occurredAt))));
  return (
    <li className="acc-task-card">
      <div className="acc-task-heading"><strong>{task.title}</strong><span>{TASK_STATE_LABELS[task.state] || 'غير معروف'}</span></div>
      <p className="acc-connection-note">المسؤول: {task.ownerName} · القضية: {task.id}</p>
      <WorkSummary task={task} />
      <p className="acc-connection-note">{task.reports.length} تقرير في السجل الأخير · {task.alerts.length} تنبيه نشط · {task.approvals.length} موافقة معلّقة — إكمال المهمة لا ينفّذ قرارًا ولا يغلق طلب موافقة.</p>
      <details>
        <summary>سجل القضية</summary>
        {onLoadCaseHistory ? <button type="button" className="acc-history-load" onClick={load} disabled={historyState === 'loading'}>{historyState === 'loading' ? 'جارٍ تحميل السجل…' : 'تحميل سجل القضية الكامل'}</button> : null}
        {historyState === 'failed' ? <p role="alert">تعذّر تحميل السجل الكامل. الظاهر أحداث المتابعة الأخيرة فقط.</p> : null}
        {historyState !== 'loaded' ? <p className="acc-connection-note">أحداث المتابعة الأخيرة فقط؛ ليست السجل الكامل.</p> : null}
        <ol className="acc-agent-history">{timeline.map((event) => (
          <li key={event.id}><div>
            <strong>{event.message}</strong>
            <time>{formatAgentDate(toIsoTimestamp(event.occurredAt))}</time>
            {event.taskSnapshot ? <><p className="acc-connection-note">الحالة المبلّغ عنها: {TASK_STATE_LABELS[event.taskSnapshot.state]}</p><WorkSummary task={event.taskSnapshot} /></> : null}
          </div></li>
        ))}</ol>
        {!timeline.length ? <p className="acc-inline-empty">لا يوجد حدث في السجل المعروض.</p> : null}
      </details>
    </li>
  );
}

function TasksContent({ tasks, onLoadCaseHistory }) {
  if (!tasks.length) return <CompactEmpty icon={FileClock} title="لا توجد قضايا مرتبطة بعد" hint="تظهر المهام الحقيقية بعد إرسال caseId وتحديث المهمة عبر المدخل الموقّع." />;
  return <ul className="acc-task-list">{tasks.map((task) => <TaskCard key={task.id} task={task} onLoadCaseHistory={onLoadCaseHistory} />)}</ul>;
}

function ApprovalsContent({ approvals }) {
  if (!approvals.length) return <CompactEmpty icon={ClipboardCheck} title="لا توجد طلبات موافقة" hint="تظهر هنا الطلبات المستلمة من الوكلاء فقط." />;
  return (
    <ul className="acc-event-list">
      {approvals.map((approval) => (
        <li key={approval.id}><span className="acc-event-marker" data-kind="warning" aria-hidden="true" /><div><strong>{approval.title}</strong><p>{approval.summary}</p><time dateTime={approval.createdAt || undefined}>{formatAgentDate(approval.createdAt)}</time><span className="acc-readonly-note">قرار CEO مطلوب — لا يُنفّذ هنا</span></div></li>
      ))}
    </ul>
  );
}

function ActivityContent({ activity }) {
  if (!activity.length) return <CompactEmpty icon={FileClock} title="لا يوجد نشاط بعد" hint="سيظهر النشاط الحقيقي القادم من نقطة الإدخال الموقعة." />;
  return <ol className="acc-event-list">{activity.map((item) => <li key={item.id}><span className="acc-event-marker" data-kind={item.kind || 'info'} aria-hidden="true" /><div><p>{item.message}</p><time dateTime={item.occurredAt || undefined}>{formatAgentDate(item.occurredAt)}</time></div></li>)}</ol>;
}

function SourcesContent({ sources }) {
  if (!sources.length) return <CompactEmpty icon={Database} title="لا توجد قياسات مصادر" hint="لن تُعرض صحة مفترضة قبل وصول قياس حقيقي." />;
  return <ul className="acc-source-list">{sources.map((source) => <li key={source.id}><div><strong>{source.name}</strong><time dateTime={source.lastCheckedAt || undefined}>{formatAgentDate(source.lastCheckedAt)}</time></div><StatusPill status={source.status} compact /></li>)}</ul>;
}

function AlertsContent({ alerts }) {
  if (!alerts.length) return <CompactEmpty icon={BellRing} title="لا توجد تنبيهات تنفيذية" hint="لن يظهر تنبيه قبل استلامه عبر المسار الموقّع." />;
  return <ul className="acc-executive-alerts">{alerts.map((alert) => <li key={alert.id} data-severity={alert.severity}><strong>{alert.title}</strong><p>{alert.message}</p><time dateTime={alert.createdAt || undefined}>{formatAgentDate(alert.createdAt)}</time></li>)}</ul>;
}

function ExecutiveConsole({ snapshot, onLoadCaseHistory }) {
  const [activeTab, setActiveTab] = useState('approvals');
  const counts = {
    approvals: snapshot.approvals.length,
    activity: snapshot.activity.length,
    sources: snapshot.sources.length,
    alerts: snapshot.alerts.length,
    tasks: snapshot.tasks.length,
  };
  return (
    <Card className="acc-executive-console">
      <TabList tabs={EXECUTIVE_TABS} activeId={activeTab} onChange={setActiveTab} label="متابعة التنفيذ" idPrefix="acc-executive" counts={counts} />
      <div className="acc-executive-panel" id={`acc-executive-panel-${activeTab}`} role="tabpanel" aria-labelledby={`acc-executive-tab-${activeTab}`} tabIndex={0}>
        {activeTab === 'approvals' ? <ApprovalsContent approvals={snapshot.approvals} /> : null}
        {activeTab === 'activity' ? <ActivityContent activity={snapshot.activity} /> : null}
        {activeTab === 'sources' ? <SourcesContent sources={snapshot.sources} /> : null}
        {activeTab === 'alerts' ? <AlertsContent alerts={snapshot.alerts} /> : null}
        {activeTab === 'tasks' ? <TasksContent tasks={snapshot.tasks} onLoadCaseHistory={onLoadCaseHistory} /> : null}
      </div>
    </Card>
  );
}

function AgentDetailsDrawer({ agent, onClose, returnFocusRef }) {
  const closeButtonRef = useRef(null);
  const drawerRef = useRef(null);
  const [activeTab, setActiveTab] = useState('summary');
  const agentId = agent?.id;
  useEffect(() => {
    if (!agentId) return undefined;
    const returnFocus = returnFocusRef.current;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(drawerRef.current?.querySelectorAll('a[href], button:not([disabled]):not([tabindex="-1"]), [tabindex="0"], summary') || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !drawerRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      returnFocus?.focus();
    };
  }, [agentId, onClose, returnFocusRef]);

  if (!agent) return null;
  const Icon = ICONS[agent.icon] || Bot;
  const visibleApprovals = agent.isTeamLeader
    ? [...agent.approvals, ...agent.teamApprovals]
    : agent.approvals;
  const visibleAlerts = agent.isTeamLeader
    ? [...agent.alerts, ...agent.teamAlerts]
    : agent.alerts;
  const historyItems = [
    ...(agent.lastRunAt ? [{ id: `run-${agent.lastRunAt}`, kind: 'تشغيل', title: 'آخر تشغيل مسجّل', occurredAt: agent.lastRunAt }] : []),
    ...agent.reports.map((report) => ({ id: `report-${report.id}`, kind: 'تقرير', title: report.title, occurredAt: report.reportedAt })),
    ...agent.alerts.map((alert) => ({ id: `alert-${alert.id}`, kind: 'تنبيه', title: alert.title, occurredAt: alert.createdAt })),
    ...agent.teamReports.map((report) => ({ id: `team-report-${report.id}`, kind: 'تقرير فريق', title: `${report.sourceAgentName}: ${report.title}`, occurredAt: report.reportedAt })),
    ...agent.teamAlerts.map((alert) => ({ id: `team-alert-${alert.id}`, kind: 'تنبيه حرج', title: `${alert.sourceAgentName}: ${alert.title}`, occurredAt: alert.createdAt })),
  ].sort((a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || '')));
  return (
    <div className="acc-drawer-layer">
      <button type="button" tabIndex={-1} className="acc-drawer-backdrop" onClick={onClose} aria-label="إغلاق تفاصيل الوكيل" />
      <aside ref={drawerRef} className="acc-drawer" role="dialog" aria-modal="true" aria-labelledby="acc-drawer-title">
        <header className="acc-drawer-header">
          <div className="acc-drawer-agent-icon" data-status={agent.status}><Icon size={25} /></div>
          <div><p>{agent.isTeamLeader ? `قائد ${agent.teamName}` : agent.teamName}</p><h2 id="acc-drawer-title">{agent.name}</h2></div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="acc-icon-button sw-tap" aria-label="إغلاق لوحة التفاصيل"><X size={20} /></button>
        </header>

        <TabList tabs={DRAWER_TABS} activeId={activeTab} onChange={setActiveTab} label="تفاصيل الوكيل" idPrefix="acc-drawer" />
        <div className="acc-drawer-content" id={`acc-drawer-panel-${activeTab}`} role="tabpanel" aria-labelledby={`acc-drawer-tab-${activeTab}`} tabIndex={0}>
          {activeTab === 'summary' ? (
            <>
              <div className="acc-detail-status-row"><StatusPill status={agent.status} />{agent.isRunning ? <span className="acc-live-chip"><span /> يعمل الآن</span> : null}</div>
              <p className="acc-connection-note">{CONNECTION_LABELS[agent.connection]} · آخر اتصال: {formatAgentDate(agent.lastSeen)}{agent.connection === 'stale' ? ' — الحالة السابقة ليست تأكيدًا للصحة الآن.' : ''}</p>
              <WorkSummary task={agent.currentTask} report={agent.latestReport} />
              {agent.isTeamLeader ? <ManagerReview review={agent.managerReview} /> : null}
              <dl className="acc-detail-times"><div><dt>آخر تشغيل</dt><dd>{formatAgentDate(agent.lastRunAt)}</dd></div><div><dt>التشغيل القادم</dt><dd>{formatAgentDate(agent.nextRunAt)}</dd></div></dl>
              <section className="acc-detail-section"><h3>الدور</h3><p>{agent.role}</p></section>
              <section className="acc-detail-section"><h3>الصلاحيات والحدود</h3><ul className="acc-permissions">{agent.permissions.map((permission) => <li key={permission}>{permission}</li>)}</ul></section>
              <section className="acc-detail-section"><h3>{agent.isTeamLeader ? 'طلبات موافقة الفريق المرفوعة إلى المدير وCEO' : 'طلبات الموافقة المرفوعة إلى المدير وCEO'}</h3>{visibleApprovals.length ? <ul className="acc-detail-list">{visibleApprovals.map((approval) => <li key={`${approval.sourceAgentId || agent.id}-${approval.id}`}>{approval.sourceAgentName ? <small className="acc-escalation-source">من {approval.sourceAgentName}</small> : null}<strong>{approval.title}</strong><p>{approval.summary}</p></li>)}</ul> : <p className="acc-inline-empty">لا توجد طلبات موافقة معلّقة لهذا الوكيل أو فريقه.</p>}</section>
              {agent.conversationUrl ? <a className="acc-conversation-link" href={agent.conversationUrl} target="_blank" rel="noreferrer noopener">فتح المحادثة الموثوقة <ExternalLink size={16} /></a> : <p className="acc-conversation-unavailable">رابط المحادثة غير متوفر أو غير موثوق.</p>}
            </>
          ) : null}
          {activeTab === 'reports' ? (
            <>
              <section className="acc-detail-section acc-detail-section--first"><h3>آخر تقرير</h3>{agent.latestReport ? <article className="acc-report-card"><strong>{agent.latestReport.title}</strong><p>{agent.latestReport.summary}</p><time dateTime={agent.latestReport.reportedAt || undefined}>{formatAgentDate(agent.latestReport.reportedAt)}</time></article> : <CompactEmpty icon={FileText} title="لم يُستلم تقرير" hint="لا يوجد ملخص حقيقي لهذا الوكيل حتى الآن." />}</section>
              <section className="acc-detail-section"><h3>سجل التقارير</h3>{agent.reports.length ? <ol className="acc-report-history">{agent.reports.map((report) => <li key={report.id}><FileText size={16} /><div><strong>{report.title}</strong><time dateTime={report.reportedAt || undefined}>{formatAgentDate(report.reportedAt)}</time></div></li>)}</ol> : <p className="acc-inline-empty">لا يوجد سجل تقارير بعد.</p>}</section>
              {agent.isTeamLeader ? <section className="acc-detail-section"><h3>تقارير الفريق المستلمة — لا تعني مراجعة المدير</h3>{agent.teamReports.length ? <ol className="acc-report-history">{agent.teamReports.map((report) => <li key={`${report.sourceAgentId}-${report.id}`}><FileText size={16} /><div><small className="acc-escalation-source">من {report.sourceAgentName}</small><strong>{report.title}</strong><time dateTime={report.reportedAt || undefined}>{formatAgentDate(report.reportedAt)}</time></div></li>)}</ol> : <p className="acc-inline-empty">لا توجد تقارير مرفوعة من أعضاء الفريق بعد.</p>}</section> : null}
            </>
          ) : null}
          {activeTab === 'alerts' ? <section className="acc-detail-section acc-detail-section--first"><h3>{agent.isTeamLeader ? 'تنبيهات المدير والتنبيهات الحرجة المرفوعة من الفريق' : 'التنبيهات النشطة'}</h3>{visibleAlerts.length ? <ul className="acc-detail-list">{visibleAlerts.map((alert) => <li key={`${alert.sourceAgentId || agent.id}-${alert.id}`} data-severity={alert.severity}>{alert.sourceAgentName ? <small className="acc-escalation-source">من {alert.sourceAgentName}</small> : null}<strong>{alert.title}</strong><p>{alert.message}</p></li>)}</ul> : <CompactEmpty icon={BellRing} title="لا توجد تنبيهات نشطة" />}</section> : null}
          {activeTab === 'sources' ? <section className="acc-detail-section acc-detail-section--first"><h3>مصادر البيانات</h3>{agent.dataSources.length ? <ul className="acc-source-list acc-source-list--detail">{agent.dataSources.map((source) => <li key={source.id}><div><strong>{source.name}</strong><time dateTime={source.lastCheckedAt || undefined}>{formatAgentDate(source.lastCheckedAt)}</time></div><StatusPill status={source.status} compact /></li>)}</ul> : <CompactEmpty icon={Database} title="لا توجد مصادر مسجلة" />}</section> : null}
          {activeTab === 'history' ? <section className="acc-detail-section acc-detail-section--first"><h3>سجل الوكيل</h3>{historyItems.length ? <ol className="acc-agent-history">{historyItems.map((item) => <li key={item.id}><span>{item.kind}</span><div><strong>{item.title}</strong><time dateTime={item.occurredAt || undefined}>{formatAgentDate(item.occurredAt)}</time></div></li>)}</ol> : <CompactEmpty icon={FileClock} title="لا يوجد سجل بعد" hint="يظهر هنا التشغيل والتقارير والتنبيهات المستلمة." />}</section> : null}
        </div>
      </aside>
    </div>
  );
}

function CommandCenterTopBar({ loading, onRefresh, preview = false }) {
  return (
    <TopBar
      title="مركز قيادة الوكلاء"
      subtitle="CEO ← الفرق والإدارات ← الوكلاء"
      hidePartnerSelector={preview}
      actions={<SecondaryButton icon={RotateCw} onClick={onRefresh} disabled={loading} className="acc-refresh-button" title="تحديث بيانات الوكلاء"><span className="acc-visually-hidden">تحديث بيانات الوكلاء</span><span className="hidden sm:inline" aria-hidden="true">{loading ? 'جارٍ التحديث' : 'تحديث البيانات'}</span></SecondaryButton>}
    />
  );
}

function AccessDenied() {
  return (
    <><CommandCenterTopBar loading={false} onRefresh={NOOP} /><main className="acc-access-denied" dir="rtl"><Card className="acc-access-card"><ShieldCheck size={38} /><h1>مركز قيادة الوكلاء</h1><p>هذه الصفحة متاحة للمدير والمحاسب فقط.</p></Card></main></>
  );
}

export function AgentCommandCenterView({
  snapshot = EMPTY_COMMAND_CENTER_SNAPSHOT,
  loading = false,
  error = null,
  onRefresh = NOOP,
  onLoadCaseHistory = null,
  preview = false,
}) {
  const reducedMotion = usePrefersReducedMotion();
  const organization = useMemo(() => assembleAgentOrganization(snapshot.agents), [snapshot.agents]);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [activeTeamId, setActiveTeamId] = useState(null);
  const returnFocusRef = useRef(null);
  const selectedAgent = snapshot.agents.find((agent) => agent.id === selectedAgentId) || null;
  const closeAgent = useCallback(() => setSelectedAgentId(null), []);
  const selectTeam = useCallback((teamId) => setActiveTeamId((current) => (current === teamId ? null : teamId)), []);
  const openAgent = useCallback((agent, trigger) => {
    returnFocusRef.current = trigger;
    setActiveTeamId(agent.teamId);
    setSelectedAgentId(agent.id);
  }, []);

  return (
    <>
      <CommandCenterTopBar loading={loading} onRefresh={onRefresh} preview={preview} />
      <main className="acc-page" dir="rtl" data-motion={reducedMotion ? 'reduced' : 'full'}>
        <Card className="acc-summary-strip" role="region" aria-label="الملخص التنفيذي للوكلاء" aria-busy={loading}>
          <div className="acc-summary-item"><span className="acc-summary-icon" data-tone="primary"><Bot size={17} /></span><p>مسجّلون<strong className="tabular-nums">{snapshot.agents.length}</strong><small>لا يشمل CEO أو الفرق</small></p></div>
          <div className="acc-summary-item"><span className="acc-summary-icon" data-tone="success"><Activity size={17} /></span><p>متصلون<strong className="tabular-nums">{loading || error ? '—' : snapshot.summary.connected}</strong><small>{loading || error ? 'القراءة غير مكتملة' : `${snapshot.summary.running} يعمل الآن`}</small></p></div>
          <div className="acc-summary-item"><span className="acc-summary-icon" data-tone={snapshot.summary.stale ? 'warning' : 'neutral'}><AlertTriangle size={17} /></span><p>متأخرو التحديث<strong className="tabular-nums">{loading || error ? '—' : snapshot.summary.stale}</strong><small>{loading || error ? 'القراءة غير مكتملة' : `${snapshot.summary.critical} حرج · ${snapshot.summary.warning} يحتاج انتباهًا`}</small></p></div>
          <div className="acc-summary-item"><span className="acc-summary-icon" data-tone={snapshot.approvals.length ? 'warning' : 'neutral'}><ClipboardCheck size={17} /></span><p>الموافقات<strong className="tabular-nums">{loading || error ? '—' : snapshot.approvals.length}</strong></p></div>
        </Card>
        <div className="acc-ceo-brief" role="region" aria-label="ما يحتاج قرار CEO"><Crown size={18} /><p><strong>أمام CEO</strong><span>{loading ? 'جارٍ التحقق من البيانات…' : error ? 'القراءة غير مكتملة؛ لا تعتمد الأعداد الحالية.' : `${snapshot.approvals.length} طلب موافقة · ${snapshot.alerts.filter((alert) => alert.severity === 'critical').length} تنبيه حرج · ${snapshot.agents.filter((agent) => agent.isTeamLeader && agent.managerReview).length} ملخص مدير موثق`}</span></p><small>متابعة فقط؛ لا تنفيذ تلقائي</small></div>

        <Card className="acc-network-card">
          <header className="acc-network-header">
            <div className="acc-network-title"><p>الهيكل التنظيمي</p><h2>CEO ← الفرق ومديروها ← {organization.agentCount} وكيلاً</h2><span>اضغط فريقًا لإبرازه، أو مديرًا/وكيلاً لفتح التفاصيل.</span></div>
            <div className="acc-network-actions">
              {activeTeamId ? <button type="button" onClick={() => setActiveTeamId(null)}>عرض كل الفرق</button> : null}
              <div className="acc-legend" role="group" aria-label="دليل ألوان الحالة">{Object.keys(AGENT_STATUS).map((key) => <StatusPill key={key} status={key} compact />)}</div>
            </div>
            {!snapshot.hasLiveData && !loading ? <div className="acc-network-notice" role="status"><FileClock size={15} /><span>لم تُستلم حالات تشغيل بعد؛ الوكلاء ظاهرون بالرمادي حتى تصل بيانات حقيقية.</span></div> : null}
            {error ? <div className="acc-network-notice" data-tone="error" role="alert"><BellRing size={15} /><span>تعذّر قراءة بيانات مركز القيادة، ولم تُعرض بيانات بديلة.</span></div> : null}
          </header>
          <OrganizationMap organization={organization} activeTeamId={activeTeamId} onSelectTeam={selectTeam} onOpenAgent={openAgent} approvals={snapshot.approvals.length} alerts={snapshot.alerts.length} />
        </Card>

        <ExecutiveConsole snapshot={snapshot} onLoadCaseHistory={onLoadCaseHistory} />

        <AgentDetailsDrawer key={selectedAgent?.id || 'closed'} agent={selectedAgent} onClose={closeAgent} returnFocusRef={returnFocusRef} />
      </main>
    </>
  );
}

export default function AgentCommandCenterPage({ role, preview = false }) {
  const center = useAgentCommandCenter(role);
  if (!COMMAND_CENTER_ROLES.includes(role) && !preview) return <AccessDenied />;
  return <AgentCommandCenterView snapshot={center} loading={center.loading} error={center.error} onRefresh={center.refresh} onLoadCaseHistory={!preview && center.allowed ? loadAgentCaseHistory : null} preview={preview} />;
}
