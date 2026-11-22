'use client'

import { createClient } from '@/lib/supabase/client'

export default function LoginButton() {
  const handleLogin = async () => {
    const supabase = createClient()

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      alert(`Erro ao entrar: ${error.message}`)
    }
  }

  return (
    <button onClick={handleLogin}>
      Entrar com Google
    </button>
  )
}
