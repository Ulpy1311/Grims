require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Logger = require('./Server/Logger');
const chatAI = require('./Server/Chat AI');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

client.once('clientReady', () => {
    Logger.init();
    Logger.separator();
    Logger.success(`Logged in as ${client.user.tag}`);
    Logger.info(`Guild: ${process.env.GUILD_ID || 'Not set'}`);
    Logger.info(`Channel: ${process.env.CHANNEL_ID || 'Not set'}`);
    Logger.info(`Prefix: ${process.env.PREFIX || 'g!'}`);
    Logger.separator();
});

client.on('messageCreate', (message) => {
    chatAI.handleMessage(message);
});

client.on('interactionCreate', (interaction) => {
    chatAI.handleInteraction(interaction);
});

client.on('error', (error) => {
    Logger.error(`Client error: ${error.message}`);
});

process.on('unhandledRejection', (error) => {
    Logger.error(`Unhandled rejection: ${error.message || error}`);
});

process.on('SIGINT', () => {
    Logger.warn('Shutting down...');
    chatAI.getAI().cleanup();
    client.destroy();
    process.exit(0);
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
    Logger.error('DISCORD_TOKEN not found in .env');
    process.exit(1);
}

client.login(token);
