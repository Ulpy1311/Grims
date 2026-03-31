const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ThumbnailBuilder,
    SectionBuilder
} = require('discord.js');

const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Logger = require('./Logger');

class GrimsAI {
    constructor() {
        this.config = {
            channel: process.env.CHANNEL_ID || '1488516213813415967',
            guild: process.env.GUILD_ID || '960813957675892747',
            prefix: process.env.PREFIX || 'g!',
            color: 0xA8E6CF,
            maxHistory: 50,
            maxContext: 15,
            knowledgeDir: path.join(__dirname, 'Chat AI', 'Knowledge'),
            promptFile: path.join(__dirname, 'Chat AI', 'JANGAN DI UBAH.md'),
            embedLimit: 4096,
            safeLimit: 2000,
            model: process.env.CHAT_AI_MODEL || 'openai/gpt-oss-120b',
            temperature: 1,
            topP: 1,
            maxTokens: 4096,
            betterModel: process.env.CHAT_AI_BETTER_MODEL || 'qwen/qwen3.5-397b-a17b'
        };

        this.promptCache = { data: null, lastLoad: 0, ttl: 30000 };
        this.processing = new Set();
        this.rateLimit = new Map();
        this.activePages = new Map();
        this.messageQueue = [];
        this.isProcessingQueue = false;
        this.queueProcessingInterval = null;
        this.client = null;

        this.init();
    }

    async init() {
        this.ensureDir(this.config.knowledgeDir);
        await this.loadPrompt();
        this.initializeOpenAI();
        this.startQueueProcessor();
    }

    initializeOpenAI() {
        const apiKey = process.env.NVIDIA_NIM_API_KEY || '';
        if (!apiKey) {
            Logger.error('[GrimsAI] NVIDIA_NIM_API_KEY not found in .env');
            return;
        }

        this.client = new OpenAI({
            apiKey: apiKey,
            baseURL: 'https://integrate.api.nvidia.com/v1'
        });
        Logger.success('[GrimsAI] OpenAI (NVIDIA NIM) initialized successfully');
    }

    startQueueProcessor() {
        this.queueProcessingInterval = setInterval(() => {
            this.processQueue();
        }, 1000);
    }

    ensureDir(dirPath) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    hashUserId(userId) {
        return crypto.createHash('sha256').update(userId).digest('hex').substring(0, 16);
    }

    async loadPrompt() {
        const now = Date.now();
        if (this.promptCache.data && (now - this.promptCache.lastLoad) < this.config.ttl) {
            return this.promptCache.data;
        }

        if (fs.existsSync(this.config.promptFile)) {
            try {
                let prompt = fs.readFileSync(this.config.promptFile, 'utf8');
                this.promptCache.data = prompt;
                this.promptCache.lastLoad = now;
            } catch (err) {
                this.promptCache.data = "Kamu adalah Grims, AI companion yang ramah dan perhatian.";
            }
        } else {
            this.promptCache.data = "Kamu adalah Grims, AI companion yang ramah dan perhatian.";
        }

        return this.promptCache.data;
    }

    getUserFile(userId) {
        return path.join(this.config.knowledgeDir, `${this.hashUserId(userId)}.json`);
    }

    getUserData(userId) {
        const file = this.getUserFile(userId);
        if (!fs.existsSync(file)) {
            return {
                history: [],
                profile: {
                    name: null,
                    preferences: [],
                    lastTopics: [],
                    mood: 'neutral',
                    language: 'id'
                },
                stats: {
                    totalMessages: 0,
                    firstSeen: Date.now(),
                    lastSeen: Date.now(),
                    totalTokens: 0
                },
                knowledge: []
            };
        }

        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (!data.knowledge) data.knowledge = [];
            if (!data.profile.language) data.profile.language = 'id';
            if (!data.stats.totalTokens) data.stats.totalTokens = 0;
            return data;
        } catch (err) {
            return {
                history: [],
                profile: {
                    name: null,
                    preferences: [],
                    lastTopics: [],
                    mood: 'neutral',
                    language: 'id'
                },
                stats: {
                    totalMessages: 0,
                    firstSeen: Date.now(),
                    lastSeen: Date.now(),
                    totalTokens: 0
                },
                knowledge: []
            };
        }
    }

    saveUserData(userId, data) {
        const file = this.getUserFile(userId);
        data.stats.lastSeen = Date.now();
        try {
            fs.writeFileSync(file, JSON.stringify(data, null, 2));
        } catch (err) {
            Logger.error('[GrimsAI] Save error: ' + err.message);
        }
    }

    buildContext(userId, displayName, username) {
        const userData = this.getUserData(userId);
        let context = this.promptCache.data || '';

        const recentTopics = userData.profile.lastTopics.slice(-5).join(', ');
        const prefs = userData.profile.preferences.slice(-10).join(', ');

        const contextInfo = `

---
# INFORMASI PENGGUNA SAAT INI
- **Nama:** ${displayName}
- **Username:** @${username}
- **User ID:** ${userId}
- **Total Percakapan:** ${userData.stats.totalMessages} pesan
${userData.profile.name ? `- **Panggilan Akrab:** ${userData.profile.name}` : ''}
${userData.profile.mood !== 'neutral' ? `- **Mood Saat Ini:** ${userData.profile.mood}` : ''}
${recentTopics ? `- **Topik Terakhir:** ${recentTopics}` : ''}
${prefs ? `- **Preferensi:** ${prefs}` : ''}

---
# CARA MENGINGAT INFORMASI
Kamu harus mengingat hal-hal penting dari percakapan dan menyimpannya ke dalam knowledge user.
- Jika user menyebutkan nama, hobi, kesukaan, atau info pribadi → simpan di profile user
- Jika user membahas topik tertentu secara mendalam → simpan sebagai knowledge
- Selalu gunakan informasi yang tersimpan untuk membuat percakapan lebih personal
- Refer ke percakapan sebelumnya jika relevan ("eh tadi kan kamu bilang...")

---
# ATURAN RESPONS DISCORD
**Panjang Respons:**
- Chat santai/casual → 1-3 kalimat
- Pertanyaan detail → 2-4 paragraf
- Curhat/deep talk → respons dengan empathy dan panjang yang sesuai
- Selalu mirror energy dari user

**Formatting:**
- **bold** untuk emphasis
- *italic* untuk nuance
- \`code\` untuk teknis/programming
- Emoji maksimal 1-3 per pesan
- Gunakan newlines untuk paragraf terpisah

**Gaya Bahasa:**
- Indonesia santai dan natural
- Hangat, gaul, gak kaku
- Langsung ke inti
`;

        return context + contextInfo;
    }

    detectMood(message) {
        const lowerMsg = message.toLowerCase();

        const moods = {
            happy: ['seneng', 'happy', 'gembira', 'bahagia', 'haha', 'wkwk', 'lol', 'lucu', 'keren', 'mantap', 'asik', 'seru', 'gas', 'yey', 'yes', 'hore', 'anjay', 'gokil', 'nice', 'cool', 'awesome', 'great'],
            sad: ['sedih', 'nangis', 'menangis', 'huhu', 'kecewa', 'duka', 'galau', 'hancur', 'patah', 'runtuh', 'sedihh', 'melankolis', 'lonely', 'sepi', 'sendirian'],
            angry: ['kesel', 'marah', 'benci', 'anjir', 'ges', 'yaelah', 'sebel', 'emo', 'fuming', 'kicep', 'annoyed', 'frustrated'],
            anxious: ['cemas', 'takut', 'khawatir', 'deg', 'grogi', 'overthinking', 'stress', 'panik', 'ragu', 'bimbang', 'nervous', 'worried', 'anxious'],
            bored: ['bosen', 'bosan', 'cape', 'capek', 'lelah', 'malem', 'meh', 'lazy', 'nganggur', 'tired', 'exhausted']
        };

        for (const [mood, words] of Object.entries(moods)) {
            if (words.some(w => lowerMsg.includes(w))) return mood;
        }

        return 'neutral';
    }

    detectLanguage(message) {
        const englishWords = ['the', 'is', 'are', 'was', 'were', 'what', 'how', 'why', 'when', 'where', 'who', 'which', 'can', 'could', 'would', 'should', 'hello', 'hi', 'hey', 'thanks', 'please', 'sorry'];
        const lowerMsg = message.toLowerCase();
        const words = lowerMsg.split(/\s+/);
        const englishCount = words.filter(w => englishWords.includes(w)).length;

        if (englishCount >= 2 || /^[a-zA-Z\s]+$/.test(message)) {
            return 'en';
        }
        return 'id';
    }

    extractInfo(message, userData) {
        const namePatterns = [
            /nama\s*(?:aku|gw|gue|saya|my name is|i'm|i am)\s*([a-zA-Z]+)/i,
            /aku\s*([a-zA-Z]+)\s*(?:sih|dong|adalah)?/i,
            /panggil\s*(?:aja|saja)?\s*(?:aku|gw|gue)?\s*([a-zA-Z]+)/i,
            /(?:call me|i'm|my name is)\s*([a-zA-Z]+)/i
        ];

        for (const pattern of namePatterns) {
            const match = message.match(pattern);
            if (match && match[1] && match[1].length > 1) {
                userData.profile.name = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
                break;
            }
        }

        const prefPatterns = [
            /(?:aku|gw|gue|saya|i)\s*(?:suka|love|like)\s+(.+)/i,
            /(?:favorit|favorite|favourite)\s+(?:aku|gw|gue|saya|my)?\s*(?:itu|adalah|is)?\s*(.+)/i,
            /(?:my favorite|favorite of mine)\s*(?:is)?\s*(.+)/i
        ];

        for (const pattern of prefPatterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                const pref = match[1].trim().toLowerCase();
                if (pref.length > 1 && pref.length < 50 && !userData.profile.preferences.includes(pref)) {
                    userData.profile.preferences.push(pref);
                    if (userData.profile.preferences.length > 30) {
                        userData.profile.preferences = userData.profile.preferences.slice(-30);
                    }
                }
            }
        }

        const topicPatterns = [
            /(?:kita|we)\s*(?:lagi|just|now)?\s*(?:bahas|ngobrolin|talking about|discussing)\s*(.+)/i,
            /(?:soal|about)\s*(.+)/i
        ];

        for (const pattern of topicPatterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                const topic = match[1].trim().toLowerCase();
                if (topic.length > 2 && topic.length < 50 && !userData.profile.lastTopics.includes(topic)) {
                    userData.profile.lastTopics.push(topic);
                    if (userData.profile.lastTopics.length > 20) {
                        userData.profile.lastTopics = userData.profile.lastTopics.slice(-20);
                    }
                }
            }
        }

        return userData;
    }

    buildMessages(userData, userMessage, context) {
        const messages = [{ role: 'system', content: context }];

        const recentHistory = userData.history.slice(-this.config.maxContext);
        recentHistory.forEach(msg => {
            messages.push({ role: 'user', content: msg.user });
            messages.push({ role: 'assistant', content: msg.assistant });
        });

        messages.push({ role: 'user', content: userMessage });

        return messages;
    }

    smartTruncate(text, limit = this.config.safeLimit) {
        if (text.length <= limit) return [text, ''];

        const parts = text.split(/\n\n+/);
        let result = '';
        let overflow = '';
        let isOverflow = false;

        for (const para of parts) {
            if ((result + para + '\n\n').length <= limit && !isOverflow) {
                result += para + '\n\n';
            } else {
                isOverflow = true;
                overflow += para + '\n\n';
            }
        }

        if (!result.trim() || (isOverflow && !overflow.trim())) {
            const words = text.split(' ');
            result = '';
            for (const word of words) {
                if ((result + word + ' ').length <= limit - 3) {
                    result += word + ' ';
                } else {
                    break;
                }
            }
            overflow = text.slice(result.length).trim();
            result = result.trim() + '...';
        }

        return [result.trim(), overflow.trim()];
    }

    formatForDiscord(text) {
        if (!text) return '';

        let formatted = text
            .replace(/^#{1,6}\s+(.+)$/gm, '**$1**')
            .replace(/\*\*(.+?)\*\*/g, '**$1**')
            .replace(/\*(.+?)\*/g, '*$1*')
            .replace(/`([^`]+)`/g, '`$1`')
            .replace(/```(\w+)?\n([\s\S]+?)```/g, '\n$2\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        return formatted;
    }

    formatBetterOutput(text) {
        if (!text) return '';

        let formatted = text
            .replace(/\n{3,}/g, '\n\n')
            .replace(/^- (.+)$/gm, '• **$1**')
            .replace(/^\d+\. (.+)$/gm, (match, p1) => `**${match.trim()}**`)
            .trim();

        return formatted;
    }

    getMoodColor(mood) {
        const colors = {
            happy: 0x57F287,
            sad: 0x5865F2,
            angry: 0xED4245,
            anxious: 0xFEE75C,
            bored: 0x9B59B6,
            neutral: this.config.color
        };
        return colors[mood] || colors.neutral;
    }

    getMoodEmoji(mood) {
        const emojis = {
            happy: '✨',
            sad: '💚',
            angry: '😤',
            anxious: '😰',
            bored: '🫠',
            neutral: ''
        };
        return emojis[mood] || '';
    }

    buildResponsePanel(reply, duration, userId, meta = null) {
        const title = "# Grims — AI Assistant";
        const footerText = meta && meta.total > 1
            ? `⏱️ ${duration}s • Bagian ${meta.current}/${meta.total}\nGrims bisa aja salah jadi tolong cross check lagi jawaban dia`
            : `⏱️ ${duration}s • Grims bisa aja salah jadi tolong cross check lagi jawaban dia`;

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(title))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(this.formatForDiscord(reply)))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footerText}`));

        const actionRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Suka')
                    .setEmoji('1488518883412545717')
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId(`grims_like_${userId}`),
                new ButtonBuilder()
                    .setLabel('Kurang Suka')
                    .setEmoji('1488518917625348236')
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId(`grims_dislike_${userId}`),
                new ButtonBuilder()
                    .setLabel('Beri Masukan')
                    .setEmoji('1488518853922390147')
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId(`grims_feedback_${userId}`),
                new ButtonBuilder()
                    .setLabel('Reply')
                    .setEmoji('1488518826470412412')
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId(`grims_reply_${userId}`),
                new ButtonBuilder()
                    .setLabel('Thinking AI')
                    .setEmoji('1458089519399174144')
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId(`grims_better_${userId}`)
            );

        return { container, actionRow };
    }

    buildBetterResponsePanel(reply, duration, userId, reasoning = null) {
        const title = "# Grims — AI Assistant `THINKING`";
        const footerText = `⏱️ ${duration}s • Optimized Response • Grims can make mistakes`;

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(title));

        if (reasoning) {
            const truncatedReasoning = reasoning.length > 500 ? reasoning.substring(0, 500) + '...' : reasoning;
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`> **Process Reasoning:**\n> *${truncatedReasoning.replace(/\n/g, '\n> ')}*`)
            );
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        }

        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(this.formatBetterOutput(reply)))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footerText}`));

        const actionRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Suka')
                    .setEmoji('1488518883412545717')
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId(`grims_better_like_${userId}`),
                new ButtonBuilder()
                    .setLabel('Reply')
                    .setEmoji('1488518826470412412')
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId(`grims_better_reply_${userId}`)
            );

        return { container, actionRow };
    }

    buildNavButtons(page, total) {
        const row = new ActionRowBuilder();

        if (total <= 1) return row;

        if (page > 1) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`grims_nav_prev_${page}`)
                    .setLabel('◀️ Sebelumnya')
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`grims_nav_next_${page}`)
                .setLabel(page >= total ? 'Selesai ✓' : `Selanjutnya ▶️ (${page}/${total})`)
                .setStyle(page >= total ? ButtonStyle.Success : ButtonStyle.Primary)
                .setDisabled(page >= total)
        );

        return row;
    }

    checkRateLimit(userId) {
        const now = Date.now();
        const lastCall = this.rateLimit.get(userId) || 0;

        if (now - lastCall < 2000) {
            return false;
        }

        this.rateLimit.set(userId, now);
        return true;
    }

    splitIntoPages(text, limit = this.config.safeLimit) {
        const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
        const pages = [];
        let current = '';

        for (const para of paragraphs) {
            if ((current + para + '\n\n').length <= limit) {
                current += para + '\n\n';
            } else {
                if (current.trim()) pages.push(current.trim());

                if (para.length <= limit) {
                    current = para + '\n\n';
                } else {
                    const words = para.split(' ');
                    current = '';
                    for (const word of words) {
                        if ((current + word + ' ').length <= limit - 3) {
                            current += word + ' ';
                        } else {
                            if (current.trim()) pages.push(current.trim());
                            current = word + ' ';
                        }
                    }
                    current += '\n\n';
                }
            }
        }

        if (current.trim()) pages.push(current.trim());

        return pages.length > 0 ? pages : [text.substring(0, limit - 3) + '...'];
    }

    async chatWithAI(messages) {
        try {
            const completion = await this.client.chat.completions.create({
                model: this.config.model,
                messages: messages,
                temperature: this.config.temperature,
                top_p: this.config.topP,
                max_tokens: this.config.maxTokens,
                stream: false
            });

            let reply = completion.choices[0]?.message?.content || '';
            return reply;
        } catch (err) {
            Logger.error('[GrimsAI] AI chat error: ' + err.message);

            if (err.status === 401 || err.message?.includes('authentication') || err.message?.includes('api key')) {
                throw new Error('AUTH_ERROR');
            }

            if (err.status === 429 || err.message?.includes('rate limit')) {
                throw new Error('RATE_LIMIT');
            }

            if (err.status === 500 || err.status === 502 || err.status === 503) {
                throw new Error('SERVER_ERROR');
            }

            throw err;
        }
    }

    async processQueue() {
        if (this.isProcessingQueue || this.messageQueue.length === 0) return;

        this.isProcessingQueue = true;

        while (this.messageQueue.length > 0) {
            const item = this.messageQueue.shift();
            try {
                const response = await this.chatWithAI(item.messages);
                item.resolve(response);
            } catch (err) {
                item.reject(err);
            }

            await new Promise(r => setTimeout(r, 500));
        }

        this.isProcessingQueue = false;
    }

    queueChat(messages) {
        return new Promise((resolve, reject) => {
            this.messageQueue.push({ messages, resolve, reject });
        });
    }

    async handleMessage(message) {
        if (message.author.bot) return;
        if (message.channel.id !== this.config.channel) return;
        if (message.guild?.id !== this.config.guild) return;

        const userId = message.author.id;

        if (this.processing.has(userId)) return;
        if (!this.checkRateLimit(userId)) return;

        let content = message.content.trim();
        const isMentioned = content.includes(`<@${message.client.user.id}>`) || content.includes(`<@!${message.client.user.id}>`);

        if (isMentioned) {
            content = content.replace(/<@!?(\d+)>/g, '').trim();
        }

        if (!content.startsWith(this.config.prefix) && !isMentioned) return;

        if (content.startsWith(this.config.prefix)) {
            content = content.slice(this.config.prefix.length).trim();
        }

        if (!content) {
            if (isMentioned) {
                await message.reply({
                    content: 'Hai! Aku Grims 💚 Mau ngobrol apa nih?'
                });
                return;
            }
            return;
        }

        this.processing.add(userId);

        const displayName = message.member?.displayName || message.author.globalName || message.author.username;
        const username = message.author.username;

        const userData = this.getUserData(userId);
        userData.stats.totalMessages++;

        const detectedMood = this.detectMood(content);
        const detectedLang = this.detectLanguage(content);
        userData.profile.mood = detectedMood;
        userData.profile.language = detectedLang;

        this.extractInfo(content, userData);

        const context = this.buildContext(userId, displayName, username);
        const messages = this.buildMessages(userData, content, context);

        await message.channel.sendTyping();
        const startTime = Date.now();

        try {
            if (!this.client) {
                throw new Error('AUTH_ERROR');
            }

            let reply = await this.queueChat(messages);

            reply = reply.trim() || 'Hmm, ada gangguan nih. Coba lagi yaa~';
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            const pages = this.splitIntoPages(reply);

            if (pages.length > 1) {
                const msgId = `${userId}_${Date.now()}`;
                this.activePages.set(msgId, { pages, currentPage: 0, duration, mood: detectedMood });

                const { container, actionRow } = this.buildResponsePanel(pages[0], duration, userId, { current: 1, total: pages.length });
                const navRow = this.buildNavButtons(1, pages.length);

                const sentMsg = await message.reply({
                    components: [container, navRow, actionRow],
                    flags: MessageFlags.IsComponentsV2
                });

                this.setupPageCollector(sentMsg, msgId, pages.length, message.client, message.guild, userId);

            } else {
                const { container, actionRow } = this.buildResponsePanel(reply, duration, userId);

                await message.reply({
                    components: [container, actionRow],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            userData.history.push({ user: content, assistant: reply, timestamp: Date.now() });
            if (userData.history.length > this.config.maxHistory) {
                userData.history = userData.history.slice(-this.config.maxHistory);
            }

            this.saveUserData(userId, userData);

            Logger.info(`[GrimsAI] ${displayName} | ${duration}s | ${detectedMood} | ${detectedLang}`);

        } catch (err) {
            Logger.error('[GrimsAI] Error: ' + err.message);

            let errorMsg = 'Wah, ada gangguan nih 😔 coba lagi yaa~';

            if (err.message === 'AUTH_ERROR') {
                errorMsg = `⚠️ **API Key Bermasalah**\n\nNVIDIA NIM API key tidak valid atau belum disetup.\n\nHubungi <@${process.env.OWNER_ID || '1405930901300318345'}> untuk bantuan 💚`;
            } else if (err.message === 'RATE_LIMIT') {
                errorMsg = 'Lagi sibuk nih, sabar bentar ya~ Tunggu beberapa detik dan coba lagi 💚';
            } else if (err.message === 'SERVER_ERROR') {
                errorMsg = 'Server AI lagi ngambek, coba lagi nanti ya~ 😔';
            } else if (err.message?.includes('network') || err.message?.includes('ECONNREFUSED')) {
                errorMsg = 'Koneksi lagi bermasalah nih, coba lagi ya~ 🌐';
            }

            await message.reply({
                content: errorMsg
            });
        } finally {
            this.processing.delete(userId);
        }
    }

    setupPageCollector(message, msgId, totalPages, client, guild, userId) {
        const filter = (i) => i.user.id === userId && i.customId.startsWith('grims_nav_');

        const collector = message.createMessageComponentCollector({ filter, time: 180000 });

        collector.on('collect', async (interaction) => {
            try {
                const pageData = this.activePages.get(msgId);
                if (!pageData) {
                    await interaction.update({ components: [] });
                    return;
                }

                const parts = interaction.customId.split('_');
                const action = parts[2];
                let newPage = pageData.currentPage;

                if (action === 'next') {
                    newPage = Math.min(pageData.currentPage + 1, totalPages - 1);
                } else if (action === 'prev') {
                    newPage = Math.max(pageData.currentPage - 1, 0);
                }

                pageData.currentPage = newPage;

                const { container, actionRow } = this.buildResponsePanel(
                    pageData.pages[newPage],
                    pageData.duration,
                    userId,
                    { current: newPage + 1, total: totalPages }
                );

                const navRow = this.buildNavButtons(newPage + 1, totalPages);

                await interaction.update({
                    components: [container, navRow, actionRow],
                    flags: MessageFlags.IsComponentsV2
                });

            } catch (err) {
                Logger.error('[GrimsAI] Nav error: ' + err.message);
            }
        });

        collector.on('end', () => {
            this.activePages.delete(msgId);
        });
    }

    async handleInteraction(interaction) {
        if (!interaction.isButton() && !interaction.isModalSubmit()) return;

        const { customId, user } = interaction;

        if (customId.startsWith('grims_like_')) {
            await interaction.reply({ content: 'Senang kamu menyukai jawabanku! ✨', flags: MessageFlags.Ephemeral });
        }

        else if (customId.startsWith('grims_dislike_')) {
            await interaction.reply({ content: 'Maaf ya jika jawabanku kurang memuaskan. Kamu bisa beri masukan agar aku lebih baik! 💚', flags: MessageFlags.Ephemeral });
        }

        else if (customId.startsWith('grims_feedback_')) {
            const modal = new ModalBuilder()
                .setCustomId('grims_feedback_modal_submit')
                .setTitle('Berikan Masukan untuk Grims');

            const feedbackInput = new TextInputBuilder()
                .setCustomId('feedback_text')
                .setLabel('Apa yang bisa diperbaiki?')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Misal: Grims bahasanya kaku banget atau AI-nya kurang nyambung...')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(feedbackInput));
            await interaction.showModal(modal);
        }

        else if (customId.startsWith('grims_better_')) {
            if (customId.startsWith('grims_better_like_') || customId.startsWith('grims_better_reply_')) {
                if (customId.startsWith('grims_better_like_')) {
                    await interaction.reply({ content: 'Senang kamu menyukai jawabanku! ✨', flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: 'Silakan ketik langsung pesanmu untuk membalas! 💚', flags: MessageFlags.Ephemeral });
                }
                return;
            }

            const userId = customId.split('_').pop();
            if (interaction.user.id !== userId) {
                return interaction.reply({ content: 'Hanya yang menanyakan ini yang bisa minta Thinking AI! 💚', flags: MessageFlags.Ephemeral });
            }

            await interaction.deferReply();

            const originalMsgId = interaction.message.reference?.messageId;
            let originalMessage = null;

            if (originalMsgId) {
                originalMessage = await interaction.channel.messages.fetch(originalMsgId).catch(() => null);
            }

            if (!originalMessage) {
                return interaction.editReply({ content: 'Maaf, referensi pesan asli tidak ditemukan untuk regenerasi. 😔' });
            }

            let userContent = originalMessage.content.trim();
            if (userContent.includes(`<@${interaction.client.user.id}>`) || userContent.includes(`<@!${interaction.client.user.id}>`)) {
                userContent = userContent.replace(/<@!?(\d+)>/g, '').trim();
            }
            if (userContent.startsWith(this.config.prefix)) {
                userContent = userContent.slice(this.config.prefix.length).trim();
            }

            const startTime = Date.now();
            const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
            const userData = this.getUserData(userId);

            const context = this.buildContext(userId, displayName, interaction.user.username) +
                "\n\n# INTRUKSI KHUSUS THINKING MODE\n" +
                "Kamu sedang menggunakan mode 'THINKING'. Berikan jawaban yang jauh lebih mendalam, sangat terstruktur, dan premium.\n" +
                "- Gunakan struktur markdown yang rapi (Heading, Bold, List).\n" +
                "- Tambahkan emoji yang relevan di awal setiap poin atau heading.\n" +
                "- Berikan analisis kritis, perbandingan detail, atau saran tambahan yang bernilai tinggi.\n" +
                "- Tunjukkan empati yang tinggi jika konteksnya curhat, tunjukkan kecerdasan tinggi jika konteksnya teknis.\n" +
                "- Pastikan alur pembahasannya logis dan mudah dibaca (pake pemisah paragraf yang jelas).";

            const messages = this.buildMessages(userData, userContent, context);

            try {
                const completion = await this.client.chat.completions.create({
                    model: this.config.betterModel,
                    messages: messages,
                    max_tokens: 4096,
                    temperature: 0.60,
                    top_p: 0.95
                });

                let reply = completion.choices[0]?.message?.content || '';
                let reasoningCollected = completion.choices[0]?.message?.reasoning_content || '';
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);

                const { container, actionRow } = this.buildBetterResponsePanel(reply, duration, userId, reasoningCollected.trim());

                await interaction.editReply({
                    content: null,
                    components: [container, actionRow],
                    flags: MessageFlags.IsComponentsV2
                });

                Logger.info(`[ThinkingAI] ${displayName} | ${duration}s | Model: ${this.config.betterModel}`);
            } catch (err) {
                Logger.error('[ThinkingAI] Error: ' + err.message);
                await interaction.editReply({ content: 'Maaf, saat ini Thinking AI sedang sibuk. Coba fitur normal dulu yaa~ 💚' });
            }
        }

        else if (customId === 'grims_feedback_modal_submit') {
            const feedback = interaction.fields.getTextInputValue('feedback_text');
            const ownerId = '1405930901300318345';

            try {
                const owner = await interaction.client.users.fetch(ownerId);

                const feedbackMsg = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent("# Improve AI Grims")
                    )
                    .addSectionComponents(
                        new SectionBuilder()
                            .setThumbnailAccessory(
                                new ThumbnailBuilder()
                                    .setURL(user.displayAvatarURL({ dynamic: true, size: 512 }))
                            )
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(
                                    `> **Display Name** : ${user.displayName}\n` +
                                    `> **Username** : ${user.username}\n` +
                                    `> **User ID** : \`${user.id}\`\n\n` +
                                    `**Masukan dari User:**\n` +
                                    `> ${feedback}`
                                )
                            )
                    )
                    .addSeparatorComponents(
                        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                    )
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent("-# Pesan ini dikirim otomatis melalui sistem feedback Grims AI")
                    );

                await owner.send({
                    components: [feedbackMsg]
                }).catch(err => console.error(`[GrimsAI] Failed to DM owner: ${err}`));

                await interaction.reply({
                    content: '💚 Makasih banget masukannya! Udah Grims sampein ke Bang <@1405930901300318345> yaa.',
                    flags: MessageFlags.Ephemeral
                });
            } catch (err) {
                Logger.error('[GrimsAI] Feedback error: ' + err.message);
                await interaction.reply({
                    content: 'Waduh, ada masalah pas ngirim masukan. Coba lagi nanti ya!',
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        else if (customId.startsWith('grims_reply_')) {
            await interaction.reply({ content: 'Silakan ketik langsung pesanmu untuk membalas! Aku akan mengingat konteks di atas. 💚', flags: MessageFlags.Ephemeral });
        }
    }

    cleanup() {
        if (this.queueProcessingInterval) {
            clearInterval(this.queueProcessingInterval);
            this.queueProcessingInterval = null;
        }
        Logger.info('[GrimsAI] Cleanup completed');
    }

    getStatus() {
        return {
            hasClient: !!this.client,
            queueLength: this.messageQueue.length,
            processingCount: this.processing.size,
            model: this.config.model
        };
    }
}

const grimsAI = new GrimsAI();

module.exports = {
    name: 'grims',
    description: 'Grims AI Chat - Powered by NVIDIA NIM',
    prefix: 'g!',
    handleMessage: (message) => grimsAI.handleMessage(message),
    handleInteraction: (interaction) => grimsAI.handleInteraction(interaction),
    getAI: () => grimsAI,
    getStatus: () => grimsAI.getStatus()
};
