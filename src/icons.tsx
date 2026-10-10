import type { CSSProperties, ReactElement } from 'react'

const P = {
  back: <path d="M10 3.5 5.5 8l4.5 4.5" />,
  forward: <path d="M6 3.5 10.5 8 6 12.5" />,
  down: <path d="M3.5 6 8 10.5 12.5 6" />,
  up: <path d="M3.5 10 8 5.5l4.5 4.5" />,
  plus: <path d="M8 3v10M3 8h10" />,
  minus: <path d="M3.5 8h9" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  check: <path d="M3.2 8.4 6.4 11.5 12.8 4.8" />,
  arrow: <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" />,
  gear: (
    <>
      <path d="M2.5 5h6.2M12.3 5h1.2M2.5 11h1.2M7.3 11h6.2" />
      <circle cx="10.5" cy="5" r="1.7" />
      <circle cx="5.5" cy="11" r="1.7" />
    </>
  ),
  folder: <path d="M2.5 4.8c0-.7.6-1.3 1.3-1.3h2.6l1.4 1.5h4.4c.7 0 1.3.6 1.3 1.3v5.4c0 .7-.6 1.3-1.3 1.3H3.8c-.7 0-1.3-.6-1.3-1.3z" />,
  download: (
    <>
      <path d="M8 2.5v7M5.2 6.9 8 9.7l2.8-2.8" />
      <path d="M2.8 9.5v2.7c0 .5.4.8.8.8h8.8c.4 0 .8-.3.8-.8V9.5" />
    </>
  ),
  desktop: (
    <>
      <rect x="2" y="3" width="12" height="8" rx="1.4" />
      <path d="M6 13.5h4M8 11v2.5" />
    </>
  ),
  file: (
    <>
      <path d="M4 2.5h5l3 3v8H4z" />
      <path d="M9 2.5v3h3" />
    </>
  ),
  document: (
    <>
      <path d="M4 2.5h5l3 3v8H4z" />
      <path d="M9 2.5v3h3M6 8h4M6 10.5h4" />
    </>
  ),
  pdf: (
    <>
      <path d="M4 2.5h5l3 3v8H4z" />
      <path d="M9 2.5v3h3" />
      <path d="M5.6 11.2c1.6-.8 3.3-3.4 2.6-4.3-.6-.7-1.3 1.6.3 3.1 1 .9 2.1 1 1.9.5-.2-.6-2.4-.5-4.8.7z" strokeWidth="1" />
    </>
  ),
  image: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.6" />
      <circle cx="6" cy="6.5" r="1.1" />
      <path d="M13.5 10.5 10.4 7.6 4.5 13" />
    </>
  ),
  screenshot: (
    <>
      <path d="M2.5 5.5V4c0-.6.4-1 1-1h1.5M11 3h1.5c.6 0 1 .4 1 1v1.5M13.5 10.5V12c0 .6-.4 1-1 1H11M5 13H3.5c-.6 0-1-.4-1-1v-1.5" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  video: (
    <>
      <rect x="2" y="4" width="8.5" height="8" rx="1.6" />
      <path d="M10.5 7 14 5v6l-3.5-2" />
    </>
  ),
  audio: (
    <>
      <path d="M6 11.5V3.5l6.5-1.2v7.7" />
      <circle cx="4.6" cy="11.6" r="1.6" />
      <circle cx="11.1" cy="10.1" r="1.6" />
    </>
  ),
  spreadsheet: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.6" />
      <path d="M2.5 6.5h11M2.5 9.8h11M6.2 3v10" />
    </>
  ),
  presentation: (
    <>
      <rect x="2" y="2.8" width="12" height="8" rx="1.4" />
      <path d="M8 10.8v2.6M5.5 13.4h5" />
      <path d="M5 8.2 7 6.3l1.6 1.4L11 5.4" />
    </>
  ),
  archive: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.6" />
      <path d="M8 2.5v1.4M8 5.2v1.4M8 7.9v1.4" />
      <rect x="6.8" y="9.6" width="2.4" height="2.2" rx=".6" />
    </>
  ),
  installer: (
    <>
      <path d="M8 2.2 13.5 5v6L8 13.8 2.5 11V5z" />
      <path d="M2.5 5 8 7.8 13.5 5M8 7.8v6" />
    </>
  ),
  code: <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13" />,
  font: <path d="M3 13 6.5 3.5h1L11 13M4.4 9.5h5.2M11.5 8.8c.5-.6 1.1-.8 1.7-.8 1 0 1.3.6 1.3 1.4V13M14.5 10.6c-1.8 0-3 .4-3 1.3 0 .6.5 1.1 1.2 1.1.9 0 1.8-.6 1.8-1.8" />,
  ebook: <path d="M8 4.3C6.6 3.2 4.6 3 2.5 3.2v9.1c2.1-.2 4.1 0 5.5 1.1 1.4-1.1 3.4-1.3 5.5-1.1V3.2c-2.1-.2-4.1 0-5.5 1.1zM8 4.3v9.1" />,
  design: (
    <>
      <path d="M8 2.5 12 8l-1.6 4.5H5.6L4 8z" />
      <path d="M8 2.5v4.2M5.6 12.5h4.8" />
      <circle cx="8" cy="7.8" r="1.1" />
    </>
  ),
  partial: (
    <>
      <circle cx="8" cy="8" r="5.5" strokeDasharray="2.2 1.8" />
      <path d="M8 5v3.6M6.4 7.2 8 8.8l1.6-1.6" />
    </>
  ),
  copies: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" />
      <path d="M10.5 5.5V3.8c0-.7-.6-1.3-1.3-1.3H3.8c-.7 0-1.3.6-1.3 1.3v5.4c0 .7.6 1.3 1.3 1.3h1.7" />
    </>
  ),
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2c0 .5.5.8 1 .8h3.8c.5 0 1-.3 1-.8l.6-8.2" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3 3" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2 1.3" />
    </>
  ),
  shield: <path d="M8 2.3 13 4v4c0 3-2.2 5-5 5.8C5.2 13 3 11 3 8V4z" />,
  refresh: <path d="M12.8 6.2A5 5 0 1 0 13 9M13 3v3.4H9.6" />,
  history: (
    <>
      <path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.8v2.4h2.4" />
      <path d="M8 5.5v2.8l1.8 1.1" />
    </>
  ),
  undo: <path d="M5.5 6.5h5a3 3 0 0 1 0 6H7.5M7.8 4 5.3 6.5 7.8 9" />,
  more: (
    <>
      <circle cx="3.8" cy="8" r=".9" fill="currentColor" />
      <circle cx="8" cy="8" r=".9" fill="currentColor" />
      <circle cx="12.2" cy="8" r=".9" fill="currentColor" />
    </>
  ),
  overview: (
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.2" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1.2" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1.2" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1.2" />
    </>
  ),
  list: <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.6 4h.01M2.6 8h.01M2.6 12h.01" />,
  rules: (
    <>
      <path d="M2.5 4.5h4M9.5 4.5h4M2.5 11.5h7M12.5 11.5h1" />
      <path d="M6.5 2.8v3.4M9.5 2.8v3.4M9.5 9.8v3.4M12.5 9.8v3.4" />
    </>
  ),
  sparkle: <path d="M8 2.2c.4 2.9 1.5 4.3 4.6 4.8-3.1.5-4.2 1.9-4.6 4.8-.4-2.9-1.5-4.3-4.6-4.8 3.1-.5 4.2-1.9 4.6-4.8z" />,
  sort: (
    <>
      <path d="M2.5 13.5 9.5 6.5" />
      <path d="M11 2v2.6M9.7 3.3h2.6M13.4 6.3v1.8M12.5 7.2h1.8M5.6 2.8v1.6M4.8 3.6h1.6" />
    </>
  ),
  inspector: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <path d="M10 3v10" />
    </>
  ),
  alert: (
    <>
      <path d="M8 2.6 14 13H2z" />
      <path d="M8 6.6v2.8M8 11.2h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7.3v3.6M8 5.2h.01" />
    </>
  ),
  grip: <path d="M6 4.5h.01M10 4.5h.01M6 8h.01M10 8h.01M6 11.5h.01M10 11.5h.01" strokeWidth="2" />,
  open: (
    <>
      <path d="M6 3.5h6.5V10" />
      <path d="M12.5 3.5 4 12" />
    </>
  ),
  move: (
    <>
      <path d="M2.5 4.8c0-.7.6-1.3 1.3-1.3h2.6l1.4 1.5h4.4c.7 0 1.3.6 1.3 1.3v5.4c0 .7-.6 1.3-1.3 1.3H3.8c-.7 0-1.3-.6-1.3-1.3z" />
      <path d="M6 9h4M8.6 7.4 10.2 9l-1.6 1.6" />
    </>
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c1.6 1.6 2.3 3.4 2.3 5.5S9.6 11.9 8 13.5C6.4 11.9 5.7 10.1 5.7 8S6.4 4.1 8 2.5z" />
    </>
  ),
  bolt: <path d="M9 2 3.8 9h3.6L7 14l5.2-7H8.6z" />,
} satisfies Record<string, ReactElement>

export type IconName = keyof typeof P

export function Icon({ name, size = 16, style, className, strokeWidth = 1.5 }: { name: IconName; size?: number; style?: CSSProperties; className?: string; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden
    >
      {P[name]}
    </svg>
  )
}
