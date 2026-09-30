export type AccountType = "cash" | "bank" | "card" | "wallet" | "savings";
export type CategoryKind = "expense" | "income";
export type TxType = "expense" | "income" | "transfer";
export type Frequency = "weekly" | "monthly" | "yearly";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  initial_balance: number;
  color: string;
  archived: boolean;
  balance: number;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  parent_id: string | null;
  color: string;
  icon: string;
  archived: boolean;
}

export interface Transaction {
  id: string;
  type: TxType;
  amount: number;
  date: string;
  account_id: string;
  transfer_account_id: string | null;
  category_id: string | null;
  recurring_id: string | null;
  note: string | null;
  created_at: string;
}

export interface Budget {
  id: string;
  category_id: string;
  amount: number;
}

export interface Recurring {
  id: string;
  name: string;
  type: "expense" | "income";
  amount: number;
  account_id: string;
  category_id: string | null;
  frequency: Frequency;
  anchor_day: number | null;
  next_date: string;
  is_subscription: boolean;
  auto_post: boolean;
  active: boolean;
}

export const ACCOUNT_TYPES: Record<AccountType, string> = {
  cash: "Efectivo",
  bank: "Cuenta bancaria",
  card: "Tarjeta de crédito",
  wallet: "Billetera virtual",
  savings: "Ahorro / Inversión",
};

export const FREQUENCIES: Record<Frequency, string> = {
  weekly: "Semanal",
  monthly: "Mensual",
  yearly: "Anual",
};
