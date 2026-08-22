import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import MeetDetail from './pages/MeetDetail'
import EventDetail from './pages/EventDetail'
import Athletes from './pages/Athletes'
import JudgeTablet from './pages/JudgeTablet'
import TimekeeperTablet from './pages/TimekeeperTablet'
import Scoreboard from './pages/Scoreboard'
import HeadJudgeTablet from './pages/HeadJudgeTablet'
import Overlay from './pages/Overlay'
import AerialsJudgeTablet from './pages/AerialsJudgeTablet'
import Home from './pages/Home'
import LiveScores from './pages/LiveScores'
import Admin from './pages/Admin'
import HelpPage from './pages/HelpPage'
import TrainingDays from './pages/TrainingDays'
import UsssDatabase from './pages/UsssDatabase'
import Login from './pages/Login'
import { AuthProvider } from './auth/AuthContext'
import RequireAuth from './auth/RequireAuth'
import { useState, useEffect } from 'react'
import VenueHome from './pages/venue/VenueHome'
import VenueRole from './pages/venue/VenueRole'
import VenueOverlay from './pages/venue/VenueOverlay'
import VenueConnectionInfo from './pages/venue/VenueConnectionInfo'
import { fetchVenueStatus } from './pages/venue/venueShared'
import './index.css'

// v2.0.00 (Step 3, FR-13) — explicit venue-mode detection. The client asks
// /api/venue/status once; in venue mode the root route becomes the venue home
// screen and the venue role/overlay routes activate. Cloud mode renders
// exactly the v1 route tree.
function useVenueMode() {
  const [mode, setMode] = useState(null)
  useEffect(() => { fetchVenueStatus().then(s => setMode(s.mode === 'venue')) }, [])
  return mode // null while loading
}

export default function App() {
  const venue = useVenueMode()
  if (venue === null) return null // one-poll gate before first paint
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={venue ? <VenueHome /> : <Home />} />
          {venue && <Route path="/venue/role/:role" element={<VenueRole />} />}
          {venue && <Route path="/venue/connection" element={<VenueConnectionInfo />} />}
          {venue && <Route path="/overlay" element={<VenueOverlay />} />}
          <Route path="/login" element={<Login />} />
          <Route path="/livescores" element={<LiveScores />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/help/:topicSlug" element={<HelpPage />} />
          {/* v1.25.00 (A-3) — admin requires system_admin (event_admin is a legacy alias of equal rank) */}
          <Route path="/admin/*" element={<RequireAuth role="system_admin"><Admin /></RequireAuth>} />
          <Route path="/judge/:eventId" element={<JudgeTablet />} />
          <Route path="/aerials-judge/:eventId" element={<AerialsJudgeTablet />} />
          <Route path="/aerials-judge/:eventId/:judgeId" element={<AerialsJudgeTablet />} />
          <Route path="/timekeeper/:eventId" element={<TimekeeperTablet />} />
          <Route path="/scoreboard/:eventId" element={<Scoreboard />} />
          <Route path="/headjudge/:meetId/:eventId" element={<HeadJudgeTablet />} />
          <Route path="/overlay/:eventId" element={<Overlay />} />
          <Route path="/dashboard" element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<Dashboard />} />
            <Route path="meets/:meetId" element={<MeetDetail />} />
            <Route path="meets/:meetId/training" element={<TrainingDays />} />
            <Route path="meets/:meetId/events/:eventId" element={<EventDetail />} />
            <Route path="athletes" element={<Athletes />} />
            <Route path="usss" element={<UsssDatabase />} />
            <Route path="audit" element={<Navigate to="/admin/audit" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
