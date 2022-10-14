import fs from 'fs/promises';

import cron from 'node-cron';
import dotenv from 'dotenv';
import {
    ApplicationCommandOptionType,
    Client,
    Events,
    GatewayIntentBits,
    REST,
    Routes
} from 'discord.js';
import { google } from 'googleapis';

const announcements = [];

async function saveDB() {
    await fs.writeFile('db.json', JSON.stringify(db));
}

async function setData(data) {
    db.sheetID = data[0].value;
    db.sheetRange = data[1].value ?? '';

    await saveDB();
    await refresh();

    return `Set Google sheet ID to ${db.sheetID}, range to ${db.sheetRange}, and refreshed schedule.`;
}

function getData() {
    return `Current Google sheet ID is ${db.sheetID}, range is ${db.sheetRange}.`;
}

async function refresh() {
    if (!db.sheetID) {
        return 'There is no Google sheet ID to get data from!';
    }

    const auth = google.auth.fromAPIKey(process.env.GOOGLE_API_KEY);
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: db.sheetID,
        range: db.sheetRange
    });
    const rows = res.data.values;

    if (rows?.length < 1) {
        return 'No data found.';
    }

    // TODO: sheet: date, time, channel, message

    // Empty announcements array
    announcements.length = 0;
    for (const row of rows) {
        // TODO: Fill announcements array
        //  Only with announcements whose time hasn't come yet
    }

    return 'Refreshed schedule.';
}

async function announce(now) {
    // Make sure now is rounded to the last minute
    now.setSeconds(0, 0);

    const guild = await client.guilds.fetch(process.env.GUILD_ID);

    for (let i = announcements.length - 1; i >= 0; i--) {
        const announcement = announcements[i];

        if (announcement.date.getTime() >= now.getTime()) {
            continue;
        }

        const channel = guild.channels.cache.find(c => c.name === announcement.channel);

        if (!channel) {
            console.log(`[${now}] Couldn't find channel ${announcement.channel}!`);
            continue;
        }

        // <@&594525650115624981>
        await channel.send(announcement.message);

        console.log(`[${now}] Sent announcement (${announcement})`);

        // Remove announcement from list
        announcements.splice(i, 1);
    }
}

const commands = [
    {
        name: 'setdata',
        description: 'Set the Google sheet ID and range',
        _func: setData,
        options: [
            {
                name: 'id',
                description: 'ID of the Google sheet',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'range',
                description: 'Range selector to use in sheet (Optional)',
                type: ApplicationCommandOptionType.String
            }
        ]
    },
    {
        name: 'getdata',
        description: 'Get the current Google sheet ID and range',
        _func: getData
    },
    {
        name: 'refresh',
        description: 'Force an immediate refresh of the schedule',
        _func: refresh
    }
];

// Load env variables
dotenv.config();

// Load db
let db = null;

try {
    db = JSON.parse(await fs.readFile('db.json'));
} catch {
    db = {};
}

// Add/update commands
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

await rest.put(Routes.applicationCommands('1030427278640943164'), { body: commands });

// Start chat bot
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) {
        return;
    }

    for (const command of commands) {
        if (command.name !== interaction.commandName) {
            continue;
        }

        const reply = await command._func(interaction.options.data);

        await interaction.reply(reply);

        break;
    }
});

client.login(process.env.DISCORD_TOKEN);

// Initial refresh
console.log(`[${now}] ${await refresh()}`);

// Refresh schedule every hour
cron.schedule('0 * * * *', async now => {
    const message = await refresh();

    console.log(`[${now}] ${message}`);
});

// Run announcements every minute
cron.schedule('* * * * *', announce);
