import { z } from 'zod'

// ─── Common ──────────────────────────────────────────────────────────────────

const phoneSchema = z.string()
  .min(7, 'Номер слишком короткий')
  .max(20, 'Номер слишком длинный')
  .regex(/^[\d+\-\s()]+$/, 'Невалидный формат номера')

const uuidSchema = z.string().uuid('Невалидный UUID')

// ─── Auth ────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  token: z.string().min(1, 'Токен обязателен').max(256),
})

// ─── Sessions (WhatsApp) ────────────────────────────────────────────────────

export const createSessionSchema = z.object({
  phone: phoneSchema,
  proxy: z.string().max(256).optional(),
})

export const sendMessageSchema = z.object({
  to: phoneSchema,
  text: z.string().min(1, 'Текст сообщения обязателен').max(4096),
})

// ─── Campaigns ──────────────────────────────────────────────────────────────

export const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  template_text: z.string().min(1).max(4096),
  session_id: uuidSchema.optional().nullable(),
  delay_min_sec: z.number().int().min(10).max(3600).default(240),
  delay_max_sec: z.number().int().min(30).max(7200).default(540),
  ai_criteria: z.string().max(1000).optional(),
})

export const updateCampaignSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  template_text: z.string().min(1).max(4096).optional(),
  session_id: uuidSchema.optional().nullable(),
  delay_min_sec: z.number().int().min(10).max(3600).optional(),
  delay_max_sec: z.number().int().min(30).max(7200).optional(),
  status: z.enum(['running', 'paused', 'stopped']).optional(),
  ai_criteria: z.string().max(1000).optional(),
})

// ─── Leads ──────────────────────────────────────────────────────────────────

export const importLeadsSchema = z.object({
  campaign_id: uuidSchema,
})

export const addLeadsSchema = z.object({
  campaign_id: uuidSchema,
  phones: z.array(phoneSchema).min(1).max(10000),
})

// ─── Telegram Account ───────────────────────────────────────────────────────

export const createTgAccountSchema = z.object({
  phone: phoneSchema,
})

export const verifyCodeSchema = z.object({
  code: z.string().min(3).max(10).regex(/^\d+$/, 'Код должен содержать только цифры'),
})

export const verifyPasswordSchema = z.object({
  password: z.string().min(1).max(256),
})

// ─── Telegram Account Settings ──────────────────────────────────────────────

const invitingSettingsSchema = z.object({
  enabled: z.boolean(),
  daily_limit: z.number().int().min(1).max(200).default(40),
  delay_min: z.number().int().min(5).max(600).default(30),
  delay_max: z.number().int().min(10).max(1200).default(90),
  channels: z.array(z.string().max(256)).max(50).default([]),
})

const storyLikingSettingsSchema = z.object({
  enabled: z.boolean(),
  interval_min: z.number().int().min(60).max(7200).default(300),
  interval_max: z.number().int().min(120).max(14400).default(900),
  like_probability: z.number().min(0).max(1).default(0.7),
})

const neuroCommentingSettingsSchema = z.object({
  enabled: z.boolean(),
  ai_model: z.enum(['grok', 'claude', 'gpt']).default('grok'),
  comment_interval_min: z.number().int().min(120).max(7200).default(600),
  comment_interval_max: z.number().int().min(300).max(14400).default(1800),
  max_daily: z.number().int().min(1).max(100).default(20),
})

const massDmSettingsSchema = z.object({
  enabled: z.boolean(),
  daily_limit: z.number().int().min(1).max(200).default(30),
  delay_min: z.number().int().min(10).max(600).default(60),
  delay_max: z.number().int().min(30).max(1200).default(180),
  template: z.string().max(4096).default(''),
})

export const accountSettingsSchema = z.object({
  inviting: invitingSettingsSchema.optional(),
  story_liking: storyLikingSettingsSchema.optional(),
  neuro_commenting: neuroCommentingSettingsSchema.optional(),
  mass_dm: massDmSettingsSchema.optional(),
})

export const updateAccountSettingsSchema = z.object({
  settings: accountSettingsSchema,
})

export const updateProxySchema = z.object({
  proxy_string: z.string().max(256).nullable(),
})

// ─── Telegram Campaign ──────────────────────────────────────────────────────

export const createTgCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  template_text: z.string().min(1).max(4096),
  account_id: uuidSchema.optional().nullable(),
  delay_min_sec: z.number().int().min(1).max(600).default(3),
  delay_max_sec: z.number().int().min(2).max(1200).default(8),
})

// ─── Source Groups ──────────────────────────────────────────────────────────

export const addSourceGroupsSchema = z.object({
  links: z.array(z.string().url().or(z.string().regex(/t\.me\//))).min(1).max(100),
})

// ─── CRM ────────────────────────────────────────────────────────────────────

export const crmSendSchema = z.object({
  text: z.string().min(1).max(4096),
  session_phone: phoneSchema.optional(),
})

// ─── Scrape / Invite ────────────────────────────────────────────────────────

export const scrapeGroupSchema = z.object({
  group_id: uuidSchema,
  account_id: uuidSchema,
})

export const startInviteSchema = z.object({
  account_id: uuidSchema,
  target_channel: z.string().min(1).max(256),
  daily_limit: z.number().int().min(1).max(200).default(40),
})

export const multiInviteSchema = z.object({
  channels: z.array(z.string().min(1).max(256)).min(1).max(50),
  daily_limit_per_account: z.number().int().min(1).max(200).default(40),
  delay_between_invites_sec: z.number().int().min(5).max(600).default(45),
})

// ─── Validation helper ──────────────────────────────────────────────────────

/**
 * Validate request body against a Zod schema.
 * Returns { success: true, data } or throws with formatted error.
 */
export function validate(schema, data) {
  const result = schema.safeParse(data)
  if (!result.success) {
    const messages = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    const err = new Error(messages.join('; '))
    err.statusCode = 400
    err.validationErrors = result.error.issues
    throw err
  }
  return result.data
}

/**
 * Fastify preValidation hook factory.
 * Usage: fastify.post('/route', { preValidation: zodBody(schema) }, handler)
 */
export function zodBody(schema) {
  return async (request, reply) => {
    try {
      request.body = validate(schema, request.body)
    } catch (err) {
      reply.code(400).send({ error: err.message, validationErrors: err.validationErrors })
    }
  }
}
