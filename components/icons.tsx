import {
  Baby, Banknote, Briefcase, Building2, Car, CirclePlus, Coffee, CreditCard, Dumbbell, Flame, Fuel, Gamepad2, Gift,
  GraduationCap, HeartPulse, House, Landmark, Music, PawPrint, PiggyBank, Plane, Receipt, Shield, Shirt, ShoppingCart,
  Smartphone, Sparkles, Tag, TrendingUp, Tv, Utensils, Wallet, Wifi, Wrench, Zap, type LucideIcon,
} from "lucide-react";
import type { AccountType } from "@/lib/types";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  home: House, zap: Zap, flame: Flame, wifi: Wifi, car: Car, fuel: Fuel, shield: Shield, wrench: Wrench,
  "heart-pulse": HeartPulse, landmark: Landmark, sparkles: Sparkles, briefcase: Briefcase, "plus-circle": CirclePlus,
  tag: Tag, cart: ShoppingCart, food: Utensils, education: GraduationCap, travel: Plane, gift: Gift, gym: Dumbbell,
  pet: PawPrint, baby: Baby, clothes: Shirt, games: Gamepad2, phone: Smartphone, tv: Tv, music: Music, coffee: Coffee,
  savings: PiggyBank, invest: TrendingUp, receipt: Receipt,
};

export const ACCOUNT_ICONS: Record<AccountType, LucideIcon> = {
  cash: Banknote, bank: Building2, card: CreditCard, wallet: Wallet, savings: PiggyBank,
};

export const PALETTE = [
  // Paleta categórica validada (CVD/contraste) — orden fijo
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948", "#64748b",
];

export function CatIcon({ icon, color, size = 18, box = 36 }: { icon: string; color: string; size?: number; box?: number }) {
  const I = CATEGORY_ICONS[icon] ?? Tag;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-xl"
      style={{ width: box, height: box, backgroundColor: color + "1f", color }}
    >
      <I size={size} />
    </span>
  );
}
