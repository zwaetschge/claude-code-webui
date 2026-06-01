import { useId } from 'react';

export type ToolLoaderKind = 'read' | 'write' | 'edit' | 'shell' | 'web' | 'agent' | 'generic';

const READ_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'read_file',
  'read_many_files',
  'list_directory',
  'grep_search',
  'glob',
  'TodoRead',
]);
const WRITE_TOOLS = new Set(['Write', 'write_file', 'TodoWrite']);
const EDIT_TOOLS = new Set(['Edit', 'replace', 'MultiEdit']);
const SHELL_TOOLS = new Set(['Bash', 'shell', 'run_shell_command']);
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch']);
const AGENT_TOOLS = new Set(['Task', 'Agent']);

export function toolLoaderKind(toolName: string): ToolLoaderKind {
  if (READ_TOOLS.has(toolName)) return 'read';
  if (WRITE_TOOLS.has(toolName)) return 'write';
  if (EDIT_TOOLS.has(toolName)) return 'edit';
  if (SHELL_TOOLS.has(toolName)) return 'shell';
  if (WEB_TOOLS.has(toolName)) return 'web';
  if (AGENT_TOOLS.has(toolName)) return 'agent';
  return 'generic';
}

export function ToolLoader({ toolName, size = 28 }: { toolName: string; size?: number }) {
  const kind = toolLoaderKind(toolName);
  switch (kind) {
    case 'read':
      return <ReadLoader size={size} />;
    case 'write':
      return <WriteLoader size={size} />;
    case 'edit':
      return <EditLoader size={size} />;
    case 'shell':
      return <ShellLoader size={size} />;
    case 'web':
      return <WebLoader size={size} />;
    case 'agent':
      return <AgentLoader size={size} />;
    case 'generic':
    default:
      return <GenericLoader size={size} />;
  }
}

/* Inline goo filter — self-contained per loader so nothing has to live
 * in a global svg defs block. stdDeviation 3 keeps blobs legible at
 * small icon sizes while still merging them cleanly. */
function GooFilter({ id, blur = 3 }: { id: string; blur?: number }) {
  return (
    <filter id={id}>
      <feGaussianBlur stdDeviation={blur} />
      <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -9" />
    </filter>
  );
}

/* read: soft scan-wave sweeping down a document (mask-wipe / line reveal spirit) */
function ReadLoader({ size }: { size: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <clipPath id={`${id}-clip`}>
          <rect x="8" y="6" width="24" height="28" rx="3" />
        </clipPath>
        <linearGradient id={`${id}-beam`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
          <stop offset="50%" stopColor="currentColor" stopOpacity="0.85" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect
        x="8"
        y="6"
        width="24"
        height="28"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.45"
      />
      <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.3">
        <line x1="12" y1="13" x2="28" y2="13" />
        <line x1="12" y1="18" x2="26" y2="18" />
        <line x1="12" y1="23" x2="28" y2="23" />
        <line x1="12" y1="28" x2="22" y2="28" />
      </g>
      <g clipPath={`url(#${id}-clip)`}>
        <rect
          className="tl-read-beam"
          x="8"
          y="6"
          width="24"
          height="8"
          fill={`url(#${id}-beam)`}
        />
      </g>
    </svg>
  );
}

/* write: ink drop falling into a reservoir (Organic Loaders #04 — drip) */
function WriteLoader({ size }: { size: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <GooFilter id={`${id}-goo`} blur={2.6} />
      </defs>
      <g filter={`url(#${id}-goo)`}>
        <ellipse cx="20" cy="10" rx="6" ry="4" fill="currentColor" />
        <circle className="tl-write-drop" cx="20" cy="14" r="3.2" fill="currentColor" />
      </g>
      <path
        d="M12 30 Q20 34 28 30"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        opacity="0.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* edit: two blobs swap positions and merge through each other (gooey #10) */
function EditLoader({ size }: { size: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <GooFilter id={`${id}-goo`} blur={3} />
      </defs>
      <g filter={`url(#${id}-goo)`}>
        <circle className="tl-edit-blob-a" cx="13" cy="20" r="5" fill="currentColor" />
        <circle className="tl-edit-blob-b" cx="27" cy="20" r="5" fill="currentColor" />
      </g>
    </svg>
  );
}

/* shell: row of blobs bouncing in a wave (Organic Loaders #17 — snake) */
function ShellLoader({ size }: { size: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <GooFilter id={`${id}-goo`} blur={2.4} />
      </defs>
      <g filter={`url(#${id}-goo)`}>
        <circle className="tl-shell-s1" cx="8" cy="22" r="3" fill="currentColor" />
        <circle className="tl-shell-s2" cx="16" cy="22" r="3" fill="currentColor" />
        <circle className="tl-shell-s3" cx="24" cy="22" r="3" fill="currentColor" />
        <circle className="tl-shell-s4" cx="32" cy="22" r="3" fill="currentColor" />
      </g>
    </svg>
  );
}

/* web: orbiting satellites around a central globe with subtle goo merge (#03) */
function WebLoader({ size }: { size: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <GooFilter id={`${id}-goo`} blur={2.4} />
      </defs>
      <circle
        cx="20"
        cy="20"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.35"
      />
      <ellipse
        cx="20"
        cy="20"
        rx="9"
        ry="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.3"
      />
      <g filter={`url(#${id}-goo)`}>
        <circle cx="20" cy="20" r="4.5" fill="currentColor" />
        <g className="tl-web-orbit" style={{ transformOrigin: '20px 20px' }}>
          <circle cx="32" cy="20" r="2.4" fill="currentColor" />
        </g>
      </g>
    </svg>
  );
}

/* agent: three satellites orbiting a breathing core, goo-merged at closest approach */
function AgentLoader({ size }: { size: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <GooFilter id={`${id}-goo`} blur={2.6} />
      </defs>
      <g filter={`url(#${id}-goo)`}>
        <circle className="tl-agent-core" cx="20" cy="20" r="3.4" fill="currentColor" />
        <g className="tl-agent-orbit" style={{ transformOrigin: '20px 20px' }}>
          <circle cx="31" cy="20" r="2.3" fill="currentColor" />
          <circle cx="14.5" cy="29.5" r="2.3" fill="currentColor" />
          <circle cx="14.5" cy="10.5" r="2.3" fill="currentColor" />
        </g>
      </g>
    </svg>
  );
}

/* generic: breathing ring (#05 — breathing blob) */
function GenericLoader({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle
        className="tl-generic-a"
        cx="20"
        cy="20"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle
        className="tl-generic-b"
        cx="20"
        cy="20"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}
