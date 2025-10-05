require('dotenv').config();
const { Client, GatewayIntentBits, Collection, EmbedBuilder, PermissionsBitField, ChannelType, REST, Routes, ActivityType, ActionRowBuilder, ButtonBuilder, ModalBuilder,
    TextInputBuilder,
    TextInputStyle, ButtonStyle, Events, StringSelectMenuBuilder } = require('discord.js');
const mongoose = require('mongoose');
const cron = require('node-cron');
const moment = require('moment');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessageTyping
    ]
});

// MongoDB Atlas Connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    retryWrites: true,
    w: 'majority'
})
    .then(() => {
        console.log('✅ MongoDB Atlas Connected Successfully');
    })
    .catch(err => {
        console.error('❌ MongoDB Atlas Connection Error:', err.message);
    });

// Database Schemas
const scrimsSchema = new mongoose.Schema({
    guildId: String,
    scrimsName: String,
    registrationChannel: String,
    slotlistChannel: String,
    requiredRole: String,
    successRole: String,
    botAdminRole: String,
    requiredTags: Number,
    totalSlots: Number,
    openTime: String,
    scrimsTime: String,
    status: { type: String, default: 'scheduled' },
    createdAt: { type: Date, default: Date.now },
    dailySchedule: {
        detailsSent: { type: Boolean, default: false },
        lastReset: Date
    },
    registeredTeams: [{
        teamName: String,
        players: [String],
        captain: String,
        registeredAt: { type: Date, default: Date.now },
        slotNumber: Number,
        messageId: String,
        validated: { type: Boolean, default: false },
        roleAssigned: { type: Boolean, default: false }
    }],
    reservedSlots: [{
        slotNumber: Number,
        teamName: String,
        user: String,
        reservedAt: { type: Date, default: Date.now },
        expiresAt: Date,
        status: { type: String, default: 'active' }
    }],
    cancelledSlots: [{
        slotNumber: Number,
        teamName: String,
        user: String,
        cancelledAt: { type: Date, default: Date.now },
        reason: String
    }]
});

const guildSettingsSchema = new mongoose.Schema({
    guildId: String,
    logChannel: String,
    botAdminRole: String,
    createdAt: { type: Date, default: Date.now }
});

// NEW: Reminder Schema (Separate Collection)
const reminderSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    userTag: String,
    createdAt: { type: Date, default: Date.now },
    notified: { type: Boolean, default: false }
});

const Scrims = mongoose.model('Scrims', scrimsSchema);
const GuildSettings = mongoose.model('GuildSettings', guildSettingsSchema);
const Reminder = mongoose.model('Reminder', reminderSchema); // NEW

// Collections
client.commands = new Collection();

// Slash Commands Definition - SCRIMS SECTION
const scrimsCommands = [
    {
        name: 'setup',
        description: 'Setup bot admin role and log channel',
        options: [
            {
                name: 'bot_admin_role',
                type: 8,
                description: 'Select role for bot administrators (can create/delete scrims)',
                required: true
            }
        ]
    },
    {
        name: 'cancel-claim-slot',
        description: 'Show available slots and allow players to cancel/claim slots',
        options: [
            {
                name: 'channel',
                type: 7,
                description: 'Select the channel to post the slot management message',
                required: true,
                channel_types: [ChannelType.GuildText]
            }
        ]
    },
    {
        name: 'test-slotlist',
        description: 'Show an example slot list for testing'
    },
    {
        name: 'create-scrims',
        description: 'Create a new scrims event',
        options: [
            {
                name: 'registration_channel',
                type: 7,
                description: 'Channel where registration will happen',
                required: true,
                channel_types: [ChannelType.GuildText]
            },
            {
                name: 'slotlist_channel',
                type: 7,
                description: 'Channel where slot list will be posted',
                required: true,
                channel_types: [ChannelType.GuildText]
            },
            {
                name: 'success_role',
                type: 8,
                description: 'Role to assign when registration format is correct',
                required: true
            },
            {
                name: 'required_tags',
                type: 4,
                description: 'Number of Discord tags required per team (Admin decides)',
                required: true,
                min_value: 1
            },
            {
                name: 'total_slots',
                type: 4,
                description: 'Total number of slots available (Admin decides)',
                required: true,
                min_value: 1
            },
            {
                name: 'open_time',
                type: 3,
                description: 'Registration open time (HH:MM 24hr format)',
                required: true
            },
            {
                name: 'scrims_time',
                type: 3,
                description: 'Actual scrims start time (HH:MM 24hr format)',
                required: true
            },
            {
                name: 'scrims_name',
                type: 3,
                description: 'Name for this scrims event',
                required: false
            }
        ]
    },
    {
        name: 'list-scrims',
        description: 'List all active scrims events'
    },
    {
        name: 'delete-scrims',
        description: 'Delete a scrims event (Bot Admin only)',
        options: [
            {
                name: 'scrims_id',
                type: 3,
                description: 'Scrims event ID to delete',
                required: true
            }
        ]
    },
    {
        name: 'reserve-team',
        description: 'Reserve a slot for a team before registration',
        options: [
            {
                name: 'registration_channel',
                type: 7,
                description: 'Select the scrims registration channel',
                required: true,
                channel_types: [ChannelType.GuildText]
            },
            {
                name: 'slot',
                type: 4,
                description: 'Slot number to reserve',
                required: true,
                min_value: 1
            },
            {
                name: 'team_name',
                type: 3,
                description: 'Name of the team to reserve',
                required: true
            },
            {
                name: 'user',
                type: 6,
                description: 'Team captain/user',
                required: true
            },
            {
                name: 'expire_time',
                type: 3,
                description: 'Reservation expiry time (e.g., 2h, 30m, 1d)',
                required: true
            }
        ]
    },
    {
        name: 'show-reservations',
        description: 'Show all reserved slots for a scrims',
        options: [
            {
                name: 'registration_channel',
                type: 7,
                description: 'Select the scrims registration channel',
                required: true,
                channel_types: [ChannelType.GuildText]
            }
        ]
    },
    {
        name: 'cancel-reservation',
        description: 'Cancel a slot reservation',
        options: [
            {
                name: 'registration_channel',
                type: 7,
                description: 'Select the scrims registration channel',
                required: true,
                channel_types: [ChannelType.GuildText]
            },
            {
                name: 'slot',
                type: 4,
                description: 'Slot number to cancel reservation',
                required: true,
                min_value: 1
            }
        ]
    },
    {
        name: 'assign-slots',
        description: 'Manually assign slots to validated teams',
        options: [
            {
                name: 'registration_channel',
                type: 7,
                description: 'Select the scrims registration channel',
                required: true,
                channel_types: [ChannelType.GuildText]
            }
        ]
    },
    {
        name: 'open-registration',
        description: 'Manually open registration for a scrims',
        options: [
            {
                name: 'registration_channel',
                type: 7,
                description: 'Select the scrims registration channel',
                required: true,
                channel_types: [ChannelType.GuildText]
            }
        ]
    },
    {
        name: 'close-registration',
        description: 'Manually close registration for a scrims',
        options: [
            {
                name: 'registration_channel',
                type: 7,
                description: 'Select the scrims registration channel',
                required: true,
                channel_types: [ChannelType.GuildText]
            }
        ]
    }
];

// Register Slash Commands
async function registerSlashCommands() {
    try {
        console.log('🔄 Registering scrims commands...');
        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: scrimsCommands }
        );
        console.log('✅ Scrims commands registered successfully!');
    } catch (error) {
        console.error('❌ Error registering scrims commands:', error);
    }
}
// Get Available Slots from All Scrims
async function getAvailableSlots(guild) {
    try {
        const allScrims = await Scrims.find({ guildId: guild.id });
        const availableSlots = [];

        for (const scrims of allScrims) {
            // Only consider scrims that are open or closed (not scheduled)
            if (scrims.status !== 'open' && scrims.status !== 'closed') continue;

            // Get slot assignments data
            const validatedTeams = scrims.registeredTeams.filter(team => team.validated);
            const activeReservations = scrims.reservedSlots.filter(r => r.status === 'active');
            const cancelledSlots = scrims.cancelledSlots;
            // Calculate available slots (INCLUDES CANCELLED SLOTS)
            const totalFilled = validatedTeams.length + activeReservations.length;
            const openSlots = scrims.totalSlots - totalFilled + cancelledSlots.length;
            if (openSlots > 0) {
                availableSlots.push({
                    scrimsId: scrims._id,
                    scrimsName: scrims.scrimsName,
                    openSlots: openSlots,
                    totalSlots: scrims.totalSlots,
                    scrimsTime: scrims.scrimsTime,
                    registrationChannel: scrims.registrationChannel,
                    requiredRole: scrims.requiredRole,
                    status: scrims.status,
                    cancelledSlots: cancelledSlots.length
                });
            }
        }
        // Sort by available slots (most available first)
        availableSlots.sort((a, b) => b.openSlots - a.openSlots);

        return availableSlots;
    } catch (error) {
        console.error('❌ Error getting available slots:', error);
        return [];
    }
}

// Set Reminder for User
async function setSlotReminder(user, guild) {
    try {
        // Check if user already has a reminder
        const existingReminder = await Reminder.findOne({
            guildId: guild.id,
            userId: user.id
        });

        if (existingReminder) {
            return { success: false, message: 'You already have an active slot reminder!' };
        }

        // Create new reminder
        const newReminder = new Reminder({
            guildId: guild.id,
            userId: user.id,
            userTag: user.tag
        });

        await newReminder.save();

        // Send DM confirmation
        try {
            const dmEmbed = new EmbedBuilder()
                .setTitle('🔔 SLOT REMINDER SET')
                .setDescription('You will be notified when slots become available!')
                .setColor(0x0099FF)
                .addFields(
                    {
                        name: '📋 Reminder Details',
                        value: 'You will receive a DM when:\n• New slots become available\n• Someone cancels their slot\n• New scrims are created',
                        inline: false
                    },
                    {
                        name: '⏰ Next Steps',
                        value: 'Keep your DMs open and check the server regularly for updates.',
                        inline: false
                    }
                )
                .setFooter({ text: 'ScrimX Slot Reminder' })
                .setTimestamp();

            await user.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            console.log(`❌ Could not send DM to ${user.tag}:`, dmError.message);
            return {
                success: true,
                message: 'Reminder set! But I couldn\'t send you a DM. Make sure your DMs are open.'
            };
        }

        return { success: true, message: 'Slot reminder set successfully! Check your DMs.' };
    } catch (error) {
        console.error('❌ Error setting reminder:', error);
        return { success: false, message: 'Error setting reminder! Please try again.' };
    }
}

// Check and Send Reminders when Slots Become Available
async function checkAndSendReminders(guild) {
    try {
        const availableSlots = await getAvailableSlots(guild);
        if (availableSlots.length === 0) return;

        const activeReminders = await Reminder.find({
            guildId: guild.id,
            notified: false
        });

        if (activeReminders.length === 0) return;

        for (const reminder of activeReminders) {
            try {
                const user = await client.users.fetch(reminder.userId);
                if (!user) continue;

                const reminderEmbed = new EmbedBuilder()
                    .setTitle('🎉 SLOTS AVAILABLE!')
                    .setDescription('**Slots are now available! Hurry and claim your spot!**')
                    .setColor(0x00FF00)
                    .addFields(
                        {
                            name: '🚀 Quick Action',
                            value: 'Go to the server and use the **Claim Slot** button to get your slot!',
                            inline: false
                        },
                        {
                            name: '📋 Available Scrims',
                            value: availableSlots.map(slot =>
                                `• **${slot.scrimsName}** - ${slot.openSlots} slots available\n  Time: ${slot.scrimsTime} | Channel: <#${slot.registrationChannel}>`
                            ).join('\n'),
                            inline: false
                        }
                    )
                    .setFooter({ text: 'ScrimX Slot Notification' })
                    .setTimestamp();

                await user.send({ embeds: [reminderEmbed] });

                // Mark as notified
                reminder.notified = true;
                await reminder.save();

                console.log(`✅ Sent slot notification to ${user.tag}`);

            } catch (error) {
                console.error(`❌ Error notifying user ${reminder.userTag}:`, error);
            }
        }
    } catch (error) {
        console.error('❌ Error checking reminders:', error);
    }
}

// Create Cancel Claim Slot Embed
async function createCancelClaimEmbed(guild) {
    const availableSlots = await getAvailableSlots(guild);
    const hasAvailableSlots = availableSlots.length > 0;

    const embed = new EmbedBuilder()
        .setTitle('🎯 SLOT MANAGEMENT')
        .setColor(hasAvailableSlots ? 0x00FF00 : 0xFFA500)
        .setDescription(
            `● Press **Cancel Slot** to cancel your slot.\n` +
            `● Note that **Success Role** is required to cancel/transfer slots.\n\n` +
            `● **Available Slots:**`
        );

    // Add available slots information
    if (hasAvailableSlots) {
        let slotsInfo = '';
        availableSlots.forEach((slot, index) => {
            slotsInfo += `**${index + 1}. ${slot.scrimsName}**\n` +
                `   • Available: ${slot.openSlots}/${slot.totalSlots} slots\n` +
                `   • Time: ${slot.scrimsTime}\n` +
                `   • Channel: <#${slot.registrationChannel}>\n\n`;
        });
        embed.addFields({
            name: ' SLOTS AVAILABLE',
            value: slotsInfo,
            inline: false
        });
    } else {
        embed.addFields({
            name: ' NO SLOTS AVAILABLE',
            value: 'No slots available at the moment. Press 🔔 to set a reminder.',
            inline: false
        });
    }

    embed.setFooter({
        text: hasAvailableSlots ?
            'Slots available! Click Claim Slot to join.' :
            'Check back later for available slots.'
    })
        .setTimestamp();

    return {
        embed: embed,
        hasAvailableSlots: hasAvailableSlots
    };
}

// Create Cancel Claim Slot Embed - UPDATED (No Role Requirements)
async function createCancelClaimEmbed(guild) {
    const availableSlots = await getAvailableSlots(guild);
    const hasAvailableSlots = availableSlots.length > 0;

    const embed = new EmbedBuilder()
        .setTitle('🎯 SLOT MANAGEMENT SYSTEM')
        .setColor(hasAvailableSlots ? 0x00FF00 : 0xFFA500)
        .setDescription(
            `● Press **Cancel Slot** to cancel your existing slot.\n` +
            `● Press **Claim Slot** to instantly claim an available slot.\n` +
            `● Press **Remind Me** to get notified when slots open.\n\n` +
            `● **Available Slots Status:**`
        );

    // Add available slots information
    if (hasAvailableSlots) {
        let slotsInfo = '';
        availableSlots.forEach((slot, index) => {
            slotsInfo += `**${index + 1}. ${slot.scrimsName}**\n` +
                `   • **Slot Available:** ${slot.openSlots}/${slot.totalSlots} slots\n` +
                `   • **Time:** ${slot.scrimsTime}\n` +
                `   • **Register Here:** <#${slot.registrationChannel}>\n\n`;
        });
        embed.addFields({
            name: '🟢 SLOTS AVAILABLE - CLAIM NOW! 🟢',
            value: slotsInfo,
            inline: false
        });

        // Add quick claim instructions
        embed.addFields({
            name: '🚀 Quick Claim',
            value: 'Click **"Claim Slot"** button below to instantly claim an available slot. You will be asked for your team name and preferred timing.',
            inline: false
        });
    } else {
        embed.addFields({
            name: '🔴 NO SLOTS AVAILABLE',
            value: 'All slots are currently filled. Press **"Remind Me"** to get notified when slots become available.',
            inline: false
        });
    }

    embed.setFooter({
        text: hasAvailableSlots ?
            'Click "Claim Slot" to instantly join available scrims!' :
            'Check back later or set a reminder for slot openings.'
    })
        .setTimestamp();

    return {
        embed: embed,
        hasAvailableSlots: hasAvailableSlots,
        availableSlots: availableSlots
    };
}

// Send Log to ScrimX-log Channel
async function sendLog(guild, message, type = 'info') {
    try {
        const settings = await GuildSettings.findOne({ guildId: guild.id });
        if (!settings || !settings.logChannel) return;

        const logChannel = guild.channels.cache.get(settings.logChannel);
        if (!logChannel) return;

        const colors = {
            info: 0x0099FF,
            success: 0x00FF00,
            warning: 0xFFA500,
            error: 0xFF0000
        };

        const logEmbed = new EmbedBuilder()
            .setTitle(`📝 ScrimX Log - ${type.toUpperCase()}`)
            .setDescription(message)
            .setColor(colors[type] || 0x0099FF)
            .setTimestamp();

        await logChannel.send({ embeds: [logEmbed] });
    } catch (error) {
        console.error('❌ Error sending log:', error);
    }
}

// Time Parser Function
function parseTime(timeString) {
    const regex = /^(\d+)([hmd])$/;
    const match = timeString.toLowerCase().match(regex);

    if (!match) return null;

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

// Registration Format Validator
function validateRegistrationFormat(message, requiredTags) {
    const lines = message.content.split('\n');
    let teamName = '';
    const players = [];

    for (const line of lines) {
        const lowerLine = line.toLowerCase();

        // Team name check
        if (lowerLine.includes('team name:') || lowerLine.includes('team:')) {
            teamName = line.split(':')[1]?.trim();
        }
        // Player tags check
        else if ((lowerLine.includes('player') || lowerLine.includes('member')) && line.includes('@')) {
            const discordTag = line.match(/<@!?(\d+)>/);
            if (discordTag) {
                players.push(discordTag[0]);
            }
        }
        // Alternative format: IGN: @user
        else if (line.includes('@') && (lowerLine.includes('ign') || lowerLine.includes('player'))) {
            const discordTag = line.match(/<@!?(\d+)>/);
            if (discordTag) {
                players.push(discordTag[0]);
            }
        }
    }

    // Validation checks
    if (!teamName || teamName.length < 2) {
        return { valid: false, error: '❌ Team name is required and should be at least 2 characters long!' };
    }

    if (players.length < requiredTags) {
        return { valid: false, error: `❌ At least ${requiredTags} players are required for registration! Found: ${players.length}` };
    }

    // Remove duplicate players
    const uniquePlayers = [...new Set(players)];

    return {
        valid: true,
        teamName,
        players: uniquePlayers,
        captain: message.author.id
    };
}

// Create Registration Format Embed
function createRegistrationFormatEmbed(scrims, guild) {
    let playerFields = '';
    for (let i = 1; i <= scrims.requiredTags; i++) {
        playerFields += `Player ${i}: @discorduser\n`;
    }

    const formatEmbed = new EmbedBuilder()
        .setTitle('📝 REGISTRATION FORMAT')
        .setDescription(`**Copy-paste the format below and fill your details:**`)
        .setColor(0x0099FF)
        .addFields(
            {
                name: '📋 Required Format',
                value: `\`\`\`\nTeam Name: Your Team Name\n${playerFields}\`\`\``
            },
            {
                name: '✅ What happens next?',
                value: '1. Send your registration in this format\n2. Bot will check your format\n3. If correct, ✅ reaction will be added\n4. Success role will be assigned to YOU ONLY\n5. Slot list will be shown after registration closes'
            },
            {
                name: '⚠️ Important Notes',
                value: `• **Team Name:** Must be unique\n• **Players:** ${scrims.requiredTags} Discord tags required\n• **Success Role:** <@&${scrims.successRole}> (after validation)\n• **Scrims Time:** ${scrims.scrimsTime}\n• **Slots:** ${scrims.totalSlots} total, first come first serve`
            }
        )
        .setFooter({ text: 'Make sure to tag actual Discord users (@username)' })
        .setTimestamp();

    return formatEmbed;
}
// Schedule Daily Scrims Tasks
function scheduleDailyScrimsTasks(scrims) {
    const guild = client.guilds.cache.get(scrims.guildId);
    if (!guild) return;

    const [openHour, openMinute] = scrims.openTime.split(':').map(Number);

    // Schedule details 5 minutes before opening time DAILY
    const detailsMinute = openMinute - 5;
    const detailsHour = detailsMinute < 0 ? openHour - 1 : openHour;
    const adjustedDetailsMinute = detailsMinute < 0 ? detailsMinute + 60 : detailsMinute;

    cron.schedule(`${adjustedDetailsMinute} ${detailsHour} * * *`, async () => {
        try {
            const updatedScrims = await Scrims.findById(scrims._id);
            if (!updatedScrims) return;

            await sendDailyScrimsDetails(updatedScrims, guild);
            console.log(`✅ Daily details sent for: ${scrims.scrimsName}`);
        } catch (error) {
            console.error('❌ Error sending daily details:', error);
        }
    });

    // Schedule registration opening DAILY
    cron.schedule(`${openMinute} ${openHour} * * *`, async () => {
        try {
            const updatedScrims = await Scrims.findById(scrims._id);
            if (!updatedScrims || updatedScrims.status === 'open') return;

            await openRegistration(updatedScrims, guild);
            console.log(`✅ Daily registration opened for: ${scrims.scrimsName}`);
        } catch (error) {
            console.error('❌ Error auto-opening registration:', error);
        }
    });

    console.log(`⏰ Scheduled daily tasks for ${scrims.scrimsName} at ${scrims.openTime}`);
}

// Send Daily Scrims Details (5 minutes before opening)
async function sendDailyScrimsDetails(scrims, guild) {
    try {
        const registrationChannel = guild.channels.cache.get(scrims.registrationChannel);
        if (!registrationChannel) return;

        // Clear previous non-pinned messages (keep only pinned)
        await clearRegistrationChannel(registrationChannel);

        // Send fresh scrims info embed
        const scrimsEmbed = createScrimsEmbed(scrims, guild);
        await registrationChannel.send({
            content: '**🎮 DAILY SCRIMS - REGISTRATION OPENS IN 5 MINUTES!**\n*Channel will unlock at registration time*',
            embeds: [scrimsEmbed]
        });

        // Send registration format embed
        const formatEmbed = createRegistrationFormatEmbed(scrims, guild);
        await registrationChannel.send({ embeds: [formatEmbed] });

        // Update scrims status
        scrims.status = 'scheduled';
        scrims.dailySchedule.detailsSent = true;
        await scrims.save();

        // Send log
        await sendLog(guild,
            `📢 Daily scrims details sent\n**Scrims:** ${scrims.scrimsName}\n**Channel:** <#${scrims.registrationChannel}>\n**Opens at:** ${scrims.openTime}`,
            'info'
        );

    } catch (error) {
        console.error('❌ Error sending daily scrims details:', error);
    }
}

// Clear Registration Channel (keep only pinned messages)
async function clearRegistrationChannel(channel) {
    try {
        // Fetch messages (limit 100)
        const messages = await channel.messages.fetch({ limit: 100 });

        // Filter out pinned messages
        const messagesToDelete = messages.filter(msg => !msg.pinned);

        // Delete in batches
        for (const message of messagesToDelete.values()) {
            await message.delete().catch(() => { }); // Ignore errors for already deleted messages
            // Small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`✅ Cleared ${messagesToDelete.size} messages from ${channel.name}`);
        return messagesToDelete.size;
    } catch (error) {
        console.error('❌ Error clearing registration channel:', error);
        return 0;
    }
}

// Create Slot List Embed with Buttons - IMPROVED FORMAT
async function createSlotListEmbed(scrims, guild) {
    const embed = new EmbedBuilder()
        .setTitle(`Final ${scrims.scrimsName} Slot List`)
        .setColor(0x00FF00)
        .setTimestamp();

    // Get all validated teams sorted by registration time (first come first serve)
    const validatedTeams = scrims.registeredTeams
        .filter(team => team.validated)
        .sort((a, b) => a.registeredAt - b.registeredAt);

    // Get reserved teams that are still active
    const activeReservations = scrims.reservedSlots.filter(r => r.status === 'active');
    const cancelledSlots = scrims.cancelledSlots;

    // Assign slots (first reserved, then validated teams)
    let slotNumber = 1;
    const slotAssignments = [];

    // First assign reserved slots
    for (const reservation of activeReservations) {
        if (reservation.slotNumber <= scrims.totalSlots) {
            slotAssignments.push({
                slotNumber: reservation.slotNumber,
                teamName: reservation.teamName,
                type: 'reserved',
                user: reservation.user
            });
        }
    }

    // Then assign to validated teams (first come first serve)
    for (const team of validatedTeams) {
        // Skip if slot already assigned to this team via reservation
        const hasReservation = activeReservations.find(r =>
            r.teamName === team.teamName || r.user === team.captain
        );

        if (!hasReservation) {
            // Find next available slot
            while (slotAssignments.find(s => s.slotNumber === slotNumber) && slotNumber <= scrims.totalSlots) {
                slotNumber++;
            }

            if (slotNumber <= scrims.totalSlots) {
                // Update team with slot number
                team.slotNumber = slotNumber;
                slotAssignments.push({
                    slotNumber: slotNumber,
                    teamName: team.teamName,
                    type: 'normal',
                    players: team.players,
                    captain: team.captain,
                    registeredAt: team.registeredAt
                });
                slotNumber++;
            }
        }
    }

    // Save updated teams with slot numbers
    await scrims.save();

    // Sort slot assignments by slot number for display
    slotAssignments.sort((a, b) => a.slotNumber - b.slotNumber);

    // FIXED: Create slot list in the format: "Slot 1 - Team Name" - ALL SLOTS WILL SHOW
    let slotListDescription = '';

    for (let i = 1; i <= scrims.totalSlots; i++) {
        const assignment = slotAssignments.find(s => s.slotNumber === i);
        const cancelled = cancelledSlots.find(c => c.slotNumber === i);
        const reservation = activeReservations.find(r => r.slotNumber === i);

        if (cancelled) {
            slotListDescription += `**Slot ${i}** - ❌ CANCELLED (${cancelled.teamName})\n`;
        } else if (assignment) {
            if (assignment.type === 'reserved') {
                slotListDescription += `**Slot ${i}** - ♦️ ${assignment.teamName} (Reserved)\n`;
            } else {
                slotListDescription += `**Slot ${i}** - ${assignment.teamName}\n`;
            }
        } else {
            slotListDescription += `**Slot ${i}** -  EMPTY\n`;
        }
    }

    // Add the slot list to embed description
    embed.setDescription(slotListDescription);

    // Add summary as fields
    const filledSlots = slotAssignments.length - cancelledSlots.length;
    const openSlots = scrims.totalSlots - filledSlots;

    embed.addFields(
        {
            name: '📊 Summary',
            value: `**Total Slots:** ${scrims.totalSlots}\n**Filled Slots:** ${filledSlots}\n**Open Slots:** ${openSlots}\n**Cancelled Slots:** ${cancelledSlots.length}`,
            inline: true
        },
        {
            name: '⏰ Scrims Time',
            value: `**${scrims.scrimsTime}**`,
            inline: true
        }
    );

    // Create buttons
    const buttons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('cancel_slot')
                .setLabel('❌ Cancel Slot')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('transfer_slot')
                .setLabel('🔄 Transfer Slot')
                .setStyle(ButtonStyle.Primary)
        );

    return {
        embed: embed,
        buttons: buttons,
        filledSlots: filledSlots,
        totalSlots: scrims.totalSlots,
        slotAssignments: slotAssignments,
        cancelledSlots: cancelledSlots
    };
}

// Assign Success Role to Captain ONLY
async function assignSuccessRoleToCaptain(scrims, guild, team) {
    try {
        const successRole = guild.roles.cache.get(scrims.successRole);
        if (!successRole) {
            console.log(`❌ Success role not found: ${scrims.successRole}`);
            return false;
        }

        // Assign success role ONLY to the captain
        try {
            const captain = await guild.members.fetch(team.captain);
            if (captain && !captain.roles.cache.has(successRole.id)) {
                await captain.roles.add(successRole);
                console.log(`✅ Assigned success role to captain: ${captain.user.tag}`);

                // Send log
                await sendLog(guild,
                    `🎮 Success role assigned to captain\n**User:** ${captain.user.tag}\n**Team:** ${team.teamName}\n**Scrims:** ${scrims.scrimsName}`,
                    'success'
                );
            }
        } catch (error) {
            console.log(`❌ Could not assign success role to captain ${team.captain}:`, error.message);
        }

        // Mark role as assigned for this team
        team.roleAssigned = true;
        await scrims.save();

        return true;
    } catch (error) {
        console.error('❌ Error assigning success role:', error);
        return false;
    }
}

// Remove Success Role from ALL users (Daily at 5 AM)
async function removeSuccessRoles(guild) {
    try {
        const allScrims = await Scrims.find({ guildId: guild.id });
        const successRoleIds = [...new Set(allScrims.map(scrims => scrims.successRole).filter(Boolean))];

        let totalRemoved = 0;

        for (const roleId of successRoleIds) {
            const role = guild.roles.cache.get(roleId);
            if (!role) continue;

            // Get all members with this role
            const membersWithRole = role.members;

            for (const member of membersWithRole.values()) {
                await member.roles.remove(role);
                totalRemoved++;
            }
        }

        // Send log
        await sendLog(guild,
            `🔄 Daily role cleanup completed\n**Success Roles Removed:** ${totalRemoved} users\n**Time:** 5:00 AM`,
            'info'
        );

        console.log(`✅ Removed success roles from ${totalRemoved} users in ${guild.name}`);
    } catch (error) {
        console.error('❌ Error removing success roles:', error);
        await sendLog(guild,
            `❌ Error in daily role cleanup\n**Error:** ${error.message}`,
            'error'
        );
    }
}

// Check and assign slots ONLY when registration closes
async function finalizeSlotAssignment(scrims, guild) {
    try {
        const slotListData = await createSlotListEmbed(scrims, guild);
        const slotlistChannel = guild.channels.cache.get(scrims.slotlistChannel);

        if (slotlistChannel) {
            // Clear previous slot list messages (but keep other messages)
            const messages = await slotlistChannel.messages.fetch({ limit: 20 });
            const slotListMessages = messages.filter(msg =>
                msg.author.id === client.user.id &&
                msg.embeds.length > 0 &&
                msg.embeds[0].title?.includes('Slot List')
            );

            // Delete only slot list messages, keep other bot messages
            for (const message of slotListMessages.values()) {
                await message.delete().catch(() => { });
            }

            // Send final slot list with buttons
            await slotlistChannel.send({
                content: '**🎯 FINAL SLOT LIST - REGISTRATION COMPLETE!**\n*Use buttons below to manage your slot*',
                embeds: [slotListData.embed],
                components: [slotListData.buttons]
            });

            // Send log
            await sendLog(guild,
                `📊 Final slot list posted\n**Scrims:** ${scrims.scrimsName}\n**Filled Slots:** ${slotListData.filledSlots}/${slotListData.totalSlots}\n**Channel:** <#${scrims.slotlistChannel}>`,
                'success'
            );

            console.log(`✅ Final slot list posted for ${scrims.scrimsName}`);
        }

        return slotListData;
    } catch (error) {
        console.error('❌ Error finalizing slot assignment:', error);
        return null;
    }
}

// Cancel Slot Function - UPDATED Permission Check
async function cancelSlot(scrims, guild, slotNumber, userId, reason = 'User cancelled') {
    try {
        // Find the team in this slot
        const team = scrims.registeredTeams.find(t =>
            t.slotNumber === slotNumber && t.validated
        );

        const reservation = scrims.reservedSlots.find(r =>
            r.slotNumber === slotNumber && r.status === 'active'
        );

        if (!team && !reservation) {
            return { success: false, error: 'No team found in this slot!' };
        }

        const teamName = team ? team.teamName : reservation.teamName;
        const teamCaptain = team ? team.captain : reservation.user;

        // REMOVED SUCCESS ROLE CHECK - Now anyone can cancel their own slot
        // Only check if the user is the captain of the team
        if (teamCaptain !== userId) {
            return { success: false, error: 'You can only cancel your own slot!' };
        }

        // Add to cancelled slots
        scrims.cancelledSlots.push({
            slotNumber: slotNumber,
            teamName: teamName,
            user: teamCaptain,
            reason: reason
        });

        // Remove from registered teams or reserved slots
        if (team) {
            team.slotNumber = null;
        }
        if (reservation) {
            reservation.status = 'cancelled';
        }

        await scrims.save();

        // Update slot list
        await finalizeSlotAssignment(scrims, guild);

        // Send message in registration channel
        const registrationChannel = guild.channels.cache.get(scrims.registrationChannel);
        if (registrationChannel) {
            const cancelEmbed = new EmbedBuilder()
                .setTitle('❌ SLOT CANCELLED')
                .setDescription(`**Slot ${slotNumber} has been cancelled!**`)
                .setColor(0xFF0000)
                .addFields(
                    {
                        name: '📋 Details',
                        value: `**Team:** ${teamName}\n**Slot:** ${slotNumber}\n**Reason:** ${reason}`,
                        inline: false
                    },
                    {
                        name: '🔄 Status',
                        value: 'Slot is now available for other teams',
                        inline: false
                    }
                )
                .setTimestamp();

            await registrationChannel.send({ embeds: [cancelEmbed] });
        }

        // Send log
        await sendLog(guild,
            `❌ Slot cancelled\n**Slot:** ${slotNumber}\n**Team:** ${teamName}\n**User:** <@${userId}>\n**Reason:** ${reason}`,
            'warning'
        );

        return { success: true, teamName: teamName };
    } catch (error) {
        console.error('❌ Error cancelling slot:', error);
        return { success: false, error: error.message };
    }
}

// Close Registration Function (WITHOUT DELETING MESSAGES)
async function closeRegistration(scrims, guild, reason = 'manual') {
    try {
        // Update scrims status
        scrims.status = 'closed';
        await scrims.save();

        const registrationChannel = guild.channels.cache.get(scrims.registrationChannel);

        if (registrationChannel) {
            // Lock the channel - nobody can send messages (BUT KEEP EXISTING MESSAGES)
            await registrationChannel.permissionOverwrites.edit(guild.roles.everyone, {
                SendMessages: false,
                ViewChannel: true,
                ReadMessageHistory: true
            });
            // Send registration closed embed (BUT DON'T DELETE OTHER MESSAGES)
            const closedEmbed = new EmbedBuilder()
                .setTitle('🔒 REGISTRATION CLOSED')
                .setDescription(`**${scrims.scrimsName} registration is now CLOSED!**\n*Channel has been locked*`)
                .setColor(0xFF0000)
                .addFields(
                    {
                        name: '📊 Final Statistics',
                        value: `**Total Teams Registered:** ${scrims.registeredTeams.filter(t => t.validated).length}\n**Total Slots:** ${scrims.totalSlots}\n**Scrims Time:** ${scrims.scrimsTime}`,
                        inline: true
                    },
                    {
                        name: '🎮 Next Steps',
                        value: '• Slot list has been posted in slotlist channel\n• Use buttons to manage your slot\n• Success role holders can cancel/transfer slots',
                        inline: false
                    }
                )
                .setFooter({
                    text: reason === 'auto' ?
                        'Registration closed automatically - All slots filled!' :
                        'Registration closed manually by admin'
                })
                .setTimestamp();

            await registrationChannel.send({ embeds: [closedEmbed] });
        }

        // FINALIZE SLOT ASSIGNMENT AND SHOW SLOT LIST
        await finalizeSlotAssignment(scrims, guild);

        // Send log
        await sendLog(guild,
            `🔒 Registration closed\n**Scrims:** ${scrims.scrimsName}\n**Reason:** ${reason}\n**Teams:** ${scrims.registeredTeams.filter(t => t.validated).length}`,
            'info'
        );

        console.log(`✅ Registration closed for ${scrims.scrimsName} (${reason})`);
    } catch (error) {
        console.error('❌ Error closing registration:', error);
    }
}

// Open Registration Function
async function openRegistration(scrims, guild) {
    try {
        // Update scrims status
        scrims.status = 'open';
        await scrims.save();

        const registrationChannel = guild.channels.cache.get(scrims.registrationChannel);

        if (registrationChannel) {
            // UNLOCK THE CHANNEL - Allow everyone to send messages
            await registrationChannel.permissionOverwrites.edit(guild.roles.everyone, {
                SendMessages: true,
                ViewChannel: true,
                ReadMessageHistory: true
            });

            // Send registration opened embed (BUT DON'T DELETE EXISTING MESSAGES)
            const openEmbed = new EmbedBuilder()
                .setTitle('🔓 REGISTRATION OPENED!')
                .setDescription(`**${scrims.scrimsName} registration is now OPEN!**\n*Channel has been unlocked for registration*`)
                .setColor(0x00FF00)
                .addFields(
                    {
                        name: '📋 Event Details',
                        value: `**Total Slots:** ${scrims.totalSlots}\n**Required Tag:** ${scrims.requiredTags}\n**Scrims Time:** ${scrims.scrimsTime}\n**Registration:** Open to every one`
                    },
                    {
                        name: '📝 How to Register',
                        value: 'Use the format shown below to register your team.\nFirst come first serve basis!'
                    },
                    {
                        name: '⚠️ Important',
                        value: `**Success Role:** Assigned after validation (CAPTAIN ONLY)\n• Slot list shown after registration closes\n• Make sure your format is correct`,
                        inline: false
                    }
                )
                .setFooter({ text: 'Registration opened automatically' })
                .setTimestamp();

            await registrationChannel.send({ embeds: [openEmbed] });

            // Send registration format if not already sent
            const messages = await registrationChannel.messages.fetch({ limit: 10 });
            const formatExists = messages.find(msg =>
                msg.embeds.length > 0 &&
                msg.embeds[0].title === '📝 REGISTRATION FORMAT'
            );

            if (!formatExists) {
                const formatEmbed = createRegistrationFormatEmbed(scrims, guild);
                await registrationChannel.send({ embeds: [formatEmbed] });
            }
        }

        // Send log
        await sendLog(guild,
            `🎮 Registration opened\n**Scrims:** ${scrims.scrimsName}\n**Open Time:** ${scrims.openTime}\n**Scrims Time:** ${scrims.scrimsTime}`,
            'success'
        );

        console.log(`✅ Registration opened for ${scrims.scrimsName}`);
    } catch (error) {
        console.error('❌ Error opening registration:', error);
    }
}

// Check if user has bot admin role
async function hasBotAdminRole(member, scrims) {
    if (!scrims.botAdminRole) return false;
    return member.roles.cache.has(scrims.botAdminRole);
}

// Reservation Expiry Checker
async function checkReservationExpiry() {
    try {
        const now = new Date();
        const scrimsList = await Scrims.find({ 'reservedSlots.status': 'active' });

        for (const scrims of scrimsList) {
            const expiredReservations = scrims.reservedSlots.filter(
                reservation => reservation.status === 'active' && reservation.expiresAt < now
            );

            if (expiredReservations.length > 0) {
                for (const reservation of expiredReservations) {
                    reservation.status = 'expired';
                }
                await scrims.save();

                const guild = client.guilds.cache.get(scrims.guildId);
                if (guild) {
                    await sendLog(guild,
                        `⏰ Reservation expired\n**Scrims:** ${scrims.scrimsName}\n**Expired:** ${expiredReservations.length} reservations`,
                        'warning'
                    );
                }

                console.log(`✅ Cleared ${expiredReservations.length} expired reservations for ${scrims.scrimsName}`);
            }
        }
    } catch (error) {
        console.error('❌ Error checking reservation expiry:', error);
    }
}

// Scrims Embed Creator with Reservations
function createScrimsEmbed(scrims, guild) {
    const activeReservations = scrims.reservedSlots.filter(r => r.status === 'active');

    const embed = new EmbedBuilder()
        .setTitle(`🎮 ${scrims.scrimsName || 'SCRIMS EVENT'}`)
        .setDescription(`**Registration will open at ${scrims.openTime}**`)
        .setColor(0x0099FF)
        .addFields(
            {
                name: '📝 Server Details',
                value: `**Server:** ${guild.name}\n**Total Slots:** ${scrims.totalSlots}\n**Required Tags:** ${scrims.requiredTags}\n**Scrims Time:** ${scrims.scrimsTime}`,
                inline: true
            },
            {
                name: '⏰ Registration Time',
                value: `**Open Time:** ${scrims.openTime}\n**Status:** ${scrims.status.toUpperCase()}`,
                inline: true
            },
            {
                name: '👥 Role Information',
                value: `**Success Role:** <@&${scrims.successRole}> (after validation)\n**Channel:** <#${scrims.registrationChannel}>`,
                inline: false
            }
        );

    if (activeReservations.length > 0) {
        embed.addFields({
            name: '📌 Pre-Reserved Slots',
            value: `**${activeReservations.length} slots** are pre-reserved\nUse \`/show-reservations\` to see details`,
            inline: false
        });
    }

    embed.setFooter({ text: `Scrims ID: ${scrims._id} | Created at` })
        .setTimestamp(scrims.createdAt);

    return embed;
}

// Show Reservations Embed
function createReservationsEmbed(scrims, guild) {
    const activeReservations = scrims.reservedSlots.filter(r => r.status === 'active');

    if (activeReservations.length === 0) {
        return new EmbedBuilder()
            .setTitle('📌 Slot Reservations')
            .setDescription('**No active reservations found!**')
            .setColor(0xFFA500)
            .addFields({
                name: 'ℹ️ Information',
                value: 'Use `/reserve-team` to reserve slots for teams before registration opens.'
            })
            .setTimestamp();
    }

    const embed = new EmbedBuilder()
        .setTitle('📌 PRE-RESERVED SLOTS')
        .setDescription(`**${activeReservations.length} slots reserved for ${scrims.scrimsName}**`)
        .setColor(0xFFA500);

    activeReservations.forEach(reservation => {
        const timeLeft = moment(reservation.expiresAt).fromNow();
        embed.addFields({
            name: `Slot ${reservation.slotNumber} - ${reservation.teamName}`,
            value: `**User:** <@${reservation.user}>\n**Expires:** ${timeLeft}\n**Reserved:** <t:${Math.floor(reservation.reservedAt.getTime() / 1000)}:R>`,
            inline: true
        });
    });

    embed.setFooter({ text: 'These slots will be automatically assigned to reserved teams' })
        .setTimestamp();

    return embed;
}

// Schedule Scrims Opening
function scheduleScrimsOpening(scrims) {
    const [hours, minutes] = scrims.openTime.split(':');

    cron.schedule(`${minutes} ${hours} * * *`, async () => {
        try {
            const updatedScrims = await Scrims.findById(scrims._id);
            if (!updatedScrims || updatedScrims.status !== 'scheduled') return;

            const guild = client.guilds.cache.get(scrims.guildId);
            if (!guild) return;

            await openRegistration(updatedScrims, guild);

            console.log(`✅ Auto-opened registration for: ${scrims.scrimsName}`);
        } catch (error) {
            console.error('❌ Error auto-opening registration:', error);
        }
    });

    console.log(`⏰ Scheduled scrims opening for ${scrims.openTime}`);
}

// Bot Ready Event (Updated with reminder checking)
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online!`);
    console.log(`🏠 Connected to ${client.guilds.cache.size} servers`);

    // Ensure bot has send message permissions in all registration channels
    for (const guild of client.guilds.cache.values()) {
        try {
            const guildScrims = await Scrims.find({ guildId: guild.id });
            for (const scrims of guildScrims) {
                const registrationChannel = guild.channels.cache.get(scrims.registrationChannel);
                if (registrationChannel) {
                    await registrationChannel.permissionOverwrites.edit(client.user.id, {
                        SendMessages: true,
                        ViewChannel: true,
                        ReadMessageHistory: true
                    });
                }
            }
        } catch (error) {
            console.error(`❌ Error setting bot permissions in ${guild.name}:`, error);
        }
    }

    client.user.setPresence({
        activities: [{ name: 'BGMI Scrims | /setup', type: ActivityType.Watching }],
        status: 'online'
    });

    await registerSlashCommands();

    // Restore scheduled scrims with DAILY scheduling
    try {
        const allScrims = await Scrims.find({});
        allScrims.forEach(scrims => {
            scheduleDailyScrimsTasks(scrims);
        });
        console.log(`✅ Restored ${allScrims.length} scrims with daily scheduling`);
    } catch (error) {
        console.error('❌ Error restoring scheduled scrims:', error);
    }

    // Start reservation expiry checker (every 5 minutes)
    cron.schedule('*/5 * * * *', () => {
        checkReservationExpiry();
    });

    // Daily cleanup at 5 AM - SUCCESS ROLE REMOVAL + CHANNEL CLEARING
    cron.schedule('0 5 * * *', async () => {
        console.log('🔄 Starting daily cleanup at 5 AM...');

        for (const guild of client.guilds.cache.values()) {
            try {
                // Remove success roles
                await removeSuccessRoles(guild);

                // Clear all registration channels for this guild
                const guildScrims = await Scrims.find({ guildId: guild.id });

                for (const scrims of guildScrims) {
                    const registrationChannel = guild.channels.cache.get(scrims.registrationChannel);
                    if (registrationChannel) {
                        const deletedCount = await clearRegistrationChannel(registrationChannel);
                        // LOCK THE CHANNEL for daily reset
                        await registrationChannel.permissionOverwrites.edit(guild.roles.everyone, {
                            SendMessages: false,
                            ViewChannel: true,
                            ReadMessageHistory: true
                        });

                        console.log(`✅ Cleared ${deletedCount} messages and LOCKED ${registrationChannel.name}`);
                        // Reset scrims status for next day
                        scrims.status = 'scheduled';
                        scrims.registeredTeams = [];
                        scrims.dailySchedule.lastReset = new Date();
                        await scrims.save();
                    }
                }

                await sendLog(guild,
                    `🔄 Daily 5 AM cleanup completed\n**Success Roles:** Removed\n**Channels:** Cleared all registration channels\n**Scrims Status:** Reset for new day`,
                    'info'
                );

            } catch (error) {
                console.error(`❌ Error in daily cleanup for ${guild.name}:`, error);
            }
        }

        console.log('✅ Daily 5 AM cleanup completed for all guilds');
    });

    // NEW: Check for slot reminders every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
        console.log('🔔 Checking for slot reminders...');
        for (const guild of client.guilds.cache.values()) {
            await checkAndSendReminders(guild);
        }
    });

    await registerSlashCommands();

    // Restore scheduled scrims with DAILY scheduling
    try {
        const allScrims = await Scrims.find({});
        allScrims.forEach(scrims => {
            scheduleDailyScrimsTasks(scrims);
        });
        console.log(`✅ Restored ${allScrims.length} scrims with daily scheduling`);
    } catch (error) {
        console.error('❌ Error restoring scheduled scrims:', error);
    }

    // Start reservation expiry checker (every 5 minutes)
    cron.schedule('*/5 * * * *', () => {
        checkReservationExpiry();
    });

    // Daily cleanup at 5 AM - SUCCESS ROLE REMOVAL + CHANNEL CLEARING
    cron.schedule('0 5 * * *', async () => {
        console.log('🔄 Starting daily cleanup at 5 AM...');

        for (const guild of client.guilds.cache.values()) {
            try {
                // Remove success roles
                await removeSuccessRoles(guild);

                // Clear all registration channels for this guild
                const guildScrims = await Scrims.find({ guildId: guild.id });

                for (const scrims of guildScrims) {
                    const registrationChannel = guild.channels.cache.get(scrims.registrationChannel);
                    if (registrationChannel) {
                        const deletedCount = await clearRegistrationChannel(registrationChannel);
                        console.log(`✅ Cleared ${deletedCount} messages from ${registrationChannel.name}`);

                        // Reset scrims status for next day
                        scrims.status = 'scheduled';
                        scrims.registeredTeams = [];
                        scrims.dailySchedule.lastReset = new Date();
                        await scrims.save();
                    }
                }

                await sendLog(guild,
                    `🔄 Daily 5 AM cleanup completed\n**Success Roles:** Removed\n**Channels:** Cleared all registration channels\n**Scrims Status:** Reset for new day`,
                    'info'
                );

            } catch (error) {
                console.error(`❌ Error in daily cleanup for ${guild.name}:`, error);
            }
        }

        console.log('✅ Daily 5 AM cleanup completed for all guilds');
    });
});

// Message Create Event - Registration Handler
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.guild) return;

    try {
        // Check if message is in any scrims registration channel
        const scrims = await Scrims.findOne({
            guildId: message.guild.id,
            registrationChannel: message.channel.id,
            status: 'open'
        });

        if (!scrims) return;

        // Validate registration format
        const validation = validateRegistrationFormat(message, scrims.requiredTags);

        if (!validation.valid) {
            // Send error message that will auto-delete
            const errorMsg = await message.reply({
                content: validation.error,
                allowedMentions: { repliedUser: false }
            });

            // Delete error message after 10 seconds
            setTimeout(() => {
                errorMsg.delete().catch(() => { });
            }, 10000);

            return;
        }

        // Check if team name already exists
        const existingTeam = scrims.registeredTeams.find(
            team => team.teamName.toLowerCase() === validation.teamName.toLowerCase()
        );

        if (existingTeam) {
            const errorMsg = await message.reply({
                content: '❌ Team name already exists! Please choose a different name.',
                allowedMentions: { repliedUser: false }
            });

            setTimeout(() => {
                errorMsg.delete().catch(() => { });
            }, 10000);
            return;
        }

        // Check if player is already in another team
        for (const playerTag of validation.players) {
            const playerId = playerTag.match(/<@!?(\d+)>/)?.[1];
            if (playerId) {
                const playerInTeam = scrims.registeredTeams.find(team =>
                    team.players.includes(playerId)
                );
                if (playerInTeam) {
                    const errorMsg = await message.reply({
                        content: `❌ ${playerTag} is already registered in team **${playerInTeam.teamName}**!`,
                        allowedMentions: { repliedUser: false }
                    });

                    setTimeout(() => {
                        errorMsg.delete().catch(() => { });
                    }, 10000);
                    return;
                }
            }
        }

        // Add tick reaction to valid registration
        await message.react('✅');

        // Save team to database
        const newTeam = {
            teamName: validation.teamName,
            players: validation.players.map(tag => tag.match(/<@!?(\d+)>/)?.[1] || tag),
            captain: validation.captain,
            messageId: message.id,
            validated: true,
            roleAssigned: false
        };

        scrims.registeredTeams.push(newTeam);
        await scrims.save();

        // Assign SUCCESS ROLE to the CAPTAIN ONLY
        await assignSuccessRoleToCaptain(scrims, message.guild, newTeam);

        // Send success message that will auto-delete
        const successMsg = await message.reply({
            content: `✅ **${validation.teamName}** registered successfully!\n📝 Format correct | 🎮 Success role assigned to CAPTAIN`,
            allowedMentions: { repliedUser: false }
        });

        setTimeout(() => {
            successMsg.delete().catch(() => { });
        }, 5000);

        // Check if all slots are filled for auto-close
        const validatedTeams = scrims.registeredTeams.filter(team => team.validated);
        const activeReservations = scrims.reservedSlots.filter(r => r.status === 'active');
        const totalFilled = validatedTeams.length + activeReservations.length;

        if (totalFilled >= scrims.totalSlots) {
            await closeRegistration(scrims, message.guild, 'auto');
        }

    } catch (error) {
        console.error('❌ Registration message error:', error);
    }
});

// Button Interaction Handler (Updated with new buttons)
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;

    try {
        const { customId, user, guild, channel, message } = interaction;

        // Handle public slot management buttons first
        if (customId === 'cancel_slot_public' || customId === 'claim_slot' || customId === 'set_reminder') {
            switch (customId) {
                case 'cancel_slot_public':
                    // Find user's slots across all scrims
                    const allScrims = await Scrims.find({ guildId: guild.id });
                    const userTeams = [];
                    const userReservations = [];

                    // Find user's slots across all scrims
                    for (const scrims of allScrims) {
                        const userTeam = scrims.registeredTeams.find(team =>
                            team.captain === user.id && team.validated && team.slotNumber
                        );
                        if (userTeam) {
                            userTeams.push({ scrims, team: userTeam });
                        }

                        const userReservation = scrims.reservedSlots.find(reservation =>
                            reservation.user === user.id && reservation.status === 'active'
                        );
                        if (userReservation) {
                            userReservations.push({ scrims, reservation: userReservation });
                        }
                    }

                    if (userTeams.length === 0 && userReservations.length === 0) {
                        return interaction.reply({
                            content: '❌ You don\'t have any registered slot to cancel!',
                            ephemeral: true
                        });
                    }

                    // For simplicity, cancel the first found slot
                    const slotToCancel = userTeams[0] ? userTeams[0].team.slotNumber : userReservations[0].reservation.slotNumber;
                    const scrimsToCancel = userTeams[0] ? userTeams[0].scrims : userReservations[0].scrims;
                    const teamName = userTeams[0] ? userTeams[0].team.teamName : userReservations[0].reservation.teamName;

                    const result = await cancelSlot(scrimsToCancel, guild, slotToCancel, user.id, 'User cancelled via slot management');

                    if (result.success) {
                        await interaction.reply({
                            content: `✅ Your slot ${slotToCancel} (Team: **${teamName}**) has been cancelled successfully!`,
                            ephemeral: true
                        });

                        // Update the slot management message
                        await updateSlotManagementMessage(message);

                        // Check for reminders
                        await checkAndSendReminders(guild);
                    } else {
                        await interaction.reply({
                            content: `❌ Error cancelling slot: ${result.error}`,
                            ephemeral: true
                        });
                    }
                    break;

                case 'claim_slot':
                    // Get available slots
                    const slotData = await createCancelClaimEmbed(guild);

                    if (!slotData.hasAvailableSlots) {
                        return interaction.reply({
                            content: '❌ No slots available for claiming at the moment!',
                            ephemeral: true
                        });
                    }
                    // Create dropdown menu for scrims selection
                    const scrimsSelectMenu = new StringSelectMenuBuilder()
                        .setCustomId('select_scrims_for_claim')
                        .setPlaceholder('🎯 Select a scrims to claim slot')
                        .setMinValues(1)
                        .setMaxValues(1);

                    // Add options for each available scrims
                    slotData.availableSlots.forEach((scrims, index) => {
                        scrimsSelectMenu.addOptions({
                            label: `${scrims.scrimsName} (${scrims.openSlots} slots)`,
                            description: `Time: ${scrims.scrimsTime} | Channel: #${guild.channels.cache.get(scrims.registrationChannel)?.name || 'Unknown'}`.substring(0, 50),
                            value: scrims.scrimsId.toString(),
                            emoji: '🎮'
                        });
                    });

                    const selectRow = new ActionRowBuilder().addComponents(scrimsSelectMenu);

                    const selectEmbed = new EmbedBuilder()
                        .setTitle('🎯 SELECT SCRIMS FOR SLOT CLAIMING')
                        .setDescription('Choose which scrims you want to join from the dropdown below:')
                        .setColor(0x0099FF)
                        .addFields(
                            {
                                name: '📋 Available Scrims',
                                value: slotData.availableSlots.map((scrims, index) =>
                                    `**${index + 1}. ${scrims.scrimsName}**\n` +
                                    `   • Available: ${scrims.openSlots} slots\n` +
                                    `   • Time: ${scrims.scrimsTime}\n` +
                                    `   • Channel: <#${scrims.registrationChannel}>`
                                ).join('\n\n'),
                                inline: false
                            }
                        )
                        .setFooter({ text: 'Select one scrims to proceed' })
                        .setTimestamp();

                    await interaction.reply({
                        embeds: [selectEmbed],
                        components: [selectRow],
                        ephemeral: true
                    });
                    break;

                case 'set_reminder':
                    const reminderResult = await setSlotReminder(user, guild);
                    await interaction.reply({
                        content: reminderResult.message,
                        ephemeral: true
                    });
                    break;
            }
            return; // Exit after handling public buttons
        }

        // Original slotlist channel button handling
        // Find scrims by slotlist channel
        const scrims = await Scrims.findOne({
            guildId: guild.id,
            slotlistChannel: channel.id
        });

        if (!scrims) {
            await interaction.reply({
                content: '❌ This button is not associated with any active scrims!',
                ephemeral: true
            });
            return;
        }

        if (customId === 'cancel_slot') {
            // Find user's slot and cancel it
            const userTeams = scrims.registeredTeams.filter(team =>
                team.captain === user.id && team.validated && team.slotNumber
            );

            const userReservations = scrims.reservedSlots.filter(reservation =>
                reservation.user === user.id && reservation.status === 'active'
            );

            if (userTeams.length === 0 && userReservations.length === 0) {
                await interaction.reply({
                    content: '❌ You don\'t have any registered slot to cancel!',
                    ephemeral: true
                });
                return;
            }

            // For simplicity, cancel the first found slot
            const slotToCancel = userTeams[0] ? userTeams[0].slotNumber : userReservations[0].slotNumber;

            const result = await cancelSlot(scrims, guild, slotToCancel, user.id, 'User requested cancellation');

            if (result.success) {
                await interaction.reply({
                    content: `✅ Your slot ${slotToCancel} (Team: **${result.teamName}**) has been cancelled successfully!`,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: `❌ Error cancelling slot: ${result.error}`,
                    ephemeral: true
                });
            }
        }

        else if (customId === 'transfer_slot') {
            await interaction.reply({
                content: '🔄 Slot transfer feature coming soon!',
                ephemeral: true
            });
        }

    } catch (error) {
        console.error('❌ Button interaction error:', error);
        await interaction.reply({
            content: '❌ An error occurred while processing your request!',
            ephemeral: true
        });
    }
});

// Select Menu Interaction Handler - NEW for Scrims Selection
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isStringSelectMenu()) return;

    try {
        const { customId, values, guild, user } = interaction;

        if (customId === 'select_scrims_for_claim') {
            const selectedScrimsId = values[0];

            // Find the selected scrims
            const selectedScrims = await Scrims.findById(selectedScrimsId);

            if (!selectedScrims) {
                return interaction.reply({
                    content: '❌ Selected scrims not found! Please try again.',
                    ephemeral: true
                });
            }

            // Check if slots are still available
            const availableSlots = await getAvailableSlots(guild);
            const currentScrimsSlots = availableSlots.find(slot => slot.scrimsId.toString() === selectedScrimsId);

            if (!currentScrimsSlots || currentScrimsSlots.openSlots === 0) {
                return interaction.reply({
                    content: '❌ No slots available in this scrims anymore! Please select another one.',
                    ephemeral: true
                });
            }

            // Create modal for slot claiming with selected scrims info
            const modal = new ModalBuilder()
                .setCustomId(`claim_modal_${selectedScrimsId}`)
                .setTitle(`🎯 Claim Slot - ${selectedScrims.scrimsName}`);

            // Team Name Input
            const teamNameInput = new TextInputBuilder()
                .setCustomId('team_name')
                .setLabel('Team Name')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(50)
                .setPlaceholder('Enter your team name');

            // Required Players Info
            const playersInfo = new TextInputBuilder()
                .setCustomId('players_info')
                .setLabel(`Players Required: ${selectedScrims.requiredTags}`)
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(500)
                .setPlaceholder(`You need ${selectedScrims.requiredTags} players. List them later in registration channel.`)
                .setValue(`Note: This scrims requires ${selectedScrims.requiredTags} players per team. You can add player tags after claiming the slot.`);

            // Create action rows
            const firstActionRow = new ActionRowBuilder().addComponents(teamNameInput);
            const secondActionRow = new ActionRowBuilder().addComponents(playersInfo);

            // Add components to modal
            modal.addComponents(firstActionRow, secondActionRow);

            // Show the modal
            await interaction.showModal(modal);
        }
    } catch (error) {
        console.error('❌ Select menu interaction error:', error);
        await interaction.reply({
            content: '❌ An error occurred while processing your selection!',
            ephemeral: true
        });
    }
});

// Modal Interaction Handler - FIXED for Slot Claiming
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isModalSubmit()) return;

    try {
        const { customId, fields, guild, user } = interaction;

        // Check if it's a claim modal from the select menu
        if (customId.startsWith('claim_modal_')) {
            await interaction.deferReply({ ephemeral: true });

            const teamName = fields.getTextInputValue('team_name');
            const selectedScrimsId = customId.replace('claim_modal_', '');

            console.log(`🔍 Modal submitted for scrims: ${selectedScrimsId}, team: ${teamName}`);

            // Find the selected scrims
            const targetScrims = await Scrims.findById(selectedScrimsId);

            if (!targetScrims) {
                console.log('❌ Scrims not found with ID:', selectedScrimsId);
                return interaction.editReply({
                    content: '❌ Scrims not found! Please try again.',
                });
            }

            // Check if team name already exists
            const existingTeam = targetScrims.registeredTeams.find(
                team => team.teamName.toLowerCase() === teamName.toLowerCase()
            );

            if (existingTeam) {
                return interaction.editReply({
                    content: '❌ Team name already exists! Please choose a different name.',
                });
            }

            // Find next available slot number
            const slotNumber = await findNextAvailableSlot(targetScrims);

            if (!slotNumber) {
                return interaction.editReply({
                    content: '❌ No available slots found! Please try again later.',
                });
            }

            // Create and save the team
            const newTeam = {
                teamName: teamName,
                players: [user.id], // Captain is the user who claimed
                captain: user.id,
                registeredAt: new Date(),
                slotNumber: slotNumber,
                validated: true,
                roleAssigned: false
            };

            console.log(`✅ Creating new team: ${teamName} in slot ${slotNumber}`);

            targetScrims.registeredTeams.push(newTeam);
            await targetScrims.save();

            // Assign success role to captain
            const roleAssigned = await assignSuccessRoleToCaptain(targetScrims, guild, newTeam);
            if (!roleAssigned) {
                console.log('⚠️ Could not assign success role, but continuing...');
            }

            // Update slot list
            await finalizeSlotAssignment(targetScrims, guild);

            // Send confirmation in registration channel
            const registrationChannel = guild.channels.cache.get(targetScrims.registrationChannel);
            if (registrationChannel) {
                const claimSuccessEmbed = new EmbedBuilder()
                    .setTitle('🎯 SLOT CLAIMED SUCCESSFULLY!')
                    .setDescription(`**Slot ${slotNumber} has been claimed!**`)
                    .setColor(0x00FF00)
                    .addFields(
                        {
                            name: '📋 Team Details',
                            value: `**Team:** ${teamName}\n**Slot:** ${slotNumber}\n**Captain:** <@${user.id}>`,
                            inline: false
                        },
                        {
                            name: '🎮 Scrims Info',
                            value: `**Scrims:** ${targetScrims.scrimsName}\n**Time:** ${targetScrims.scrimsTime}\n**Total Players:** ${targetScrims.requiredTags}`,
                            inline: false
                        }
                    )
                    .setFooter({ text: 'Slot claimed via Slot Management System' })
                    .setTimestamp();

                await registrationChannel.send({
                    content: `🎉 **NEW SLOT CLAIMED!** <@${user.id}> has claimed Slot ${slotNumber} for team **${teamName}**`,
                    embeds: [claimSuccessEmbed]
                });
            }

            // Check and send reminders to other users
            await checkAndSendReminders(guild);

            await interaction.editReply({
                content: `✅ **Slot ${slotNumber} claimed successfully!**\n**Team:** ${teamName}\n**Scrims:** ${targetScrims.scrimsName}\n**Channel:** <#${targetScrims.registrationChannel}>\n\nAdd ${targetScrims.requiredTags - 1} more players to complete your team.`,
            });

            await sendLog(guild,
                `🎯 Slot claimed via management\n**Scrims:** ${targetScrims.scrimsName}\n**Slot:** ${slotNumber}\n**Team:** ${teamName}\n**User:** ${user.tag}\n**Channel:** <#${targetScrims.registrationChannel}>`,
                'success'
            );

            console.log(`✅ Slot claim completed successfully for ${teamName}`);
        }
    } catch (error) {
        console.error('❌ Modal interaction error:', error);

        // Detailed error logging
        console.error('Error details:', {
            customId: interaction.customId,
            user: user?.tag,
            guild: guild?.name,
            errorMessage: error.message,
            errorStack: error.stack
        });

        if (interaction.deferred) {
            await interaction.editReply({
                content: `❌ An error occurred while processing your claim: ${error.message}`,
            });
        } else {
            await interaction.reply({
                content: `❌ An error occurred while processing your claim: ${error.message}`,
                ephemeral: true
            });
        }
    }
});

// Function to update slot management message
async function updateSlotManagementMessage(message) {
    try {
        const newSlotData = await createCancelClaimEmbed(message.guild);

        const buttonsRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('cancel_slot_public')
                    .setLabel('❌ Cancel Slot')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('claim_slot')
                    .setLabel('🎯 Claim Slot')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(!newSlotData.hasAvailableSlots), // Disable if no slots available
                new ButtonBuilder()
                    .setCustomId('set_reminder')
                    .setLabel('🔔 Remind Me')
                    .setStyle(ButtonStyle.Primary)
            );

        await message.edit({
            embeds: [newSlotData.embed],
            components: [buttonsRow]
        });
    } catch (error) {
        console.error('❌ Error updating slot management message:', error);
    }
}

// Find Next Available Slot Number - UPDATED (Includes Cancelled Slots)
async function findNextAvailableSlot(scrims) {
    try {
        const validatedTeams = scrims.registeredTeams.filter(team => team.validated);
        const activeReservations = scrims.reservedSlots.filter(r => r.status === 'active');
        const cancelledSlots = scrims.cancelledSlots;

        // Get all assigned slot numbers
        const assignedSlots = [
            ...validatedTeams.map(team => team.slotNumber),
            ...activeReservations.map(reservation => reservation.slotNumber)
        ].filter(slot => slot !== null && slot !== undefined);

        // Get cancelled slot numbers (THESE ARE AVAILABLE FOR CLAIMING)
        const cancelledSlotNumbers = cancelledSlots.map(cancelled => cancelled.slotNumber);

        // Priority: First assign cancelled slots, then find empty slots
        // 1. Check cancelled slots first (they become available immediately)
        for (const cancelledSlot of cancelledSlotNumbers) {
            if (!assignedSlots.includes(cancelledSlot) && cancelledSlot <= scrims.totalSlots) {
                // Remove this slot from cancelled slots since it's being claimed
                const cancelledIndex = scrims.cancelledSlots.findIndex(c => c.slotNumber === cancelledSlot);
                if (cancelledIndex !== -1) {
                    scrims.cancelledSlots.splice(cancelledIndex, 1);
                    await scrims.save();
                }
                return cancelledSlot;
            }
        }

        // 2. If no cancelled slots, find the first available slot (1 to totalSlots)
        for (let slot = 1; slot <= scrims.totalSlots; slot++) {
            if (!assignedSlots.includes(slot)) {
                return slot;
            }
        }

        return null; // No available slot found
    } catch (error) {
        console.error('❌ Error finding available slot:', error);
        return null;
    }
}

// PREFIX COMMANDS HANDLER - "X" prefix
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content.startsWith('X')) return;

    // Check if user has "Use Application Commands" permission
    if (!message.member.permissions.has(PermissionsBitField.Flags.UseApplicationCommands)) {
        const permissionEmbed = new EmbedBuilder()
            .setTitle('❌ PERMISSION DENIED')
            .setDescription('You need **"Use Application Commands"** permission to use bot commands!')
            .setColor(0xFF0000)
            .addFields({
                name: '🔧 Required Permission',
                value: '• **Use Application Commands** - This permission allows you to interact with bot commands',
                inline: false
            })
            .setFooter({ text: 'Contact server administrator to get this permission' })
            .setTimestamp();

        return message.reply({
            embeds: [permissionEmbed],
            allowedMentions: { repliedUser: false }
        }).then(msg => {
            setTimeout(() => msg.delete(), 10000);
        });
    }

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    try {
        switch (command) {
            case 'lock':
                // Check if user has Manage Channels permission
                if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
                    return message.reply({
                        content: '❌ You need **Manage Channels** permission to use this command!',
                        allowedMentions: { repliedUser: false }
                    }).then(msg => {
                        setTimeout(() => msg.delete(), 5000);
                    });
                }

                // Lock the current channel
                await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
                    SendMessages: false
                });

                const lockEmbed = new EmbedBuilder()
                    .setTitle('🔒 CHANNEL LOCKED')
                    .setDescription(`This channel has been locked by ${message.author}`)
                    .setColor(0xFF0000)
                    .setTimestamp();

                await message.reply({ embeds: [lockEmbed] });
                break;

            case 'bot_admin_role':
                // Check if user has Administrator permission or bot admin role
                const guildSettings = await GuildSettings.findOne({ guildId: message.guild.id });

                if (!guildSettings || !guildSettings.botAdminRole) {
                    const errorEmbed = new EmbedBuilder()
                        .setTitle('❌ BOT ADMIN ROLE NOT SET')
                        .setDescription('Bot admin role is not configured for this server!')
                        .setColor(0xFF0000)
                        .addFields({
                            name: '🔧 Setup Required',
                            value: 'Use `/setup` command to configure the bot admin role first.',
                            inline: false
                        })
                        .setFooter({ text: 'Contact server administrator' })
                        .setTimestamp();

                    return message.reply({ embeds: [errorEmbed] });
                }

                const botAdminRole = message.guild.roles.cache.get(guildSettings.botAdminRole);

                if (!botAdminRole) {
                    const errorEmbed = new EmbedBuilder()
                        .setTitle('❌ ROLE NOT FOUND')
                        .setDescription('The configured bot admin role was not found in this server!')
                        .setColor(0xFF0000)
                        .addFields({
                            name: '🔄 Re-setup Required',
                            value: 'The role might have been deleted. Use `/setup` again to reconfigure.',
                            inline: false
                        })
                        .setFooter({ text: 'Contact server administrator' })
                        .setTimestamp();

                    return message.reply({ embeds: [errorEmbed] });
                }

                // Get all members with bot admin role
                const membersWithRole = botAdminRole.members;
                const memberList = membersWithRole.size > 0
                    ? membersWithRole.map(member => `<@${member.user.id}>`).join(', ')
                    : 'No members have this role';

                const roleEmbed = new EmbedBuilder()
                    .setTitle('🛠️ BOT ADMIN ROLE INFORMATION')
                    .setDescription(`**Current Bot Admin Role for ${message.guild.name}**`)
                    .setColor(0x0099FF)
                    .addFields(
                        {
                            name: '🎯 Role Details',
                            value: `**Role:** <@&${botAdminRole.id}>\n**ID:** \`${botAdminRole.id}\`\n**Color:** \`${botAdminRole.hexColor}\`\n**Members:** ${membersWithRole.size}`,
                            inline: false
                        },
                        {
                            name: '👥 Role Members',
                            value: memberList.length > 1024 ? 'Too many members to display' : memberList,
                            inline: false
                        },
                        {
                            name: '📋 Permissions',
                            value: 'This role can use:\n• `/create-scrims`\n• `/delete-scrims`\n• `/cancel-claim-slot`\n• All other admin scrims commands',
                            inline: false
                        }
                    )
                    .setFooter({
                        text: `Requested by ${message.author.tag} | Server: ${message.guild.name}`,
                        iconURL: message.author.displayAvatarURL()
                    })
                    .setTimestamp();

                await message.reply({ embeds: [roleEmbed] });
                break;

            case 'unlock':
                // Check if user has Manage Channels permission
                if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
                    return message.reply({
                        content: '❌ You need **Manage Channels** permission to use this command!',
                        allowedMentions: { repliedUser: false }
                    }).then(msg => {
                        setTimeout(() => msg.delete(), 5000);
                    });
                }

                // Unlock the current channel
                await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
                    SendMessages: null // Reset to default
                });

                const unlockEmbed = new EmbedBuilder()
                    .setTitle('🔓 CHANNEL UNLOCKED')
                    .setDescription(`This channel has been unlocked by ${message.author}`)
                    .setColor(0x00FF00)
                    .setTimestamp();

                await message.reply({ embeds: [unlockEmbed] });
                break;

            case 'addrole':
                // Check if user has Manage Roles permission
                if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                    return message.reply({
                        content: '❌ You need **Manage Roles** permission to use this command!',
                        allowedMentions: { repliedUser: false }
                    }).then(msg => {
                        setTimeout(() => msg.delete(), 5000);
                    });
                }

                // Check if role and users are mentioned
                const role = message.mentions.roles.first();
                const users = message.mentions.users;

                if (!role) {
                    return message.reply({
                        content: '❌ Please mention a role to add! Example: `X addrole @Role @user1 @user2`',
                        allowedMentions: { repliedUser: false }
                    }).then(msg => {
                        setTimeout(() => msg.delete(), 5000);
                    });
                }

                if (users.size === 0) {
                    return message.reply({
                        content: '❌ Please mention users to add the role to! Example: `X addrole @Role @user1 @user2`',
                        allowedMentions: { repliedUser: false }
                    }).then(msg => {
                        setTimeout(() => msg.delete(), 5000);
                    });
                }

                // Check if bot has permission to manage this role
                const botMember = await message.guild.members.fetch(client.user.id);
                if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles) ||
                    message.guild.roles.highest.comparePositionTo(role) <= 0) {
                    return message.reply({
                        content: `❌ I don't have permission to manage the ${role} role!`,
                        allowedMentions: { repliedUser: false }
                    }).then(msg => {
                        setTimeout(() => msg.delete(), 5000);
                    });
                }

                // Add role to all mentioned users
                let successCount = 0;
                let failedCount = 0;

                for (const [userId, user] of users) {
                    try {
                        const member = await message.guild.members.fetch(userId);
                        if (!member.roles.cache.has(role.id)) {
                            await member.roles.add(role);
                            successCount++;
                        }
                    } catch (error) {
                        failedCount++;
                        console.error(`Failed to add role to ${user.tag}:`, error);
                    }
                }

                const addroleEmbed = new EmbedBuilder()
                    .setTitle('🎯 ROLE ADDED')
                    .setDescription(`Added **${role.name}** role to ${successCount} users`)
                    .setColor(0x00FF00)
                    .addFields(
                        {
                            name: '✅ Success',
                            value: `${successCount} users`,
                            inline: true
                        },
                        {
                            name: '❌ Failed',
                            value: `${failedCount} users`,
                            inline: true
                        }
                    )
                    .setFooter({ text: `Executed by ${message.author.tag}` })
                    .setTimestamp();

                await message.reply({ embeds: [addroleEmbed] });
                break;

            case 'purge':
                // Check if user has Manage Messages permission
                if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                    return message.reply({
                        content: '❌ You need **Manage Messages** permission to use this command!',
                        allowedMentions: { repliedUser: false }
                    }).then(msg => {
                        setTimeout(() => msg.delete(), 5000);
                    });
                }

                // Check if bot has Manage Messages permission
                if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                    return message.reply({
                        content: '❌ I need **Manage Messages** permission to delete messages!',
                        allowedMentions: { repliedUser: false }
                    }).then(msg => {
                        setTimeout(() => msg.delete(), 5000);
                    });
                }

                const mentionedUsers = message.mentions.users;
                const numberArg = args.find(arg => !isNaN(parseInt(arg)) && !arg.startsWith('<'));

                // Case 1: Number specified (X purge 10, X purge 14, etc.)
                if (numberArg && mentionedUsers.size === 0) {
                    const deleteCount = parseInt(numberArg);

                    // Validate number
                    if (deleteCount < 1 || deleteCount > 100) {
                        return message.reply({
                            content: '❌ Please specify a number between 1 and 100!',
                            allowedMentions: { repliedUser: false }
                        }).then(msg => {
                            setTimeout(() => msg.delete(), 5000);
                        });
                    }

                    try {
                        const messages = await message.channel.messages.fetch({ limit: deleteCount + 1 }); // +1 for command message
                        const messagesToDelete = messages.filter(msg => !msg.pinned);

                        await message.channel.bulkDelete(messagesToDelete, true);

                        const purgeEmbed = new EmbedBuilder()
                            .setTitle('🗑️ MESSAGES PURGED')
                            .setDescription(`**Deleted ${messagesToDelete.size - 1} messages**`)
                            .setColor(0xFFA500)
                            .addFields(
                                {
                                    name: '📊 Details',
                                    value: `**Deleted:** ${messagesToDelete.size - 1} messages\n**Type:** Recent messages\n**Channel:** ${message.channel}`,
                                    inline: false
                                }
                            )
                            .setFooter({ text: `Executed by ${message.author.tag}` })
                            .setTimestamp();

                        const replyMsg = await message.channel.send({ embeds: [purgeEmbed] });
                        setTimeout(() => replyMsg.delete(), 5000);

                    } catch (error) {
                        console.error('❌ Error purging messages:', error);
                        await message.reply({
                            content: '❌ Error deleting messages! Make sure messages are not older than 14 days.',
                            allowedMentions: { repliedUser: false }
                        }).then(msg => {
                            setTimeout(() => msg.delete(), 5000);
                        });
                    }
                }
                // Case 2: Users mentioned (X purge @user1 @user2) - ALWAYS DELETE 10 MESSAGES PER USER
                else if (mentionedUsers.size > 0) {
                    let totalDeleted = 0;
                    const userMessages = [];

                    // Fetch recent messages (up to 100)
                    const messages = await message.channel.messages.fetch({ limit: 100 });

                    // Filter messages from mentioned users - ALWAYS GET 10 MESSAGES PER USER
                    for (const [userId, user] of mentionedUsers) {
                        const userMsg = messages.filter(msg =>
                            msg.author.id === userId &&
                            !msg.pinned &&
                            Date.now() - msg.createdTimestamp < 14 * 24 * 60 * 60 * 1000 // Within 14 days
                        ).first(10); // ALWAYS GET 10 MESSAGES PER USER

                        userMessages.push(...userMsg);
                    }

                    if (userMessages.length === 0) {
                        return message.reply({
                            content: '❌ No recent messages found from mentioned users!',
                            allowedMentions: { repliedUser: false }
                        }).then(msg => {
                            setTimeout(() => msg.delete(), 5000);
                        });
                    }

                    // Delete the messages
                    for (const msg of userMessages) {
                        try {
                            await msg.delete();
                            totalDeleted++;
                            // Small delay to avoid rate limits
                            await new Promise(resolve => setTimeout(resolve, 100));
                        } catch (error) {
                            console.error(`Failed to delete message ${msg.id}:`, error);
                        }
                    }

                    // Delete the command message
                    await message.delete().catch(() => { });

                    const userPurgeEmbed = new EmbedBuilder()
                        .setTitle('🗑️ USER MESSAGES PURGED')
                        .setDescription(`**Deleted ${totalDeleted} messages from mentioned users**`)
                        .setColor(0xFFA500)
                        .addFields(
                            {
                                name: '📊 Details',
                                value: `**Deleted:** ${totalDeleted} messages\n**Users:** ${mentionedUsers.size} users\n**Per User:** 10 messages\n**Channel:** ${message.channel}`,
                                inline: false
                            },
                            {
                                name: '👥 Affected Users',
                                value: Array.from(mentionedUsers.values()).map(user => `<@${user.id}>`).join(', '),
                                inline: false
                            }
                        )
                        .setFooter({ text: `Executed by ${message.author.tag}` })
                        .setTimestamp();

                    const replyMsg = await message.channel.send({ embeds: [userPurgeEmbed] });
                    setTimeout(() => replyMsg.delete(), 5000);
                }
                // Case 3: No arguments - DEFAULT 5 MESSAGES
                else {
                    // Delete top 5 messages (default behavior)
                    try {
                        const messages = await message.channel.messages.fetch({ limit: 6 }); // 5 + command message
                        const messagesToDelete = messages.filter(msg => !msg.pinned);

                        await message.channel.bulkDelete(messagesToDelete, true);

                        const purgeEmbed = new EmbedBuilder()
                            .setTitle('🗑️ MESSAGES PURGED')
                            .setDescription(`**Deleted ${messagesToDelete.size - 1} messages**`)
                            .setColor(0xFFA500)
                            .addFields(
                                {
                                    name: '📊 Details',
                                    value: `**Deleted:** ${messagesToDelete.size - 1} messages\n**Type:** Recent messages (default: 5)\n**Channel:** ${message.channel}`,
                                    inline: false
                                }
                            )
                            .setFooter({ text: `Executed by ${message.author.tag}` })
                            .setTimestamp();

                        const replyMsg = await message.channel.send({ embeds: [purgeEmbed] });
                        setTimeout(() => replyMsg.delete(), 5000);

                    } catch (error) {
                        console.error('❌ Error purging messages:', error);
                        await message.reply({
                            content: '❌ Error deleting messages! Make sure messages are not older than 14 days.',
                            allowedMentions: { repliedUser: false }
                        }).then(msg => {
                            setTimeout(() => msg.delete(), 5000);
                        });
                    }
                }
                break;

            case 'delete-all-scrims':
                // Check if user has Administrator permission
                if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return message.reply({
                        content: '❌ You need **Administrator** permissions to delete all scrims!',
                        allowedMentions: { repliedUser: false }
                    }).then(msg => {
                        setTimeout(() => msg.delete(), 5000);
                    });
                }

                // Confirmation embed with danger warning
                const confirmationEmbed = new EmbedBuilder()
                    .setTitle('🚨 DANGER - DELETE ALL SCRIMS')
                    .setDescription('**This will permanently delete ALL scrims data from this server!**')
                    .setColor(0xFF0000)
                    .addFields(
                        {
                            name: '⚠️ Warning',
                            value: 'This action cannot be undone! All scrims data will be permanently lost.',
                            inline: false
                        },
                        {
                            name: '📋 What will be deleted?',
                            value: '• All scrims events\n• All team registrations\n• All slot reservations\n• All scrims data from database',
                            inline: false
                        },
                        {
                            name: '✅ Confirmation',
                            value: 'Type `X confirm-delete` within 30 seconds to confirm deletion.',
                            inline: false
                        }
                    )
                    .setFooter({ text: `Requested by ${message.author.tag}` })
                    .setTimestamp();

                await message.reply({ embeds: [confirmationEmbed] });

                // Create a collector for confirmation
                const filter = (m) => m.author.id === message.author.id && m.content === 'X confirm-delete';
                const collector = message.channel.createMessageCollector({
                    filter,
                    time: 30000, // 30 seconds
                    max: 1
                });

                collector.on('collect', async (m) => {
                    try {
                        // Delete all scrims for this guild
                        const deleteResult = await Scrims.deleteMany({ guildId: message.guild.id });

                        const successEmbed = new EmbedBuilder()
                            .setTitle('✅ ALL SCRIMS DELETED')
                            .setDescription(`**Successfully deleted all scrims data!**`)
                            .setColor(0x00FF00)
                            .addFields(
                                {
                                    name: '🗑️ Deletion Summary',
                                    value: `**Scrims Deleted:** ${deleteResult.deletedCount}\n**Server:** ${message.guild.name}`,
                                    inline: false
                                },
                                {
                                    name: '🔄 Next Steps',
                                    value: 'You can create new scrims using `/create-scrims` command.',
                                    inline: false
                                }
                            )
                            .setFooter({ text: `Deleted by ${message.author.tag}` })
                            .setTimestamp();

                        await message.reply({ embeds: [successEmbed] });

                        // Send log
                        await sendLog(message.guild,
                            `🚨 ALL SCRIMS DELETED\n**Deleted By:** ${message.author.tag}\n**Scrims Deleted:** ${deleteResult.deletedCount}\n**Server:** ${message.guild.name}`,
                            'error'
                        );

                        console.log(`✅ Deleted ${deleteResult.deletedCount} scrims from ${message.guild.name}`);

                    } catch (error) {
                        console.error('❌ Error deleting all scrims:', error);
                        await message.reply({
                            content: '❌ Error deleting scrims data! Please try again.',
                            allowedMentions: { repliedUser: false }
                        });
                    }
                });

                collector.on('end', (collected, reason) => {
                    if (reason === 'time') {
                        message.reply({
                            content: '⏰ Deletion cancelled - Confirmation timeout (30 seconds)',
                            allowedMentions: { repliedUser: false }
                        }).then(msg => {
                            setTimeout(() => msg.delete(), 5000);
                        });
                    }
                });
                break;

            case 'confirm-delete':
                // This command is only used as confirmation for delete-all-scrims
                await message.reply({
                    content: '❌ Use `X delete-all-scrims` first to start the deletion process!',
                    allowedMentions: { repliedUser: false }
                }).then(msg => {
                    setTimeout(() => msg.delete(), 5000);
                });
                break;

            case 'help':
                const helpEmbed = new EmbedBuilder()
                    .setTitle('🆘 X PREFIX COMMANDS HELP')
                    .setDescription('**Available prefix commands (use "X" before command):**')
                    .setColor(0x0099FF)
                    .addFields(
                        {
                            name: '🔒 Channel Management',
                            value: '`X lock` - Locks current channel\n`X unlock` - Unlocks current channel\n*(Manage Channels permission required)*',
                            inline: false
                        },
                        {
                            name: '🎯 Role Management',
                            value: '`X addrole @role @user1 @user2 ...` - Adds role to multiple users at once\n*(Manage Roles permission required)*',
                            inline: false
                        },
                        {
                            name: '🗑️ Message Management',
                            value: '`X purge` - Deletes top 5 recent messages\n`X purge @user1 @user2 ...` - Deletes last 5 messages from mentioned users\n*(Manage Messages permission required)*',
                            inline: false
                        },
                        {
                            name: '🤖 Bot Information',
                            value: '`X bot_admin_role` - Shows current bot admin role and members\n*(Anyone can use)*',
                            inline: false
                        },
                        {
                            name: '🚨 Scrims Management (DANGEROUS)',
                            value: '`X delete-all-scrims` - Deletes ALL scrims data from this server\n*(Administrator permission required)*',
                            inline: false
                        }
                    )
                    .setFooter({ text: 'Use /help for slash commands | All commands require proper permissions' })
                    .setTimestamp();

                await message.reply({ embeds: [helpEmbed] });
                break;

            default:
                // Unknown command
                await message.reply({
                    content: '❌ Unknown command! Use `X help` to see available commands.',
                    allowedMentions: { repliedUser: false }
                }).then(msg => {
                    setTimeout(() => msg.delete(), 5000);
                });
        }
    } catch (error) {
        console.error('❌ Prefix command error:', error);
        await message.reply({
            content: '❌ An error occurred while executing this command!',
            allowedMentions: { repliedUser: false }
        }).then(msg => {
            setTimeout(() => msg.delete(), 5000);
        });
    }
});

// Slash Command Handler - SCRIMS SECTION
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, options, guild, member } = interaction;

    // Check if user has "Use Application Commands" permission
    if (!member.permissions.has(PermissionsBitField.Flags.UseApplicationCommands)) {
        const permissionEmbed = new EmbedBuilder()
            .setTitle('❌ PERMISSION DENIED')
            .setDescription('You need **"Use Application Commands"** permission to use bot commands!')
            .setColor(0xFF0000)
            .addFields({
                name: '🔧 Required Permission',
                value: '• **Use Application Commands** - This permission allows you to interact with bot commands',
                inline: false
            })
            .setFooter({ text: 'Contact server administrator to get this permission' })
            .setTimestamp();

        return interaction.reply({
            embeds: [permissionEmbed],
            flags: 64 // ephemeral
        });
    }

    try {
        switch (commandName) {
            case 'setup':
                if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({
                        content: '❌ You need **Administrator** permissions to setup the bot!',
                        ephemeral: true
                    });
                }

                const botAdminRoleOption = options.getRole('bot_admin_role');

                if (!botAdminRoleOption) {
                    return interaction.reply({
                        content: '❌ Please provide a bot admin role!',
                        ephemeral: true
                    });
                }

                // Create ScrimX-log channel if it doesn't exist
                let logChannel = guild.channels.cache.find(ch =>
                    ch.name === 'scrimx-log' && ch.type === ChannelType.GuildText
                );

                if (!logChannel) {
                    logChannel = await guild.channels.create({
                        name: 'scrimx-log',
                        type: ChannelType.GuildText,
                        topic: 'ScrimX Bot Logs - Do not delete this channel',
                        permissionOverwrites: [
                            {
                                id: guild.roles.everyone.id,
                                deny: [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel]
                            },
                            {
                                id: botAdminRoleOption.id,
                                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory]
                            },
                            {
                                id: client.user.id,
                                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks]
                            }
                        ],
                        reason: 'ScrimX bot log channel'
                    });
                }

                // Save guild settings with botAdminRole
                await GuildSettings.findOneAndUpdate(
                    { guildId: guild.id },
                    {
                        logChannel: logChannel.id,
                        botAdminRole: botAdminRoleOption.id
                    },
                    { upsert: true, new: true }
                );

                // Assign the role to the user who ran the command
                if (!member.roles.cache.has(botAdminRoleOption.id)) {
                    await member.roles.add(botAdminRoleOption);
                }

                // Update all existing scrims with bot admin role
                await Scrims.updateMany(
                    { guildId: guild.id },
                    { botAdminRole: botAdminRoleOption.id }
                );

                const setupEmbed = new EmbedBuilder()
                    .setTitle('✅ Bot Setup Complete!')
                    .setDescription('Scrims bot has been configured successfully!')
                    .setColor(0x00FF00)
                    .addFields(
                        {
                            name: '🔧 Bot Admin Role',
                            value: `<@&${botAdminRoleOption.id}>\nThis role can use **create-scrims** and **delete-scrims** commands`,
                            inline: false
                        },
                        {
                            name: '📝 Log Channel',
                            value: `<#${logChannel.id}>\nAll bot activities will be logged here`,
                            inline: false
                        },
                        {
                            name: '👥 Assigned To',
                            value: `Role has been assigned to <@${member.id}>`,
                            inline: false
                        },
                        {
                            name: '📋 Available Commands',
                            value: '• `/create-scrims` - Bot admins only\n• `/delete-scrims` - Bot admins only\n• All other scrims commands\n• `X lock/unlock` - Channel management\n• `X addrole` - Add role to multiple users',
                            inline: false
                        }
                    )
                    .setFooter({ text: 'Use /create-scrims to start your first scrims!' })
                    .setTimestamp();

                await interaction.reply({
                    embeds: [setupEmbed],
                    ephemeral: false
                });

                // Send initial log
                await sendLog(guild,
                    `🤖 Bot setup completed\n**Admin:** ${member.user.tag}\n**Bot Admin Role:** <@&${botAdminRoleOption.id}>\n**Log Channel:** <#${logChannel.id}>`,
                    'success'
                );
                break;

            // Slash Command Handler - SCRIMS SECTION (Add this case)
            case 'cancel-claim-slot':
                // Check if user has bot admin role
                const cancelClaimSettings = await GuildSettings.findOne({ guildId: guild.id });
                if (!cancelClaimSettings || !cancelClaimSettings.botAdminRole) {
                    return interaction.reply({
                        content: '❌ Bot admin role not set up! Please run `/setup` first.',
                        ephemeral: true
                    });
                }

                if (!member.roles.cache.has(cancelClaimSettings.botAdminRole)) {
                    return interaction.reply({
                        content: `❌ You need the <@&${cancelClaimSettings.botAdminRole}> role to use this command!`,
                        ephemeral: true
                    });
                }

                const targetChannel = options.getChannel('channel');

                // Create the cancel-claim slot message
                const slotData = await createCancelClaimEmbed(guild);

                // Create buttons
                const buttonsRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('cancel_slot_public')
                            .setLabel('❌ Cancel Slot')
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId('claim_slot')
                            .setLabel('🎯 Claim Slot')
                            .setStyle(ButtonStyle.Success)
                            .setDisabled(!slotData.hasAvailableSlots), // Disable if no slots available
                        new ButtonBuilder()
                            .setCustomId('set_reminder')
                            .setLabel('🔔 Remind Me')
                            .setStyle(ButtonStyle.Primary)
                    );

                try {
                    await targetChannel.send({
                        content: '**🎮 SLOT MANAGEMENT SYSTEM**\n*Manage your slots and get notifications for available slots*',
                        embeds: [slotData.embed],
                        components: [buttonsRow]
                    });

                    await interaction.reply({
                        content: `✅ Slot management message posted in <#${targetChannel.id}>!`,
                        ephemeral: true
                    });

                    await sendLog(guild,
                        `📋 Slot management message created\n**Channel:** <#${targetChannel.id}>\n**Created By:** ${member.user.tag}`,
                        'info'
                    );

                } catch (error) {
                    console.error('❌ Error posting slot management message:', error);
                    await interaction.reply({
                        content: '❌ Error posting message! Make sure I have permissions to send messages in that channel.',
                        ephemeral: true
                    });
                }
                break;
            case 'create-scrims':
                // Check if user has bot admin role
                const settings = await GuildSettings.findOne({ guildId: guild.id });
                if (!settings || !settings.botAdminRole) {
                    return interaction.reply({
                        content: '❌ Bot admin role not set up! Please run `/setup` first to configure the bot.',
                        ephemeral: true
                    });
                }

                const botAdminRoleId = settings.botAdminRole;
                if (!member.roles.cache.has(botAdminRoleId)) {
                    return interaction.reply({
                        content: `❌ You need the <@&${botAdminRoleId}> role to create scrims!`,
                        ephemeral: true
                    });
                }

                const registrationChannel = options.getChannel('registration_channel');
                const slotlistChannel = options.getChannel('slotlist_channel');
                const successRole = options.getRole('success_role');
                const requiredTags = options.getInteger('required_tags');
                const totalSlots = options.getInteger('total_slots');
                const openTime = options.getString('open_time');
                const scrimsTime = options.getString('scrims_time');
                const scrimsName = options.getString('scrims_name') || `${guild.name} Daily Scrims`;

                if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(openTime)) {
                    return interaction.reply({
                        content: '❌ Invalid time format! Use **HH:MM** (24hr format)\nExample: `18:00` for 6 PM',
                        ephemeral: true
                    });
                }

                if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(scrimsTime)) {
                    return interaction.reply({
                        content: '❌ Invalid scrims time format! Use **HH:MM** (24hr format)\nExample: `20:00` for 8 PM',
                        ephemeral: true
                    });
                }

                const newScrims = new Scrims({
                    guildId: guild.id,
                    scrimsName: scrimsName,
                    registrationChannel: registrationChannel.id,
                    slotlistChannel: slotlistChannel.id,
                    requiredRole: null,
                    successRole: successRole.id,
                    botAdminRole: botAdminRoleId,
                    requiredTags: requiredTags,
                    totalSlots: totalSlots,
                    openTime: openTime,
                    scrimsTime: scrimsTime,
                    status: 'scheduled',
                    reservedSlots: [],
                    registeredTeams: [],
                    dailySchedule: {
                        detailsSent: false,
                        lastReset: new Date()
                    }
                });

                await newScrims.save();

                // LOCK CHANNEL INITIALLY - No one can send messages until opening time
                await registrationChannel.permissionOverwrites.edit(guild.roles.everyone, {
                    SendMessages: false, // Locked initially
                    ViewChannel: true,
                    ReadMessageHistory: true
                });

                // Allow bot to send messages
                await registrationChannel.permissionOverwrites.edit(client.user.id, {
                    SendMessages: true,
                    ViewChannel: true,
                    ReadMessageHistory: true
                });

                // Allow bot admin role to send messages (for manual operations)
                await registrationChannel.permissionOverwrites.edit(botAdminRoleId, {
                    SendMessages: true,
                    ViewChannel: true,
                    ReadMessageHistory: true
                });

                // DO NOT send scrims info immediately - wait for scheduled time
                const confirmationEmbed = new EmbedBuilder()
                    .setTitle('✅ Daily Scrims Created Successfully!')
                    .setDescription(`**${scrimsName}** has been scheduled for daily execution`)
                    .setColor(0x00FF00)
                    .addFields(
                        {
                            name: '📋 Event Details',
                            value: `**Registration Channel:** <#${registrationChannel.id}>\n**Slotlist Channel:** <#${slotlistChannel.id}>\n**Success Role:** <@&${successRole.id}>`,
                            inline: false
                        },
                        {
                            name: '🎮 Daily Schedule',
                            value: `**Details Sent:** 5 minutes before ${openTime}\n**Registration Opens:** ${openTime}\n**Scrims Time:** ${scrimsTime}\n**Daily Reset:** 5:00 AM`,
                            inline: false
                        },
                        {
                            name: '🔄 Automated Features',
                            value: '• 📢 Daily details at (Open Time - 5 minutes)\n• 🎮 Auto registration opening\n• ✅ Success role assignment\n• 🗑️ Daily channel cleanup at 5 AM\n• 🔄 Auto success role removal at 5 AM',
                            inline: false
                        },
                        {
                            name: '👑 Created By',
                            value: `<@${member.user.id}> (Bot Admin)`,
                            inline: false
                        }
                    )
                    .setFooter({ text: `Scrims ID: ${newScrims._id} | First run tomorrow at ${openTime}` })
                    .setTimestamp();

                await interaction.reply({
                    content: `🎮 Daily scrims created! Check <#${registrationChannel.id}> tomorrow at ${openTime}`,
                    embeds: [confirmationEmbed],
                    ephemeral: false
                });

                // Schedule daily tasks
                scheduleDailyScrimsTasks(newScrims);

                // Send log
                await sendLog(guild,
                    `🎮 Daily scrims created\n**Name:** ${scrimsName}\n**Created By:** ${member.user.tag}\n**Open Time:** ${openTime} daily\n**Scrims Time:** ${scrimsTime}\n**Channels:** <#${registrationChannel.id}>, <#${slotlistChannel.id}>`,
                    'success'
                );
                break;

            // Other slash commands remain the same...
            case 'delete-scrims':
                // Check if user has bot admin role
                const deleteSettings = await GuildSettings.findOne({ guildId: guild.id });
                if (!deleteSettings || !deleteSettings.botAdminRole) {
                    return interaction.reply({
                        content: '❌ Bot admin role not set up! Please run `/setup` first.',
                        ephemeral: true
                    });
                }

                if (!member.roles.cache.has(deleteSettings.botAdminRole)) {
                    return interaction.reply({
                        content: `❌ You need the <@&${deleteSettings.botAdminRole}> role to delete scrims!`,
                        ephemeral: true
                    });
                }

                const scrimsId = options.getString('scrims_id');
                const scrimsToDelete = await Scrims.findOne({ _id: scrimsId, guildId: guild.id });

                if (!scrimsToDelete) {
                    return interaction.reply({
                        content: '❌ Scrims not found! Check the Scrims ID and try again.',
                        ephemeral: true
                    });
                }

                await Scrims.deleteOne({ _id: scrimsId });

                await interaction.reply({
                    content: `✅ Scrims **${scrimsToDelete.scrimsName}** has been deleted successfully!`,
                    ephemeral: false
                });

                await sendLog(guild,
                    `🗑️ Scrims deleted\n**Name:** ${scrimsToDelete.scrimsName}\n**Deleted By:** ${member.user.tag}\n**Scrims ID:** ${scrimsId}`,
                    'warning'
                );
                break;

            case 'open-registration':
                // Check if user has bot admin role
                const openSettings = await GuildSettings.findOne({ guildId: guild.id });
                if (!openSettings || !openSettings.botAdminRole) {
                    return interaction.reply({
                        content: '❌ Bot admin role not set up! Please run `/setup` first.',
                        ephemeral: true
                    });
                }

                if (!member.roles.cache.has(openSettings.botAdminRole)) {
                    return interaction.reply({
                        content: `❌ You need the <@&${openSettings.botAdminRole}> role to open registration!`,
                        ephemeral: true
                    });
                }

                const openRegistrationChannel = options.getChannel('registration_channel');
                const openScrims = await Scrims.findOne({
                    guildId: guild.id,
                    registrationChannel: openRegistrationChannel.id
                });

                if (!openScrims) {
                    return interaction.reply({
                        content: '❌ No scrims found for this registration channel!',
                        ephemeral: true
                    });
                }

                await openRegistration(openScrims, guild);

                await interaction.reply({
                    content: `✅ Registration opened for **${openScrims.scrimsName}** in <#${openRegistrationChannel.id}>!`,
                    ephemeral: false
                });
                break;

            case 'close-registration':
                // Check if user has bot admin role
                const closeSettings = await GuildSettings.findOne({ guildId: guild.id });
                if (!closeSettings || !closeSettings.botAdminRole) {
                    return interaction.reply({
                        content: '❌ Bot admin role not set up! Please run `/setup` first.',
                        ephemeral: true
                    });
                }

                if (!member.roles.cache.has(closeSettings.botAdminRole)) {
                    return interaction.reply({
                        content: `❌ You need the <@&${closeSettings.botAdminRole}> role to close registration!`,
                        ephemeral: true
                    });
                }

                const closeRegistrationChannel = options.getChannel('registration_channel');
                const closeScrims = await Scrims.findOne({
                    guildId: guild.id,
                    registrationChannel: closeRegistrationChannel.id
                });

                if (!closeScrims) {
                    return interaction.reply({
                        content: '❌ No scrims found for this registration channel!',
                        ephemeral: true
                    });
                }

                await closeRegistration(closeScrims, guild, 'manual');

                await interaction.reply({
                    content: `✅ Registration closed for **${closeScrims.scrimsName}** in <#${closeRegistrationChannel.id}>!`,
                    ephemeral: false
                });
                break;

            case 'list-scrims':
                // Check if user has bot admin role
                const listSettings = await GuildSettings.findOne({ guildId: guild.id });
                if (!listSettings || !listSettings.botAdminRole) {
                    return interaction.reply({
                        content: '❌ Bot admin role not set up! Please run `/setup` first.',
                        ephemeral: true
                    });
                }

                if (!member.roles.cache.has(listSettings.botAdminRole)) {
                    return interaction.reply({
                        content: `❌ You need the <@&${listSettings.botAdminRole}> role to list scrims!`,
                        ephemeral: true
                    });
                }

                const allScrims = await Scrims.find({ guildId: guild.id });

                if (allScrims.length === 0) {
                    return interaction.reply({
                        content: '❌ No scrims found in this server!',
                        ephemeral: true
                    });
                }

                const scrimsListEmbed = new EmbedBuilder()
                    .setTitle('🎮 ACTIVE SCRIMS LIST')
                    .setDescription(`**Total Scrims:** ${allScrims.length}`)
                    .setColor(0x0099FF)
                    .setTimestamp();

                allScrims.forEach((scrims, index) => {
                    scrimsListEmbed.addFields({
                        name: `${index + 1}. ${scrims.scrimsName}`,
                        value: `**ID:** ${scrims._id}\n**Status:** ${scrims.status}\n**Open Time:** ${scrims.openTime}\n**Slots:** ${scrims.registeredTeams.filter(t => t.validated).length}/${scrims.totalSlots}\n**Channel:** <#${scrims.registrationChannel}>`,
                        inline: false
                    });
                });

                await interaction.reply({
                    embeds: [scrimsListEmbed],
                    ephemeral: false
                });
                break;

            case 'reserve-team':
                // Check if user has bot admin role
                const reserveSettings = await GuildSettings.findOne({ guildId: guild.id });
                if (!reserveSettings || !reserveSettings.botAdminRole) {
                    return interaction.reply({
                        content: '❌ Bot admin role not set up! Please run `/setup` first.',
                        ephemeral: true
                    });
                }

                if (!member.roles.cache.has(reserveSettings.botAdminRole)) {
                    return interaction.reply({
                        content: `❌ You need the <@&${reserveSettings.botAdminRole}> role to reserve slots!`,
                        ephemeral: true
                    });
                }

                const reserveRegistrationChannel = options.getChannel('registration_channel');
                const slotNumber = options.getInteger('slot');
                const teamName = options.getString('team_name');
                const user = options.getUser('user');
                const expireTime = options.getString('expire_time');

                const reserveScrims = await Scrims.findOne({
                    guildId: guild.id,
                    registrationChannel: reserveRegistrationChannel.id
                });

                if (!reserveScrims) {
                    return interaction.reply({
                        content: '❌ No scrims found for this registration channel!',
                        ephemeral: true
                    });
                }

                // Check if slot is already reserved or taken
                const existingReservation = reserveScrims.reservedSlots.find(r =>
                    r.slotNumber === slotNumber && r.status === 'active'
                );

                const existingTeam = reserveScrims.registeredTeams.find(t =>
                    t.slotNumber === slotNumber && t.validated
                );

                if (existingReservation || existingTeam) {
                    return interaction.reply({
                        content: `❌ Slot ${slotNumber} is already taken!`,
                        ephemeral: true
                    });
                }

                // Check if slot number is valid
                if (slotNumber > reserveScrims.totalSlots || slotNumber < 1) {
                    return interaction.reply({
                        content: `❌ Invalid slot number! Available slots: 1-${reserveScrims.totalSlots}`,
                        ephemeral: true
                    });
                }

                // Parse expiry time
                const expiryMs = parseTime(expireTime);
                if (!expiryMs) {
                    return interaction.reply({
                        content: '❌ Invalid expiry time format! Use: 2h, 30m, 1d',
                        ephemeral: true
                    });
                }

                const expiresAt = new Date(Date.now() + expiryMs);

                // Add reservation
                reserveScrims.reservedSlots.push({
                    slotNumber: slotNumber,
                    teamName: teamName,
                    user: user.id,
                    expiresAt: expiresAt,
                    status: 'active'
                });

                await reserveScrims.save();

                const reserveEmbed = new EmbedBuilder()
                    .setTitle('✅ SLOT RESERVED')
                    .setDescription(`**Slot ${slotNumber} has been reserved!**`)
                    .setColor(0x00FF00)
                    .addFields(
                        {
                            name: '📋 Reservation Details',
                            value: `**Team:** ${teamName}\n**Slot:** ${slotNumber}\n**User:** <@${user.id}>\n**Expires:** <t:${Math.floor(expiresAt.getTime() / 1000)}:R>`,
                            inline: false
                        }
                    )
                    .setTimestamp();

                await interaction.reply({
                    embeds: [reserveEmbed],
                    ephemeral: false
                });

                await sendLog(guild,
                    `📌 Slot reserved\n**Scrims:** ${reserveScrims.scrimsName}\n**Slot:** ${slotNumber}\n**Team:** ${teamName}\n**User:** ${user.tag}\n**Expires:** <t:${Math.floor(expiresAt.getTime() / 1000)}:R>`,
                    'info'
                );
                break;

            case 'show-reservations':
                // Check if user has bot admin role
                const showSettings = await GuildSettings.findOne({ guildId: guild.id });
                if (!showSettings || !showSettings.botAdminRole) {
                    return interaction.reply({
                        content: '❌ Bot admin role not set up! Please run `/setup` first.',
                        ephemeral: true
                    });
                }

                if (!member.roles.cache.has(showSettings.botAdminRole)) {
                    return interaction.reply({
                        content: `❌ You need the <@&${showSettings.botAdminRole}> role to view reservations!`,
                        ephemeral: true
                    });
                }

                const showRegistrationChannel = options.getChannel('registration_channel');
                const showScrims = await Scrims.findOne({
                    guildId: guild.id,
                    registrationChannel: showRegistrationChannel.id
                });

                if (!showScrims) {
                    return interaction.reply({
                        content: '❌ No scrims found for this registration channel!',
                        ephemeral: true
                    });
                }

                const reservationsEmbed = createReservationsEmbed(showScrims, guild);
                await interaction.reply({
                    embeds: [reservationsEmbed],
                    ephemeral: false
                });
                break;

            case 'cancel-reservation':
                // Check if user has bot admin role
                const cancelReserveSettings = await GuildSettings.findOne({ guildId: guild.id });
                if (!cancelReserveSettings || !cancelReserveSettings.botAdminRole) {
                    return interaction.reply({
                        content: '❌ Bot admin role not set up! Please run `/setup` first.',
                        ephemeral: true
                    });
                }

                if (!member.roles.cache.has(cancelReserveSettings.botAdminRole)) {
                    return interaction.reply({
                        content: `❌ You need the <@&${cancelReserveSettings.botAdminRole}> role to cancel reservations!`,
                        ephemeral: true
                    });
                }

                const cancelRegistrationChannel = options.getChannel('registration_channel');
                const cancelSlot = options.getInteger('slot');

                const cancelScrims = await Scrims.findOne({
                    guildId: guild.id,
                    registrationChannel: cancelRegistrationChannel.id
                });

                if (!cancelScrims) {
                    return interaction.reply({
                        content: '❌ No scrims found for this registration channel!',
                        ephemeral: true
                    });
                }

                // Find and cancel the reservation
                const reservationToCancel = cancelScrims.reservedSlots.find(r =>
                    r.slotNumber === cancelSlot && r.status === 'active'
                );

                if (!reservationToCancel) {
                    return interaction.reply({
                        content: `❌ No active reservation found for slot ${cancelSlot}!`,
                        ephemeral: true
                    });
                }

                reservationToCancel.status = 'cancelled';

                await cancelScrims.save();

                const cancelReservationEmbed = new EmbedBuilder()
                    .setTitle('❌ RESERVATION CANCELLED')
                    .setDescription(`**Reservation for slot ${cancelSlot} has been cancelled!**`)
                    .setColor(0xFF0000)
                    .addFields(
                        {
                            name: '📋 Details',
                            value: `**Team:** ${reservationToCancel.teamName}\n**Slot:** ${cancelSlot}\n**User:** <@${reservationToCancel.user}>`,
                            inline: false
                        }
                    )
                    .setTimestamp();

                await interaction.reply({
                    embeds: [cancelReservationEmbed],
                    ephemeral: false
                });

                await sendLog(guild,
                    `❌ Reservation cancelled\n**Scrims:** ${cancelScrims.scrimsName}\n**Slot:** ${cancelSlot}\n**Team:** ${reservationToCancel.teamName}\n**Cancelled By:** ${member.user.tag}`,
                    'warning'
                );
                break;

            case 'assign-slots':
                // Check if user has bot admin role
                const assignSettings = await GuildSettings.findOne({ guildId: guild.id });
                if (!assignSettings || !assignSettings.botAdminRole) {
                    return interaction.reply({
                        content: '❌ Bot admin role not set up! Please run `/setup` first.',
                        ephemeral: true
                    });
                }

                if (!member.roles.cache.has(assignSettings.botAdminRole)) {
                    return interaction.reply({
                        content: `❌ You need the <@&${assignSettings.botAdminRole}> role to assign slots!`,
                        ephemeral: true
                    });
                }

                const assignRegistrationChannel = options.getChannel('registration_channel');
                const assignScrims = await Scrims.findOne({
                    guildId: guild.id,
                    registrationChannel: assignRegistrationChannel.id
                });

                if (!assignScrims) {
                    return interaction.reply({
                        content: '❌ No scrims found for this registration channel!',
                        ephemeral: true
                    });
                }

                // Manually assign slots
                await finalizeSlotAssignment(assignScrims, guild);

                await interaction.reply({
                    content: `✅ Slots assigned manually for **${assignScrims.scrimsName}**! Check <#${assignScrims.slotlistChannel}>`,
                    ephemeral: false
                });

                await sendLog(guild,
                    `🎯 Slots manually assigned\n**Scrims:** ${assignScrims.scrimsName}\n**Assigned By:** ${member.user.tag}\n**Teams:** ${assignScrims.registeredTeams.filter(t => t.validated).length}`,
                    'success'
                );
                break;

            case 'test-slotlist':
                // Check if user has bot admin role
                const testSettings = await GuildSettings.findOne({ guildId: guild.id });
                if (!testSettings || !testSettings.botAdminRole) {
                    return interaction.reply({
                        content: '❌ Bot admin role not set up! Please run `/setup` first.',
                        ephemeral: true
                    });
                }

                if (!member.roles.cache.has(testSettings.botAdminRole)) {
                    return interaction.reply({
                        content: `❌ You need the <@&${testSettings.botAdminRole}> role to test slot list!`,
                        ephemeral: true
                    });
                }

                // Create example slot list
                const exampleEmbed = new EmbedBuilder()
                    .setTitle('🎯 EXAMPLE SCRIMS - SLOT LIST')
                    .setColor(0x0099FF)
                    .setTimestamp();

                // Create example slot list with 25 slots
                let exampleSlotList = '';
                const exampleTotalSlots = 25;

                // Example data - mixed filled, empty, reserved, and cancelled slots
                const exampleData = {
                    1: { type: 'filled', team: 'Team Alpha' },
                    3: { type: 'reserved', team: 'Team Beta' },
                    5: { type: 'filled', team: 'Team Gamma' },
                    7: { type: 'cancelled', team: 'Team Delta' },
                    10: { type: 'filled', team: 'Team Epsilon' },
                    15: { type: 'reserved', team: 'Team Zeta' },
                    20: { type: 'filled', team: 'Team Eta' },
                    22: { type: 'cancelled', team: 'Team Theta' }
                };

                for (let i = 1; i <= exampleTotalSlots; i++) {
                    if (exampleData[i]) {
                        switch (exampleData[i].type) {
                            case 'filled':
                                exampleSlotList += `**Slot ${i}** - ${exampleData[i].team}\n`;
                                break;
                            case 'reserved':
                                exampleSlotList += `**Slot ${i}** - ♦️ ${exampleData[i].team} (Reserved)\n`;
                                break;
                            case 'cancelled':
                                exampleSlotList += `**Slot ${i}** - ❌ CANCELLED (${exampleData[i].team})\n`;
                                break;
                        }
                    } else {
                        exampleSlotList += `**Slot ${i}** - EMPTY\n`;
                    }
                }

                exampleEmbed.setDescription(exampleSlotList);

                exampleEmbed.addFields(
                    {
                        name: '📊 Summary',
                        value: `**Total Slots:** ${exampleTotalSlots}\n**Filled Slots:** 5\n**Empty Slots:** 17\n**Cancelled Slots:** 2\n**Reserved Slots:** 2`,
                        inline: true
                    },
                    {
                        name: '⏰ Scrims Time',
                        value: '**20:00**',
                        inline: true
                    },
                    {
                        name: 'ℹ️ Note',
                        value: 'This is an **EXAMPLE** slot list for testing purposes only.',
                        inline: false
                    }
                );

                // Create example buttons
                const exampleButtons = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('cancel_slot')
                            .setLabel('❌ Cancel Slot')
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId('transfer_slot')
                            .setLabel('🔄 Transfer Slot')
                            .setStyle(ButtonStyle.Primary)
                    );

                await interaction.reply({
                    content: '**📋 EXAMPLE SLOT LIST - FOR TESTING**\n*This shows how the final slot list will look*',
                    embeds: [exampleEmbed],
                    components: [exampleButtons],
                    ephemeral: false
                });

                await sendLog(guild,
                    `📋 Test slot list generated\n**Generated By:** ${member.user.tag}`,
                    'info'
                );
                break;

            // Add other slash command cases here...
            default:
                await interaction.reply({
                    content: '❌ Unknown command!',
                    ephemeral: true
                });
        }
    } catch (error) {
        console.error('❌ Scrims command error:', error);

        if (guild) {
            await sendLog(guild,
                `❌ Command error\n**Command:** ${commandName}\n**User:** ${member.user.tag}\n**Error:** ${error.message}`,
                'error'
            );
        }

        await interaction.reply({
            content: '❌ An error occurred while executing this command!',
            ephemeral: true
        });
    }
});

// Error Handling
client.on('error', error => {
    console.error('❌ Discord Client Error:', error);
});

process.on('unhandledRejection', error => {
    console.error('❌ Unhandled Promise Rejection:', error);
});

// Login Bot
client.login(process.env.BOT_TOKEN).then(() => {
    console.log('🔗 Bot is logging in...');
}).catch(error => {
    console.error('❌ Bot login failed:', error);
});