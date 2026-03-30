import crypto from 'crypto'
import { supabase } from '../db.js'
import { requireRole, getUserTeam } from '../auth-helpers.js'

export default async function teamRoutes(fastify) {

  // ── GET /api/teams/current — get user's team + members + assignments ───────
  fastify.get('/api/teams/current', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Не авторизован' })

    const membership = await getUserTeam(req.user.id)
    if (!membership) {
      return reply.send({ team: null, members: [], assignments: [] })
    }

    const { data: team, error: tErr } = await supabase
      .from('wa_teams')
      .select('id, name, distribution_mode')
      .eq('id', membership.team_id)
      .single()
    if (tErr) throw tErr

    const { data: members, error: mErr } = await supabase
      .from('wa_team_members')
      .select('user_id, role, status, wa_users(email, display_name)')
      .eq('team_id', membership.team_id)
    if (mErr) throw mErr

    const { data: assignments, error: aErr } = await supabase
      .from('wa_resource_assignments')
      .select('user_id, resource_type, resource_id')
      .in('user_id', members.map(m => m.user_id))
    if (aErr) throw aErr

    return reply.send({
      team,
      members: (members || []).map(m => ({
        id: m.user_id,
        email: m.wa_users?.email ?? null,
        display_name: m.wa_users?.display_name ?? null,
        role: m.role,
        status: m.status,
      })),
      assignments: assignments || [],
    })
  })

  // ── POST /api/teams — create team ─────────────────────────────────────────
  fastify.post('/api/teams', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Не авторизован' })

    // Check user isn't already in a team
    const existing = await getUserTeam(req.user.id)
    if (existing) {
      return reply.code(409).send({ error: 'Вы уже состоите в команде' })
    }

    const { data: team, error: tErr } = await supabase
      .from('wa_teams')
      .insert({ name: req.body.name })
      .select()
      .single()
    if (tErr) throw tErr

    // Auto-add creator as admin
    const { error: mErr } = await supabase
      .from('wa_team_members')
      .insert({ team_id: team.id, user_id: req.user.id, role: 'admin', status: 'online' })
    if (mErr) throw mErr

    return reply.code(201).send(team)
  })

  // ── POST /api/teams/invite — generate invite link ─────────────────────────
  fastify.post('/api/teams/invite', {
    schema: {
      body: {
        type: 'object',
        properties: {
          role:  { type: 'string', enum: ['manager', 'operator'] },
          email: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Не авторизован' })

    const membership = await getUserTeam(req.user.id)
    if (!membership) return reply.code(404).send({ error: 'Вы не состоите в команде' })
    if (membership.role !== 'admin' && membership.role !== 'manager') {
      return reply.code(403).send({ error: 'Недостаточно прав' })
    }

    const token = crypto.randomBytes(32).toString('hex')
    const role = req.body.role || 'operator'

    const { data, error } = await supabase
      .from('wa_team_invites')
      .insert({
        team_id: membership.team_id,
        token,
        role,
        email: req.body.email || null,
        invited_by: req.user.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single()
    if (error) throw error

    return reply.code(201).send({
      token: data.token,
      url: `/team/join/${data.token}`,
    })
  })

  // ── POST /api/teams/join — join team via invite token ─────────────────────
  fastify.post('/api/teams/join', {
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Не авторизован' })

    // Check user isn't already in a team
    const existing = await getUserTeam(req.user.id)
    if (existing) {
      return reply.code(409).send({ error: 'Вы уже состоите в команде' })
    }

    const { data: invite, error: iErr } = await supabase
      .from('wa_team_invites')
      .select('*')
      .eq('token', req.body.token)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    if (iErr) throw iErr
    if (!invite) {
      return reply.code(400).send({ error: 'Недействительное или просроченное приглашение' })
    }

    // If invite is email-locked, verify
    if (invite.email && invite.email !== req.user.email) {
      return reply.code(403).send({ error: 'Приглашение предназначено для другого email' })
    }

    // Create membership
    const { error: mErr } = await supabase
      .from('wa_team_members')
      .insert({ team_id: invite.team_id, user_id: req.user.id, role: invite.role, status: 'online' })
    if (mErr) throw mErr

    // Mark invite as used
    await supabase
      .from('wa_team_invites')
      .update({ used_at: new Date().toISOString(), used_by: req.user.id })
      .eq('id', invite.id)

    return reply.send({ ok: true, team_id: invite.team_id, role: invite.role })
  })

  // ── PUT /api/teams/members/:userId/role — change member role ──────────────
  fastify.put('/api/teams/members/:userId/role', {
    schema: {
      body: {
        type: 'object',
        required: ['role'],
        properties: {
          role: { type: 'string', enum: ['admin', 'manager', 'operator'] },
        },
      },
    },
  }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Не авторизован' })

    const membership = await getUserTeam(req.user.id)
    if (!membership || membership.role !== 'admin') {
      return reply.code(403).send({ error: 'Только admin может менять роли' })
    }

    const { error } = await supabase
      .from('wa_team_members')
      .update({ role: req.body.role })
      .eq('team_id', membership.team_id)
      .eq('user_id', req.params.userId)
    if (error) throw error

    return reply.send({ ok: true })
  })

  // ── DELETE /api/teams/members/:userId — remove member ─────────────────────
  fastify.delete('/api/teams/members/:userId', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Не авторизован' })

    const membership = await getUserTeam(req.user.id)
    if (!membership || membership.role !== 'admin') {
      return reply.code(403).send({ error: 'Только admin может удалять участников' })
    }

    // Cannot remove yourself
    if (req.params.userId === req.user.id) {
      return reply.code(400).send({ error: 'Нельзя удалить самого себя' })
    }

    const { error } = await supabase
      .from('wa_team_members')
      .delete()
      .eq('team_id', membership.team_id)
      .eq('user_id', req.params.userId)
    if (error) throw error

    // Also clean up resource assignments
    await supabase
      .from('wa_resource_assignments')
      .delete()
      .eq('user_id', req.params.userId)

    return reply.code(204).send()
  })

  // ── PUT /api/teams/status — update own operator status ────────────────────
  fastify.put('/api/teams/status', {
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['online', 'busy', 'offline'] },
        },
      },
    },
  }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Не авторизован' })

    const membership = await getUserTeam(req.user.id)
    if (!membership) return reply.code(404).send({ error: 'Вы не состоите в команде' })

    const { error } = await supabase
      .from('wa_team_members')
      .update({ status: req.body.status })
      .eq('team_id', membership.team_id)
      .eq('user_id', req.user.id)
    if (error) throw error

    return reply.send({ ok: true })
  })

  // ── POST /api/teams/assign — assign resource to user ──────────────────────
  fastify.post('/api/teams/assign', {
    schema: {
      body: {
        type: 'object',
        required: ['userId', 'resourceType', 'resourceId'],
        properties: {
          userId:       { type: 'string' },
          resourceType: { type: 'string' },
          resourceId:   { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Не авторизован' })

    const membership = await getUserTeam(req.user.id)
    if (!membership || (membership.role !== 'admin' && membership.role !== 'manager')) {
      return reply.code(403).send({ error: 'Недостаточно прав' })
    }

    const { userId, resourceType, resourceId } = req.body

    const { data, error } = await supabase
      .from('wa_resource_assignments')
      .upsert(
        { user_id: userId, resource_type: resourceType, resource_id: resourceId, team_id: membership.team_id },
        { onConflict: 'user_id,resource_type,resource_id' },
      )
      .select()
      .single()
    if (error) throw error

    return reply.code(201).send(data)
  })

  // ── DELETE /api/teams/assign — unassign resource ──────────────────────────
  fastify.delete('/api/teams/assign', {
    schema: {
      body: {
        type: 'object',
        required: ['userId', 'resourceType', 'resourceId'],
        properties: {
          userId:       { type: 'string' },
          resourceType: { type: 'string' },
          resourceId:   { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Не авторизован' })

    const membership = await getUserTeam(req.user.id)
    if (!membership || (membership.role !== 'admin' && membership.role !== 'manager')) {
      return reply.code(403).send({ error: 'Недостаточно прав' })
    }

    const { userId, resourceType, resourceId } = req.body

    const { error } = await supabase
      .from('wa_resource_assignments')
      .delete()
      .eq('user_id', userId)
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
    if (error) throw error

    return reply.code(204).send()
  })

  // ── POST /api/teams/transfer — transfer dialog to another operator ────────
  fastify.post('/api/teams/transfer', {
    schema: {
      body: {
        type: 'object',
        required: ['toUserId', 'contactPhone', 'channel'],
        properties: {
          toUserId:     { type: 'string' },
          contactPhone: { type: 'string' },
          channel:      { type: 'string' },
          note:         { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Не авторизован' })

    const membership = await getUserTeam(req.user.id)
    if (!membership) return reply.code(404).send({ error: 'Вы не состоите в команде' })

    const { toUserId, contactPhone, channel, note } = req.body

    const { data, error } = await supabase
      .from('wa_dialog_transfers')
      .insert({
        team_id: membership.team_id,
        from_user_id: req.user.id,
        to_user_id: toUserId,
        contact_phone: contactPhone,
        channel,
        note: note || null,
        status: 'pending',
      })
      .select()
      .single()
    if (error) throw error

    return reply.code(201).send(data)
  })

  // ── GET /api/teams/transfers — get pending transfers for current user ─────
  fastify.get('/api/teams/transfers', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Не авторизован' })

    const { data, error } = await supabase
      .from('wa_dialog_transfers')
      .select('*, from:wa_users!wa_dialog_transfers_from_user_id_fkey(email, display_name)')
      .eq('to_user_id', req.user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    if (error) throw error

    return reply.send(data || [])
  })

  // ── PUT /api/teams/transfers/:id — accept or decline transfer ─────────────
  fastify.put('/api/teams/transfers/:id', {
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['accepted', 'declined'] },
        },
      },
    },
  }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Не авторизован' })

    const { data: transfer, error: tErr } = await supabase
      .from('wa_dialog_transfers')
      .select('*')
      .eq('id', req.params.id)
      .eq('to_user_id', req.user.id)
      .eq('status', 'pending')
      .maybeSingle()
    if (tErr) throw tErr
    if (!transfer) {
      return reply.code(404).send({ error: 'Трансфер не найден' })
    }

    const { error } = await supabase
      .from('wa_dialog_transfers')
      .update({ status: req.body.status, resolved_at: new Date().toISOString() })
      .eq('id', transfer.id)
    if (error) throw error

    // If accepted, reassign the resource
    if (req.body.status === 'accepted') {
      // Remove from sender
      await supabase
        .from('wa_resource_assignments')
        .delete()
        .eq('user_id', transfer.from_user_id)
        .eq('resource_type', 'dialog')
        .eq('resource_id', transfer.contact_phone)

      // Assign to receiver
      await supabase
        .from('wa_resource_assignments')
        .upsert(
          {
            user_id: req.user.id,
            resource_type: 'dialog',
            resource_id: transfer.contact_phone,
            team_id: transfer.team_id,
          },
          { onConflict: 'user_id,resource_type,resource_id' },
        )
    }

    return reply.send({ ok: true, status: req.body.status })
  })

  // ── POST /api/teams/notes — create internal note ──────────────────────────
  fastify.post('/api/teams/notes', {
    schema: {
      body: {
        type: 'object',
        required: ['contactPhone', 'channel', 'note'],
        properties: {
          contactPhone: { type: 'string' },
          channel:      { type: 'string' },
          note:         { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Не авторизован' })

    const membership = await getUserTeam(req.user.id)
    if (!membership) return reply.code(404).send({ error: 'Вы не состоите в команде' })

    const { contactPhone, channel, note } = req.body

    const { data, error } = await supabase
      .from('wa_internal_notes')
      .insert({
        team_id: membership.team_id,
        user_id: req.user.id,
        contact_phone: contactPhone,
        channel,
        note,
      })
      .select()
      .single()
    if (error) throw error

    return reply.code(201).send(data)
  })

  // ── GET /api/teams/notes/:contactPhone — get notes for a contact ──────────
  fastify.get('/api/teams/notes/:contactPhone', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Не авторизован' })

    const membership = await getUserTeam(req.user.id)
    if (!membership) return reply.code(404).send({ error: 'Вы не состоите в команде' })

    let query = supabase
      .from('wa_internal_notes')
      .select('*, author:wa_users!wa_internal_notes_user_id_fkey(email, display_name)')
      .eq('team_id', membership.team_id)
      .eq('contact_phone', req.params.contactPhone)
      .order('created_at', { ascending: false })

    if (req.query.channel) {
      query = query.eq('channel', req.query.channel)
    }

    const { data, error } = await query
    if (error) throw error

    return reply.send(data || [])
  })
}
