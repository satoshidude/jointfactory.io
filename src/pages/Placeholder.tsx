import { Construction } from 'lucide-react'

export default function Placeholder({ name }: { name: string }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 48 }}>
      <Construction size={40} style={{ color: 'var(--text-secondary)', marginBottom: 12 }} />
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>{name}</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
        This section is under construction.
      </p>
    </div>
  )
}
