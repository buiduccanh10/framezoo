import { createClient } from '@supabase/supabase-js';

let supabaseClient: ReturnType<typeof createClient> | null = null;

export const useSupabase = () => {
  if (supabaseClient) {
    return supabaseClient;
  }

  const config = useRuntimeConfig();
  const url = config.supabaseUrl;
  const key = config.supabaseServiceRoleKey;

  if (!url || !key) {
    return null;
  }

  supabaseClient = createClient(url, key, {
    auth: {
      persistSession: false,
    },
  });

  return supabaseClient;
};
