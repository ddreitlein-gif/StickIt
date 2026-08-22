import { Routes, Route, Navigate } from 'react-router-dom'
import AdminLayout from '../components/AdminLayout'
import AdminDashboard from './admin/AdminDashboard'
import AdminUsers from './admin/AdminUsers'
import AdminEvents from './admin/AdminEvents'
import AdminSystem from './admin/AdminSystem'
import AdminUSSSPeople from './admin/AdminUSSSPeople'
import AdminAthletes from './admin/AdminAthletes'
import AdminBackups from './admin/AdminBackups'
import AdminSecurity from './admin/AdminSecurity'
import AdminAdoption from './admin/AdminAdoption'
import AuditLog from './AuditLog'

export default function Admin() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="security" element={<AdminSecurity />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="events" element={<AdminEvents />} />
        <Route path="usss-people" element={<AdminUSSSPeople />} />
        <Route path="athletes" element={<AdminAthletes />} />
        <Route path="backups" element={<AdminBackups />} />
        <Route path="adoption" element={<AdminAdoption />} />
        <Route path="audit" element={<AuditLog />} />
        <Route path="system" element={<Navigate to="/admin/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
