import type { Platform } from "@/lib/types";

// Real platform logos (inline SVG, brand colors) — used instead of emoji
// throughout the dashboard, admin, and client-edit screens.
export default function PlatformIcon({ platform, size = 20 }: { platform: Platform; size?: number }) {
  switch (platform) {
    case "youtube":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="YouTube">
          <rect width="24" height="24" rx="6" fill="#FF0000" />
          <path d="M10 8.2 16 12l-6 3.8V8.2Z" fill="#fff" />
        </svg>
      );

    case "instagram":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Instagram">
          <defs>
            <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#FFDD55" />
              <stop offset="50%" stopColor="#FF543E" />
              <stop offset="100%" stopColor="#C837AB" />
            </linearGradient>
          </defs>
          <rect width="24" height="24" rx="6" fill="url(#ig-grad)" />
          <rect x="6" y="6" width="12" height="12" rx="4" fill="none" stroke="#fff" strokeWidth="1.6" />
          <circle cx="12" cy="12" r="3" fill="none" stroke="#fff" strokeWidth="1.6" />
          <circle cx="15.5" cy="8.5" r="0.9" fill="#fff" />
        </svg>
      );

    case "facebook":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Facebook">
          <rect width="24" height="24" rx="6" fill="#1877F2" />
          <path
            d="M15.4 8.4h-1.5c-.5 0-.9.4-.9.9v1.3h2.3l-.3 2.1h-2v5.3h-2.1v-5.3H9v-2.1h1.9V9c0-1.7 1.1-3 2.9-3h1.6v2.4Z"
            fill="#fff"
          />
        </svg>
      );

    case "gbp":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Google Business Profile">
          <rect width="24" height="24" rx="6" fill="#F1F3F4" />
          <g transform="translate(2.5 2.5) scale(0.78)">
            <path
              fill="#4285F4"
              d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v2.84h3.86c2.26-2.09 3.56-5.17 3.56-8.66z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-2.84c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.27v2.92C3.26 21.3 7.31 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.27 14.45c-.24-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V7H1.27C.46 8.56 0 10.22 0 12s.46 3.44 1.27 5l4-2.55z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.27 6.99l4 2.27c.95-2.85 3.6-4.51 6.73-4.51z"
            />
          </g>
        </svg>
      );

    default:
      return null;
  }
}
