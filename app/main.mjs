import fs from 'fs/promises';

import cron from 'node-cron';
import dateFnsTz from 'date-fns-tz';
import dotenv from 'dotenv';
import { getWeek } from 'date-fns';
import {
    ApplicationCommandOptionType,
    Client,
    Events,
    GatewayIntentBits,
    REST,
    Routes
} from 'discord.js';
import { google } from 'googleapis';

const recurringAnnouncements = [];
const scheduledAnnouncements = [];

async function saveDB() {
    await fs.writeFile('db.json', JSON.stringify(db));
}

async function setData(data) {
    db.sheetID = data[0].value.trim();
    db.tz = (data[1].value ?? 'Europe/Amsterdam').trim();

    await saveDB();
    await refresh();

    return `Set Google sheet ID to ${db.sheetID}, tz to ${db.tz}, and refreshed schedule.`;
}

function getData() {
    return `Current Google sheet ID is ${db.sheetID}, tz is ${db.tz}.`;
}

async function refresh() {
    if (!db.sheetID) {
        return 'There is no Google sheet ID to get data from!';
    }

    const auth = google.auth.fromAPIKey(process.env.GOOGLE_API_KEY);
    const sheets = google.sheets({ version: 'v4', auth });

    const recurringRes = await sheets.spreadsheets.values.get({
        spreadsheetId: db.sheetID, range: 'Recurring'
    });
    const scheduledRes = await sheets.spreadsheets.values.get({
        spreadsheetId: db.sheetID, range: 'Scheduled'
    });

    recurringAnnouncements.length = 0;
    scheduledAnnouncements.length = 0;

    recurringAnnouncements.push(...recurringRes.data.values.slice(1));
    scheduledAnnouncements.push(...scheduledRes.data.values.slice(1));

    return `Refreshed list with ${recurringAnnouncements.length} recurring and ${scheduledAnnouncements.length} scheduled announcements.`;
}

async function sendAnnouncement(channelName, message) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);

    const channel = guild.channels.cache.find(c => c.name === channelName);

    if (!channel) {
        throw new Error(`Couldn't find channel ${channel}!`);
    }

    await channel.send(message);

    console.log(`[${now.toISOString()}] Sent announcement (${message}`);
}

function runAnnouncements(now) {
    // Make sure now is floored to the last minute
    now.setSeconds(0, 0);

    const zonedTime = dateFnsTz.utcToZonedTime(now, db.tz);
    const currentTime = zonedTime.toTimeString().slice(0, 5);
    const currentDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][zonedTime.getDay()];
    const currentWeek = getWeek(zonedTime, { weekStartsOn: 1, firstWeekContainsDate: 7 });

    for (const recurringAnnouncement of recurringAnnouncements) {
        const [recurrence, day, time, channel, message, approved] = recurringAnnouncement;

        if (approved !== 'TRUE' || currentDay != day.toLowerCase() || currentTime != time) {
            continue;
        }

        switch (recurrence) {
            case 'Every Week':
                // Don't need to do anything
                break;
            case 'Even Week':
                // Continue if current week is odd
                if ((currentWeek % 2) !== 0) {
                    continue;
                }
                break;
            case 'Off Week':
                // Continue if current week is even
                if ((currentWeek % 2) === 0) {
                    continue;
                }
                break;
            default:
                console.log(`[${now.toISOString()}] Unknown recurrence pattern: ${recurrence}!`);
                continue;
        }

        sendAnnouncement(channel, message).catch(err => console.error(`[${now.toISOString()}] ${err}`));
    }

    for (const scheduledAnnouncement of scheduledAnnouncements) {
        const [date, time, channel, message, approved] = scheduledAnnouncement;

        if (approved !== 'TRUE') {
            continue;
        }

        const announcementDate = dateFnsTz.utcToZonedTime(new Date(`${date}T${time}:00Z`), db.tz);

        if (announcementDate.getTime() !== zonedTime.getTime()) {
            continue;
        }

        sendAnnouncement(channel, message).catch(err => console.error(`[${now.toISOString()}] ${err}`));
    }
}

const commands = [
    {
        name: 'setdata',
        description: 'Set the Google sheet ID and time zone',
        _func: setData,
        options: [
            {
                name: 'id',
                description: 'ID of the Google sheet',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'tz',
                description: 'Time zone of the bot (Optional, default: Europe/Amsterdam)',
                type: ApplicationCommandOptionType.String
            }
        ]
    },
    {
        name: 'getdata',
        description: 'Get the current Google sheet ID and time zone',
        _func: getData
    },
    {
        name: 'refresh',
        description: 'Force an immediate refresh of the announcements list',
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
    db = { tz: 'Europe/Amsterdam' };
}

// Add/update commands
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

await rest.put(Routes.applicationCommands('1030427278640943164'), { body: commands.map(({ _func, ...c }) => c) });

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
console.log(`[${(new Date()).toISOString()}] ${await refresh()}`);

// Refresh announcements list every hour
cron.schedule('0 * * * *', async now => {
    const message = await refresh();

    console.log(`[${now.toISOString()}] ${message}`);
});

// Run announcements every minute
cron.schedule('* * * * *', runAnnouncements);
