import { BookOpen, Backpack, Church, Compass, Flame, Flower2, Heart, Mountain, Music, Sparkles, Star, Sun, Tent, Trees, Users, Wrench, type LucideIcon } from "lucide-react";
import type { HomepageMinistryIcon } from "@/modules/system-admin/homepage-ministries-domain";

const icons: Record<HomepageMinistryIcon, LucideIcon> = {
  Compass, Backpack, Flower2, Wrench, Tent, Sparkles, Heart, BookOpen, Music, Mountain, Star, Users, Sun, Flame, Trees, Church,
};

/** One of the fixed tile icons (#1251). Decorative: the tile's name is the text. */
export function HomepageMinistryIconView({ icon, size = 28 }: { icon: HomepageMinistryIcon; size?: number }) {
  const Icon = icons[icon] ?? Users;
  return <Icon aria-hidden="true" size={size} />;
}
