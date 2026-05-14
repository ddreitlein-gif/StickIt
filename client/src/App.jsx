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
import AuditLog from './pages/AuditLog'
import Home from './pages/Home'
import LiveScores from './pages/LiveScores'
import Admin from './pages/Admin'
import HelpPage from './pages/HelpPage'
import TrainingDays from './pages/TrainingDays'
import UsssDatabase from './pages/UsssDatabase'
import Login from './pages/Login'
import { AuthProvider } from './auth/AuthContext'
import RequireAuth from './auth/RequireAuth'
import './index.css'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/livescores" element={<LiveScores />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/help/:topicSlug" element={<HelpPage />} />
          <Route path="/admin/*" element={<RequireAuth role="event_admin"><Admin /></RequireAuth>} />
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
