import { supabase } from './db.js'

// ─── requireRole ──────────────────────────────────────────────────────────────
// Checks that req.user has one of the allowed roles. Admin always passes.
// Throws 403 if not authorized.
export function requireRole(req, ...allowedRoles) {
  if (!req.user) {
    const err = new Error('Не авторизован')
    err.statusCode = 401
    throw err
  }
  if (req.user.is_admin) return
  if (allowedRoles.includes(req.user.role)) return

  const err = new Error('Недостаточно прав')
  err.statusCode = 403
  throw err
}

// ─── getUserTeam ──────────────────────────────────────────────────────────────
// Returns the user's team membership info or null.
export async function getUserTeam(userId) {
  const { data, error } = await supabase
    .from('wa_team_members')
    .select('team_id, role, wa_teams(name)')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    team_id: data.team_id,
    role: data.role,
    team_name: data.wa_teams?.name ?? null,
  }
}

// ─── canAccessResource ────────────────────────────────────────────────────────
// Admin/manager can access everything. Operator must have explicit assignment.
export async function canAccessResource(userId, teamRole, resourceType, resourceId) {
  if (teamRole === 'admin' || teamRole === 'manager') return true

  const { data, error } = await supabase
    .from('wa_resource_assignments')
    .select('id')
    .eq('user_id', userId)
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId)
    .maybeSingle()

  if (error) throw error
  return !!data
}

// ─── getAssignedResourceIds ───────────────────────────────────────────────────
// Returns array of resource_id strings for a user + resource type.
export async function getAssignedResourceIds(userId, resourceType) {
  const { data, error } = await supabase
    .from('wa_resource_assignments')
    .select('resource_id')
    .eq('user_id', userId)
    .eq('resource_type', resourceType)

  if (error) throw error
  return (data || []).map(r => r.resource_id)
}

// ─── getTeamResourceIds ───────────────────────────────────────────────────────
// Returns all resource IDs assigned to any member of the team.
export async function getTeamResourceIds(teamId, resourceType) {
  // Get all user IDs in the team
  const { data: members, error: mErr } = await supabase
    .from('wa_team_members')
    .select('user_id')
    .eq('team_id', teamId)

  if (mErr) throw mErr
  if (!members || members.length === 0) return []

  const userIds = members.map(m => m.user_id)

  const { data, error } = await supabase
    .from('wa_resource_assignments')
    .select('resource_id')
    .in('user_id', userIds)
    .eq('resource_type', resourceType)

  if (error) throw error
  return (data || []).map(r => r.resource_id)
}
