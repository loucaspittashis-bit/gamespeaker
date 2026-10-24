type Props = {
  name: string;
  color: string;
  size: 20 | 26 | 32 | 34 | 36 | 40 | 50 | 64 | 84 | 96;
  speaking?: boolean;
  status?: boolean;
};

export function Avatar({ name, color, size, speaking, status }: Props) {
  const el = (
    <span className={`av sz${size}${speaking ? ' speaking' : ''}`} style={{ background: color }} aria-hidden="true">
      {(name.trim().charAt(0) || '?').toUpperCase()}
    </span>
  );
  if (!status) return el;
  return (
    <span style={{ position: 'relative', flex: 'none', display: 'inline-flex' }}>
      {el}
      <span className="status-dot" />
    </span>
  );
}
