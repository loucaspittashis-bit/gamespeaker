import type { ReactNode } from 'react';

type IconProps = { size?: 's' | 'xs' | 'l'; label?: string; className?: string };

function Svg({ size, label, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={['i', size, className].filter(Boolean).join(' ')}
      viewBox="0 0 24 24"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {children}
    </svg>
  );
}

const make = (paths: ReactNode) => (p: IconProps) => <Svg {...p}>{paths}</Svg>;

export const LogoIcon = make(
  <>
    <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    <path d="M8 10.5v1M11 8.5v5M14 9.5v3M17 10.5v1" />
  </>,
);
export const SpeakerIcon = make(
  <>
    <path d="M11 5 6 9H2v6h4l5 4V5z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
  </>,
);
export const SpeakerOffIcon = make(
  <>
    <path d="M11 5 6 9H2v6h4l5 4V5z" />
    <path d="M23 9l-6 6M17 9l6 6" />
  </>,
);
export const HashIcon = make(<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />);
export const MicIcon = make(
  <>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />
  </>,
);
export const MicOffIcon = make(
  <>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M3 3l18 18" />
  </>,
);
export const HeadphonesIcon = make(
  <>
    <path d="M3 15v-3a9 9 0 0 1 18 0v3" />
    <rect x="2" y="14" width="5" height="7" rx="2" />
    <rect x="17" y="14" width="5" height="7" rx="2" />
  </>,
);
export const HeadphonesOffIcon = make(
  <>
    <path d="M3 15v-3a9 9 0 0 1 18 0v3" />
    <rect x="2" y="14" width="5" height="7" rx="2" />
    <rect x="17" y="14" width="5" height="7" rx="2" />
    <path d="M3 3l18 18" />
  </>,
);
export const GearIcon = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>,
);
export const PhoneOffIcon = make(
  <>
    <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
    <path d="M23 1 1 23" />
  </>,
);
export const ScreenIcon = make(
  <>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4M12 13V7M9 10l3-3 3 3" />
  </>,
);
export const SignalIcon = make(<path d="M4 20v-3M9 20v-7M14 20v-11M19 20V5" />);
export const WaveIcon = make(<path d="M3 12h1M7 8v8M11 5v14M15 8v8M19 10v4" />);
export const EyeIcon = make(
  <>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const MaximizeIcon = make(<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />);
export const MinimizeIcon = make(<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />);
export const PopoutIcon = make(<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />);
export const ChatIcon = make(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />);
export const CloseIcon = make(<path d="M18 6 6 18M6 6l12 12" />);
export const CheckIcon = make(<path d="M20 6 9 17l-5-5" />);
export const SendIcon = make(<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />);
export const PaletteIcon = make(
  <>
    <path d="M12 22a10 10 0 1 1 10-10c0 2.5-2 3.5-4 3.5h-2a2 2 0 0 0-1.5 3.3c.6.7.4 1.7-.4 2.4-.6.5-1.3.8-2.1.8z" />
    <circle cx="7.5" cy="11" r="1.2" className="f" />
    <circle cx="10.5" cy="7" r="1.2" className="f" />
    <circle cx="15" cy="7.5" r="1.2" className="f" />
  </>,
);
export const LockIcon = make(
  <>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>,
);
export const ArrowRightIcon = make(<path d="M5 12h14M13 6l6 6-6 6" />);
export const ChevronUpIcon = make(<path d="m18 15-6-6-6 6" />);
export const ChevronDownIcon = make(<path d="m6 9 6 6 6-6" />);
export const PlusIcon = make(<path d="M12 5v14M5 12h14" />);
export const TrashIcon = make(<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />);
