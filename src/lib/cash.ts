import { z } from 'zod';
import { formatPEN } from './finance';

const amount = z.string().regex(/^\d+$/);
export const cashSummarySchema = z.object({
 configured: z.boolean(),
 opening_cents: amount,
 contributions_cents: amount,
 withdrawals_cents: amount,
 received_cents: amount,
 disbursed_cents: amount,
 interest_cents: amount,
 month_interest_cents: amount,
 balance_cents: z.string().regex(/^-?\d+$/).nullable(),
 as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine(value => value.configured === (value.balance_cents !== null), 'Saldo sin configurar');
export type CashSummary = z.infer<typeof cashSummarySchema>;
export type CashMovement = {
 id: string; kind: 'apertura' | 'aporte' | 'retiro'; amount_cents: number | string; note: string; created_at: string;
};
export const cashKindLabel = { apertura: 'Dinero inicial', aporte: 'Aporte', retiro: 'Retiro' };

export function cashMoney(value: string): string {
 const amount = BigInt(value);
 return amount < 0n ? `−${formatPEN(-amount)}` : formatPEN(amount);
}
