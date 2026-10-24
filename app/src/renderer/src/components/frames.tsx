import type { CSSProperties, ReactNode, SVGProps } from 'react';

// Avatar frames, drawn here so there are no image files to license.
// Every frame uses a 120×120 box with the avatar's rounded square at 20..100
// (corner radius 23, like .av), so the frame sticks out 25% on each side.

export const BONE = '#efe6d2';

export type FrameDef = { id: string; name: string; defaultColor?: string };

export const FRAMES: FrameDef[] = [
  { id: 'skulls', name: 'Skull crown', defaultColor: BONE },
  { id: 'skull-bones', name: 'Jolly Roger', defaultColor: BONE },
  { id: 'flames', name: 'Flames', defaultColor: '#ff7a1a' },
  { id: 'horns', name: 'Horns', defaultColor: '#ff3b4f' },
  { id: 'halo', name: 'Halo', defaultColor: '#ffd75e' },
  { id: 'crown', name: 'Crown', defaultColor: '#ffc53d' },
  { id: 'cat-ears', name: 'Cat ears' },
  { id: 'lightning', name: 'Lightning', defaultColor: '#7df9ff' },
  { id: 'neon-ring', name: 'Neon ring' },
  { id: 'glitch', name: 'Glitch' },
  { id: 'spikes', name: 'Spiked' },
];

export const frameById = (id: string | null | undefined) => FRAMES.find((f) => f.id === id);

const INK = '#0b0c10';
const HALF = 40; // avatar half size in frame units
const R = 23; // avatar corner radius
const C = HALF - R; // corner centres sit at 60 ± C

/**
 * A point on the avatar outline pushed out by `d`, at `t` (0..1 clockwise from
 * the top centre), with the outward direction in degrees.
 */
function outline(t: number, d = 0): { x: number; y: number; a: number } {
  const r = R + d;
  const h = HALF + d;
  const arc = (Math.PI / 2) * r;
  const total = 8 * C + 4 * arc;
  let u = (((t % 1) + 1) % 1) * total;
  const corner = (cx: number, cy: number, from: number) => {
    const a = from + (u / arc) * 90;
    const rad = (a * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad), a };
  };
  if ((u -= 0) < C) return { x: 60 + u, y: 60 - h, a: -90 };
  if ((u -= C) < arc) return corner(60 + C, 60 - C, -90);
  if ((u -= arc) < 2 * C) return { x: 60 + h, y: 60 - C + u, a: 0 };
  if ((u -= 2 * C) < arc) return corner(60 + C, 60 + C, 0);
  if ((u -= arc) < 2 * C) return { x: 60 + C - u, y: 60 + h, a: 90 };
  if ((u -= 2 * C) < arc) return corner(60 - C, 60 + C, 90);
  if ((u -= arc) < 2 * C) return { x: 60 - h, y: 60 + C - u, a: 180 };
  if ((u -= 2 * C) < arc) return corner(60 - C, 60 - C, 180);
  u -= arc;
  return { x: 60 - C + u, y: 60 - h, a: 270 };
}

/** The avatar outline pushed out by `d`, as a rect. */
const Ring = ({ out, ...rest }: { out: number } & SVGProps<SVGRectElement>) => (
  <rect x={20 - out} y={20 - out} width={80 + 2 * out} height={80 + 2 * out} rx={R + out} fill="none" {...rest} />
);

/** Places children at a point on the outline, rotated so "up" points outward. */
function At({ t, d, scale = 1, tilt = 0, children }: { t: number; d: number; scale?: number; tilt?: number; children: ReactNode }) {
  const p = outline(t, d);
  return <g transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${(p.a + 90 + tilt).toFixed(1)}) scale(${scale})`}>{children}</g>;
}

// A skull about 14 wide and 16 tall, centred on 0,0, facing up.
const Skull = () => (
  <g>
    <path
      d="M-7,0.5 C-7.4,-5.2 -4,-8.4 0,-8.4 C4,-8.4 7.4,-5.2 7,0.5 C6.8,2.8 5.6,3.8 4.6,4.3 L4.4,7.6 L-4.4,7.6 L-4.6,4.3 C-5.6,3.8 -6.8,2.8 -7,0.5 Z"
      fill="currentColor"
    />
    <ellipse cx="-2.9" cy="-0.6" rx="2.15" ry="2.45" fill={INK} />
    <ellipse cx="2.9" cy="-0.6" rx="2.15" ry="2.45" fill={INK} />
    <path d="M0,1.9 L-1.15,4 L1.15,4 Z" fill={INK} />
    <path d="M-2.2,5.2 V7.6 M0,5.2 V7.6 M2.2,5.2 V7.6" stroke={INK} strokeWidth="0.9" strokeLinecap="round" />
  </g>
);

const Bone = ({ angle }: { angle: number }) => (
  <g transform={`rotate(${angle})`}>
    <rect x="-15" y="-2.2" width="30" height="4.4" rx="2.2" fill="currentColor" />
    {[-15, 15].flatMap((x) => [-2.4, 2.4].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="3.1" fill="currentColor" />))}
  </g>
);

// A flame about 12 wide, rising 17 above its base at 0,0.
const FLAME = 'M0,-17 C2.6,-11 7,-8 6,-2.4 C5.4,1.2 3,3 0,3 C-3,3 -5.4,1.2 -6,-2.4 C-6.6,-6.4 -2.4,-8.6 0,-17 Z';
const BOLT = 'M1.5,-10 L-4.5,1 L-0.5,1 L-2.5,10 L4.5,-2 L0.5,-2 L2.5,-10 Z';

// Small pseudo-random numbers, so every flame is different but stable between renders.
const wobble = (i: number) => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;

const DRAW: Record<string, () => ReactNode> = {
  skulls: () => (
    <>
      <Ring out={3} stroke="currentColor" strokeWidth={1.6} opacity={0.55} />
      {[-0.115, -0.058, 0.058, 0.115].map((t) => (
        <At key={t} t={t} d={8} scale={0.95}><Skull /></At>
      ))}
      <At t={0} d={10} scale={1.3}><Skull /></At>
    </>
  ),

  'skull-bones': () => {
    const p = outline(0.375, 3);
    return (
      <g transform={`translate(${p.x} ${p.y})`}>
        <circle r="17" fill={INK} opacity="0.55" />
        <Bone angle={40} />
        <Bone angle={-40} />
        <g transform="scale(1.45)"><Skull /></g>
      </g>
    );
  },

  flames: () => (
    <>
      <Ring out={1.5} stroke="currentColor" strokeWidth={2.4} opacity={0.85} />
      {Array.from({ length: 17 }, (_, i) => {
        // From the bottom-left round the top to the bottom-right; fire leans upward.
        const t = 0.6 + (i / 16) * 0.8;
        // Turn each flame 45% of the way from pointing outward to pointing up.
        const outward = ((outline(t).a + 90 + 540) % 360) - 180;
        const lean = -outward * 0.45;
        const size = 0.7 + wobble(i) * 0.55;
        return (
          <At key={i} t={t} d={1} tilt={lean} scale={size}>
            <g className="fr-flick" style={{ animationDelay: `${(-wobble(i + 7) * 1.2).toFixed(2)}s` }}>
              <path d={FLAME} fill="currentColor" opacity="0.9" />
              <path d={FLAME} fill="#fff4cc" opacity="0.75" transform="translate(0 1.5) scale(0.5)" />
            </g>
          </At>
        );
      })}
    </>
  ),

  horns: () => {
    const horn = (
      <>
        <path d="M70,21.5 C76,12 87,7 101,2 C96,11 94,21 90,30 C85,24.5 78,21.5 70,21.5 Z" fill="currentColor" />
        <path d="M76,18 C83,12 91,8 99,4 C94,10 91,17 88,24" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M70,21.5 C76,12 87,7 101,2 C96,11 94,21 90,30" fill="none" stroke={INK} strokeOpacity="0.45" strokeWidth="1" />
      </>
    );
    return (
      <>
        {horn}
        <g transform="translate(120 0) scale(-1 1)">{horn}</g>
      </>
    );
  },

  halo: () => (
    <g className="fr-float">
      <ellipse cx="60" cy="9" rx="27" ry="6.5" fill="none" stroke="currentColor" strokeWidth="3.4" />
      <ellipse cx="60" cy="9" rx="27" ry="6.5" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="1" />
    </g>
  ),

  crown: () => (
    <g transform="rotate(-13 44 22) translate(-7 1)">
      <path d="M37,24 L33.5,5 L47,14 L60,0.5 L73,14 L86.5,5 L83,24 Z" fill="currentColor" strokeLinejoin="round" />
      <rect x="36.5" y="18.5" width="47" height="6" rx="1.5" fill={INK} opacity="0.28" />
      <path d="M39,12 L47,17 L60,5 L73,17 L81,12" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="1.1" strokeLinejoin="round" />
      {[33.5, 60, 86.5].map((x, i) => <circle key={x} cx={x} cy={i === 1 ? 0.5 : 5} r="2.6" fill="#fff" opacity="0.92" />)}
      <circle cx="60" cy="21.5" r="2.4" fill="#ff3b6b" />
      <circle cx="48" cy="21.5" r="1.7" fill="#2de2ff" />
      <circle cx="72" cy="21.5" r="1.7" fill="#2de2ff" />
    </g>
  ),

  'cat-ears': () => {
    const ear = (
      <>
        <path d="M21,41 L14,5 L49,20 Z" fill="currentColor" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
        <path d="M24.5,32 L20.5,13 L40,21.5 Z" fill="#fff" opacity="0.38" strokeLinejoin="round" />
      </>
    );
    return (
      <>
        {ear}
        <g transform="translate(120 0) scale(-1 1)">{ear}</g>
      </>
    );
  },

  lightning: () => (
    <>
      <Ring out={3} stroke="currentColor" strokeWidth={1.6} strokeDasharray="2 6" strokeLinecap="round" opacity={0.75} />
      {[0.08, 0.34, 0.6, 0.86].map((t, i) => (
        <At key={t} t={t} d={7} tilt={i % 2 ? 18 : -18} scale={1.15}>
          <path className="fr-flash" style={{ animationDelay: `${i * 0.37}s` }} d={BOLT} fill="currentColor" stroke="#fff" strokeOpacity="0.6" strokeWidth="0.6" strokeLinejoin="round" />
        </At>
      ))}
    </>
  ),

  'neon-ring': () => (
    <>
      <Ring out={3} stroke="currentColor" strokeWidth={2.6} />
      <Ring out={3} stroke="#fff" strokeOpacity={0.5} strokeWidth={0.8} />
      <Ring out={8.5} className="fr-march" stroke="currentColor" strokeWidth={1.5} strokeDasharray="11 7" strokeLinecap="round" opacity={0.8} />
    </>
  ),

  glitch: () => (
    <>
      <g className="fr-jitter-a"><Ring out={3} stroke="#ff2bd6" strokeWidth={2.4} opacity={0.85} /></g>
      <g className="fr-jitter-b"><Ring out={3} stroke="#2de2ff" strokeWidth={2.4} opacity={0.85} /></g>
      <Ring out={3} stroke="currentColor" strokeWidth={2} />
      <rect className="fr-blink" x="86" y="30" width="16" height="3" fill="#2de2ff" />
      <rect className="fr-blink" style={{ animationDelay: '0.6s' }} x="14" y="78" width="12" height="2.5" fill="#ff2bd6" />
      <rect className="fr-blink" style={{ animationDelay: '1.1s' }} x="40" y="101" width="20" height="2.5" fill="currentColor" />
    </>
  ),

  spikes: () => (
    <>
      {Array.from({ length: 20 }, (_, i) => (
        <At key={i} t={i / 20} d={2.5}>
          <path d="M-3.6,1 L0,-9 L3.6,1 Z" fill="currentColor" stroke={INK} strokeOpacity="0.35" strokeWidth="0.6" strokeLinejoin="round" />
        </At>
      ))}
      <Ring out={2.5} stroke="currentColor" strokeWidth={4} />
      <Ring out={2.5} stroke={INK} strokeOpacity={0.35} strokeWidth={0.8} strokeDasharray="1 5.5" />
    </>
  ),
};

/** Draws a frame around an avatar of `size` px. The parent must be position: relative. */
export function Frame({ id, color, size }: { id: string; color: string; size: number }) {
  const draw = DRAW[id];
  if (!draw) return null;
  const box = size * 1.5;
  return (
    <svg
      className="av-frame"
      viewBox="0 0 120 120"
      aria-hidden="true"
      style={{ width: box, height: box, left: -size * 0.25, top: -size * 0.25, '--fc': color } as CSSProperties}
    >
      {draw()}
    </svg>
  );
}
