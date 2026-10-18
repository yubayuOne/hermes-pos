import { supabase } from '../supabase/client';

export async function startSplitFromHeld(transactionId: string) {
  const { data, error } = await supabase.rpc('start_split_from_held', { p_transaction_id: transactionId });
  if (error) throw error;
  return data;
}
