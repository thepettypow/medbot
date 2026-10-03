import { config } from "@/lib/config";
import { query } from "@/lib/db";

export interface FlowState { flow: string; step: string; data: Record<string, any> }

/** Multi-step flow state lives in Postgres (serverless has no memory). Expires after flowTtlMin. */
export async function getState(chatId: number): Promise<FlowState | null> {
  const r = await query<FlowState>(
    `SELECT flow, step, data FROM admin_state WHERE chat_id=$1 AND updated_at > now() - make_interval(mins => $2)`,
    [chatId, config.flowTtlMin]);
  return r[0] ?? null;
}
export const setState = (chatId: number, flow: string, step: string, data: Record<string, any>) =>
  query(
    `INSERT INTO admin_state (chat_id, flow, step, data, updated_at) VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (chat_id) DO UPDATE SET flow=$2, step=$3, data=$4, updated_at=now()`,
    [chatId, flow, step, JSON.stringify(data)]);
export const clearState = (chatId: number) => query(`DELETE FROM admin_state WHERE chat_id=$1`, [chatId]);
