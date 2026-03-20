import crypto from 'crypto'
import 'dotenv/config'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32

/**
 * Get or derive the encryption key from env.
 * Uses ENCRYPTION_KEY env var (64 hex chars = 32 bytes).
 * Falls back to deriving from ADMIN_SECRET with PBKDF2.
 */
function getEncryptionKey() {
  const envKey = process.env.ENCRYPTION_KEY
  if (envKey && envKey.length === 64) {
    return Buffer.from(envKey, 'hex')
  }
  // Derive from ADMIN_SECRET using PBKDF2
  const secret = process.env.ADMIN_SECRET || 'wadealer_default_key_change_me'
  return crypto.pbkdf2Sync(secret, 'wadealer_salt_v1', 100000, KEY_LENGTH, 'sha256')
}

const _key = getEncryptionKey()

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns { encrypted, iv, authTag } — all base64 encoded.
 */
export function encrypt(plaintext) {
  if (!plaintext) return { encrypted: '', iv: '', authTag: '' }

  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, _key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')
  const authTag = cipher.getAuthTag()

  return {
    encrypted,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  }
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * @param {string} encryptedData — base64 encoded ciphertext
 * @param {string} ivBase64 — base64 encoded IV
 * @param {string} authTagBase64 — base64 encoded auth tag
 * @returns {string} decrypted plaintext
 */
export function decrypt(encryptedData, ivBase64, authTagBase64) {
  if (!encryptedData) return ''

  const iv = Buffer.from(ivBase64, 'base64')
  const authTag = Buffer.from(authTagBase64, 'base64')
  const decipher = crypto.createDecipheriv(ALGORITHM, _key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encryptedData, 'base64', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

/**
 * Encrypt and return a single compact string: iv:authTag:data (all base64).
 * More convenient for storing in a single DB column.
 */
export function encryptCompact(plaintext) {
  if (!plaintext) return ''
  const { encrypted, iv, authTag } = encrypt(plaintext)
  return `${iv}:${authTag}:${encrypted}`
}

/**
 * Decrypt a compact string (iv:authTag:data).
 */
export function decryptCompact(compactStr) {
  if (!compactStr || !compactStr.includes(':')) return compactStr // not encrypted, return as-is
  const parts = compactStr.split(':')
  if (parts.length !== 3) return compactStr // not in expected format
  const [iv, authTag, data] = parts
  try {
    return decrypt(data, iv, authTag)
  } catch {
    // If decryption fails, it might be plaintext (migration period)
    return compactStr
  }
}

/**
 * Generate a cryptographically secure random token.
 */
export function generateSecureToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex')
}

/**
 * Hash a password/token with SHA-256 for comparison.
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}
