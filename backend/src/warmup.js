/**
 * WA Warmup — accounts message each other every ~30 min to build trust.
 *
 * Each cycle:
 *  1. Pick a random pair from online sessions
 *  2. Account A sends a casual message to Account B
 *  3. After 1-3 min delay, Account B replies
 *  4. Next cycle in ~30 min (with jitter ±5 min)
 */

// Casual conversation pairs — message → possible replies
const CONVERSATIONS = [
  { msg: 'Привет, как дела?', replies: ['Привет! Всё хорошо, ты как?', 'Норм, работаю. А ты?', 'Здарова! Всё ок 👍'] },
  { msg: 'Что делаешь?', replies: ['Сижу дома, отдыхаю', 'Работаю, скоро закончу', 'Да ничего особенного'] },
  { msg: 'Как настроение?', replies: ['Отличное! 😊', 'Нормальное, спасибо', 'Бывало и лучше, но ок'] },
  { msg: 'Видел новости?', replies: ['Нет, а что случилось?', 'Да, жесть какая-то', 'Не смотрю новости уже'] },
  { msg: 'Завтра планы есть?', replies: ['Пока нет, а что?', 'Да, занят буду', 'Вроде свободен'] },
  { msg: 'Когда увидимся?', replies: ['Давай на неделе созвонимся', 'Скоро, надеюсь!', 'Может в выходные?'] },
  { msg: 'Скинь номер того чувака', replies: ['Щас поищу', 'Какого именно?', 'Сейчас гляну в контактах'] },
  { msg: 'Ты где сейчас?', replies: ['Дома', 'На работе', 'В городе гуляю'] },
  { msg: 'Есть минутка?', replies: ['Да, говори', 'Через 5 минут напишу', 'Слушаю'] },
  { msg: 'Спасибо за вчера 👍', replies: ['Не за что!', 'Обращайся 😊', 'Всегда пожалуйста'] },
  { msg: 'Добрый день!', replies: ['Добрый! Как ты?', 'Здравствуй!', 'Привет! Всё хорошо?'] },
  { msg: 'Как работа?', replies: ['Нормально, справляюсь', 'Много дел, но ок', 'Лучше не спрашивай 😅'] },
  { msg: 'Погода сегодня 🔥', replies: ['Да, жарко!', 'Не то слово', 'Я дома сижу с кондером'] },
  { msg: 'Ну что, готов?', replies: ['Почти, 10 минут ещё', 'Готов, жду тебя', 'К чему готов? 😂'] },
  { msg: 'Кофе хочешь?', replies: ['Давай!', 'Уже пью свой', 'Нет, спасибо, чай лучше'] },
  { msg: 'Нормально доехал?', replies: ['Да, всё ок', 'Пробки были, но добрался', 'Только приехал'] },
  { msg: 'Вечером свободен?', replies: ['Да, а что предлагаешь?', 'Нет, занят буду', 'Смотря во сколько'] },
  { msg: 'Посмотри когда время будет', replies: ['Ок, гляну позже', 'Сейчас посмотрю', 'Напомни через час'] },
  { msg: 'Всё в силе?', replies: ['Да, конечно', 'Подтверждаю 👍', 'А что именно?'] },
  { msg: 'Удачного дня!', replies: ['Спасибо, тебе тоже!', 'И тебе! 🙌', 'Благодарю!'] },
  // Hebrew
  { msg: 'מה נשמע?', replies: ['הכל טוב, מה איתך?', 'בסדר גמור 👍', 'יופי, תודה'] },
  { msg: 'מה קורה אחי?', replies: ['הכל סבבה', 'עובד, מה איתך?', 'חיים טובים'] },
  { msg: 'אתה פנוי היום?', replies: ['כן, למה?', 'תלוי מתי', 'בערב אני פנוי'] },
  { msg: 'תודה רבה!', replies: ['בכיף!', 'אין בעד מה', 'תמיד 😊'] },
  { msg: 'בוקר טוב', replies: ['בוקר אור!', 'בוקר טוב, מה נשמע?', 'היי, בוקר טוב'] },
  // English
  { msg: 'Hey, how are you?', replies: ['Good, thanks! You?', 'All good 👍', 'Doing well!'] },
  { msg: 'What are you up to?', replies: ['Just chilling', 'Working, hbu?', 'Nothing much'] },
  { msg: 'Are you free later?', replies: ['Yeah, what\'s up?', 'Depends on when', 'Should be, why?'] },
  { msg: 'Thanks for earlier!', replies: ['No problem!', 'Anytime 😊', 'You\'re welcome'] },
  { msg: 'Good morning', replies: ['Morning! How are you?', 'Hey, good morning!', 'Morning ☀️'] },
]

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomDelay(minMs, maxMs) {
  return minMs + Math.random() * (maxMs - minMs)
}

export class WarmupManager {
  constructor(orchestrator) {
    this.orchestrator = orchestrator
    this._timer = null
    this._active = false
    this._usedConversations = new Set() // avoid repeating same conv too often
  }

  start() {
    if (this._active) return
    this._active = true
    this._scheduleNext()
    this.orchestrator.log(null, '🔥 Warmup запущен — сообщения каждые ~30 мин', 'system')
  }

  stop() {
    this._active = false
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
    this.orchestrator.log(null, '⏹ Warmup остановлен', 'system')
  }

  get isActive() {
    return this._active
  }

  _scheduleNext() {
    if (!this._active) return
    // 30 min ± 5 min jitter (25-35 min)
    const interval = randomDelay(25 * 60_000, 35 * 60_000)
    this._timer = setTimeout(() => this._runCycle(), interval)
  }

  async _runCycle() {
    if (!this._active) return

    try {
      // Get online sessions
      const onlineSessions = []
      for (const [phone, session] of this.orchestrator.sessions) {
        if (session.status === 'online' && session.sock) {
          onlineSessions.push({ phone, session })
        }
      }

      if (onlineSessions.length < 2) {
        this.orchestrator.log(null, '⚠️ Warmup: меньше 2 онлайн WA сессий, пропускаем цикл', 'system')
        this._scheduleNext()
        return
      }

      // Pick random pair (sender ≠ receiver)
      const shuffled = [...onlineSessions].sort(() => Math.random() - 0.5)
      const sender = shuffled[0]
      const receiver = shuffled[1]

      // Pick conversation (avoid recent repeats)
      let conv
      let attempts = 0
      do {
        conv = pick(CONVERSATIONS)
        attempts++
      } while (this._usedConversations.has(conv.msg) && attempts < 10)

      this._usedConversations.add(conv.msg)
      if (this._usedConversations.size > CONVERSATIONS.length * 0.7) {
        this._usedConversations.clear() // reset when 70% used
      }

      const reply = pick(conv.replies)

      // Step 1: Sender sends message to receiver
      const receiverPhone = receiver.phone.replace(/^\+/, '')
      this.orchestrator.log(null, `🔥 Warmup: ${sender.phone} → ${receiver.phone}: "${conv.msg.substring(0, 30)}..."`, 'system')

      await sender.session.sendMessage(receiverPhone, conv.msg)

      // Step 2: Wait 1-3 minutes, then receiver replies
      const replyDelay = randomDelay(60_000, 180_000)
      setTimeout(async () => {
        try {
          const senderPhone = sender.phone.replace(/^\+/, '')
          this.orchestrator.log(null, `🔥 Warmup: ${receiver.phone} → ${sender.phone}: "${reply.substring(0, 30)}..."`, 'system')
          await receiver.session.sendMessage(senderPhone, reply)
        } catch (err) {
          this.orchestrator.log(null, `⚠️ Warmup reply error: ${err.message}`, 'warn')
        }
      }, replyDelay)

    } catch (err) {
      this.orchestrator.log(null, `⚠️ Warmup cycle error: ${err.message}`, 'warn')
    }

    this._scheduleNext()
  }
}
