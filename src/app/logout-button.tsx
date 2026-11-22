'use client'

import { createClient } from '@/lib/supabase/client'

export default function LogoutButton() {
  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  return <button onClick={handleLogout}>Sair</button>
}
