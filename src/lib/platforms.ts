import type { Platform } from "@/lib/types";

export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  gbp: "Google Business",
};

export const PLATFORM_ICONS: Record<Platform, string> = {
  instagram: "\u{1F4F8}",
  facebook: "\u{1F44D}",
  youtube: "\u{25B6}\u{FE0F}",
  gbp: "\u{2B50}",
};

export const PLATFORM_ORDER: Platform[] = ["gbp", "youtube", "instagram", "facebook"];
