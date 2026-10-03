import { query } from "@/lib/db";

export interface Person {
  id: string; display_name: string; telegram_chat_id: number | null; timezone: string;
  status: string; resume_status: string | null; created_by_admin_chat_id: number;
}
export interface Med {
  id: number; person_id: string; name: string; dose: string; note: string | null;
  days_of_week: number[]; start_date: string; end_date: string | null; is_active: boolean; times: string[];
}

export const getPerson = async (id: string): Promise<Person | null> =>
  (await query<Person>(`SELECT * FROM people WHERE id=$1`, [id]))[0] ?? null;

export const getPersonByChat = async (chatId: number): Promise<Person | null> =>
  (await query<Person>(`SELECT * FROM people WHERE telegram_chat_id=$1`, [chatId]))[0] ?? null;

const MED_SELECT = `
  SELECT m.id, m.person_id, m.name, m.dose, m.note, m.days_of_week, m.start_date, m.end_date, m.is_active,
         COALESCE(array_agg(to_char(mt.local_time,'HH24:MI') ORDER BY mt.local_time)
                  FILTER (WHERE mt.id IS NOT NULL AND mt.removed_at IS NULL), '{}') AS times
  FROM medications m LEFT JOIN medication_times mt ON mt.medication_id = m.id`;

const fix = (m: any): Med => ({ ...m, days_of_week: m.days_of_week.map(Number) });

export const getMeds = async (personId: string): Promise<Med[]> =>
  (await query(`${MED_SELECT} WHERE m.person_id=$1 GROUP BY m.id ORDER BY m.id`, [personId])).map(fix);

export const getMed = async (medId: number): Promise<Med | null> => {
  const r = await query(`${MED_SELECT} WHERE m.id=$1 GROUP BY m.id`, [medId]);
  return r[0] ? fix(r[0]) : null;
};

/** Replace a medication's times without destroying dose history (soft-remove + revive). */
export async function setMedTimes(medId: number, times: string[], q: import("@/lib/db").Q) {
  await q.query(`UPDATE medication_times SET removed_at=now() WHERE medication_id=$1 AND removed_at IS NULL AND NOT (to_char(local_time,'HH24:MI') = ANY($2))`, [medId, times]);
  for (const t of times) {
    await q.query(
      `INSERT INTO medication_times (medication_id, local_time) VALUES ($1,$2)
       ON CONFLICT (medication_id, local_time)
       DO UPDATE SET removed_at=NULL, created_at=now() WHERE medication_times.removed_at IS NOT NULL`,
      [medId, t],
    );
  }
}
