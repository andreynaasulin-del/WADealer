import {
  dbGetAllProfiles,
  dbGetProfileBySlug,
  dbCreateProfile,
  dbUpdateProfile,
  dbDeleteProfile,
  dbExcludeLead,
  dbGetLeadById,
  dbGetConversationMessages,
} from '../db.js'

function generateSlug(name) {
  const base = (name || 'girl')
    .toLowerCase()
    .replace(/[^a-z0-9\u0590-\u05FF\u0400-\u04FF]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 20)
  const suffix = Math.random().toString(36).substring(2, 6)
  return `${base}-${suffix}`
}

/** Extract photo URLs from conversation messages */
function extractPhotosFromMessages(messages) {
  const photos = []
  for (const msg of messages || []) {
    const match = msg.body?.match(/\[media:image:(https?:\/\/[^\]]+)\]/)
    if (match) photos.push(match[1])
  }
  return photos
}

export default async function profileRoutes(fastify) {

  // ── Public: get profile by slug (no auth) ────────────────────────────────
  fastify.get('/api/public/profile/:slug', async (req, reply) => {
    const profile = await dbGetProfileBySlug(req.params.slug)
    if (!profile) return reply.code(404).send({ error: 'Profile not found' })
    return reply.send(profile)
  })

  // ── Admin: list all profiles ─────────────────────────────────────────────
  fastify.get('/api/profiles', async (_req, reply) => {
    const profiles = await dbGetAllProfiles()
    return reply.send(profiles)
  })

  // ── Admin: create profile manually ───────────────────────────────────────
  fastify.post('/api/profiles', async (req, reply) => {
    const { name, slug, ...rest } = req.body
    const profile = await dbCreateProfile({
      name: name || 'Unknown',
      slug: slug || generateSlug(name),
      ...rest,
    })
    return reply.code(201).send(profile)
  })

  // ── Admin: auto-create profile from HOT lead ─────────────────────────────
  fastify.post('/api/profiles/from-lead/:leadId', async (req, reply) => {
    const lead = await dbGetLeadById(req.params.leadId)
    if (!lead) return reply.code(404).send({ error: 'Lead not found' })

    let parsed = null
    try { parsed = JSON.parse(lead.ai_reason) } catch {}
    if (!parsed) return reply.code(400).send({ error: 'Lead has no extracted data' })

    // Extract photos from conversation
    const phone = lead.phone.replace(/\D/g, '')
    const messages = await dbGetConversationMessages(phone, 200)
    const photos = extractPhotosFromMessages(messages)

    const name = lead.nickname || parsed.city || 'Girl'
    const profile = await dbCreateProfile({
      slug: generateSlug(name),
      name,
      city: parsed.city || lead.city || null,
      address: parsed.address || null,
      age: parsed.age || null,
      nationality: parsed.nationality || null,
      price_text: parsed.price_text || null,
      price_min: parsed.price_min || null,
      price_max: parsed.price_max || null,
      incall_outcall: parsed.incall_outcall || null,
      independent_or_agency: parsed.independent_or_agency || null,
      services: parsed.services || [],
      availability: parsed.availability || null,
      photos,
      lead_id: lead.id,
    })

    return reply.code(201).send(profile)
  })

  // ── Admin: update profile ────────────────────────────────────────────────
  fastify.put('/api/profiles/:id', async (req, reply) => {
    const profile = await dbUpdateProfile(req.params.id, req.body)
    return reply.send(profile)
  })

  // ── Admin: delete profile ────────────────────────────────────────────────
  fastify.delete('/api/profiles/:id', async (req, reply) => {
    await dbDeleteProfile(req.params.id)
    return reply.send({ ok: true })
  })

  // ── Admin: toggle lead exclusion ─────────────────────────────────────────
  fastify.put('/api/leads/:id/exclude', async (req, reply) => {
    const { excluded } = req.body
    await dbExcludeLead(req.params.id, excluded !== false)
    return reply.send({ ok: true })
  })
}
