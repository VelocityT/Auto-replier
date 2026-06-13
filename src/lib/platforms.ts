import type { Platform } from "@/lib/types";

export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  gbp: "Google Business",
};

export const PLATFORM_ORDER: Platform[] = ["gbp", "youtube", "instagram", "facebook"];
