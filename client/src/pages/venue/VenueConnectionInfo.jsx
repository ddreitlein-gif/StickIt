import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import api from '../../utils/api'

/**
 * v2.0.00 (Step 3, D3 / 6.2) — Connection Info: address + QR for onboarding
 * the next tablet, plus the COMPLETE numeric overlay URL for the YoloBox
 * (verified from the run sheet each event day at Starlink-router venues,
 * where the numeric IP can occasionally change).
 */
export default function VenueConnectionInfo() {
  const navigate = useNavigate()
  const [info, setInfo] = useState(null)
  const [qr, setQr] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.venueConnectionInfo().then(async (i) => {
      setInfo(i)
      try { setQr(await QRCode.toDataURL(i.numeric_url, { width: 360, margin: 1 })) } catch (_) {}
    }).catch(e => setErr(e.message))
  }, [])

  if (err) return <div className="min-h-screen bg-slate-950 text-red-400 p-8">{err}</div>
  if (!info) return <div className="min-h-screen bg-slate-950 text-slate-500 p-8">Loading…</div>

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 max-w-2xl mx-auto">
      <button onClick={() => navigate('/?menu=1')} className="text-slate-500 text-sm mb-4">← Back to menu</button>
      <h1 className="font-display text-4xl mb-6">Connection Info</h1>

      <div className="card mb-6 text-center">
        <h2 className="font-display text-xl text-slate-300 mb-3">New tablet? Scan this</h2>
        {qr && <img src={qr} alt="QR code" className="mx-auto rounded-xl bg-white p-2" style={{ width: 260, height: 260 }} />}
        <p className="font-mono text-2xl text-mountain-300 mt-4 select-all">{info.mdns_url}</p>
        <p className="text-slate-500 text-sm mt-1">Type this into Safari on the tablet, or scan the code above.</p>
      </div>

      <div className="card mb-6">
        <h2 className="font-display text-xl text-slate-300 mb-2">Livestream box (YoloBox) overlay URL</h2>
        <p className="font-mono text-2xl text-amber-300 select-all">{info.overlay_url}</p>
        <p className="text-slate-500 text-sm mt-2">
          Enter this once into the YoloBox browser source. Check it matches what's already stored —
          at Starlink-router venues the number can occasionally change.
        </p>
      </div>

      <div className="card">
        <h2 className="font-display text-xl text-slate-300 mb-2">All addresses</h2>
        <table className="w-full text-sm">
          <tbody>
            <tr><td className="text-slate-500 py-1 pr-4">Name (tablets)</td><td className="font-mono text-slate-300">{info.mdns_url}</td></tr>
            {info.addresses.map(a => (
              <tr key={a}><td className="text-slate-500 py-1 pr-4">Number</td><td className="font-mono text-slate-300">http://{a}:{info.port}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
