const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    Events
} = require('discord.js');
const fs = require('fs');

// ตั้งค่า Token และ ID ช่อง
const config = {
    token: process.env.BOT_TOKEN,
    logChannelId: '1559104694150758410'
};

// ไฟล์สำหรับเก็บข้อมูล ป้องกันข้อมูลหายตอนบอทรีสตาร์ทหรือปิดรันใหม่
const DATA_FILE = './checkin_data.json';

function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
    return {};
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4), 'utf8');
}

// ฟังก์ชันแปลงหน่วย Milliseconds เป็น ชั่วโมง นาที วินาที
function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    let result = '';
    if (hours > 0) result += `${hours} ชม. `;
    if (minutes > 0) result += `${minutes} นาที `;
    result += `${seconds} วินาที`;
    return result;
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once(Events.ClientReady, c => {
    console.log(`Bot is ready! Logged in as ${c.user.tag}`);
});

// พิมพ์ !setup เพื่อสร้างแผงปุ่มกด เข้า-ออก งาน
client.on(Events.MessageCreate, async message => {
    if (message.content === '!setup' && message.member.permissions.has('Administrator')) {
        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle('🕒 ระบบเช็คอิน - เช็คเอาท์')
            .setDescription('กดปุ่มด้านล่างเพื่อบันทึกเวลาเข้าและออกงานของคุณ');

        const btnCheckIn = new ButtonBuilder()
            .setCustomId('btn_checkin')
            .setLabel('เข้างาน (Check-In)')
            .setStyle(ButtonStyle.Success);

        const btnCheckOut = new ButtonBuilder()
            .setCustomId('btn_checkout')
            .setLabel('ออกงาน (Check-Out)')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(btnCheckIn, btnCheckOut);

        await message.channel.send({ embeds: [embed], components: [row] });
        await message.delete();
    }
});

// จัดการการกดปุ่มเช็คอินและเช็คเอาท์
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;

    const userId = interaction.user.id;
    let data = loadData();
    const logChannel = client.channels.cache.get(config.logChannelId);

    // กรณีผู้ใช้กด เช็คอิน
    if (interaction.customId === 'btn_checkin') {
        if (data[userId] && data[userId].checkInTime) {
            return interaction.reply({ content: '❌ คุณได้ทำการเช็คอินไปแล้ว กรุณาเช็คเอาท์ก่อนทำรายการใหม่ครับ', ephemeral: true });
        }

        // บันทึกเวลาปัจจุบัน
        data[userId] = {
            checkInTime: Date.now()
        };
        saveData(data);

        await interaction.reply({ content: '✅ บันทึกเวลาเข้างานเรียบร้อยแล้ว!', ephemeral: true });

        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('📥 เช็คอินเข้างาน')
                .setColor('#00ff00')
                .addFields(
                    { name: 'ผู้ใช้งาน', value: `<@${userId}>`, inline: true },
                    { name: 'เวลาเข้า', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
                );
            await logChannel.send({ embeds: [embed] });
        }
    }

    // กรณีผู้ใช้กด เช็คเอาท์
    if (interaction.customId === 'btn_checkout') {
        if (!data[userId] || !data[userId].checkInTime) {
            return interaction.reply({ content: '❌ คุณยังไม่ได้ทำการเช็คอินครับ', ephemeral: true });
        }

        const checkInTime = data[userId].checkInTime;
        const checkOutTime = Date.now();
        const durationMs = checkOutTime - checkInTime; // หาเวลาส่วนต่าง

        // ลบข้อมูลเช็คอินออกหลังจากเช็คเอาท์เสร็จ เพื่อให้พร้อมสำหรับการเช็คอินรอบถัดไป
        delete data[userId];
        saveData(data);

        await interaction.reply({ content: '✅ บันทึกเวลาออกงานและสรุปยอดเรียบร้อยแล้ว!', ephemeral: true });

        // ส่งสรุปเวลาไปที่ช่อง Log
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('📤 เช็คเอาท์และสรุปเวลา')
                .setColor('#ff0000')
                .addFields(
                    { name: 'ผู้ใช้งาน', value: `<@${userId}>`, inline: true },
                    { name: 'เวลาเข้า', value: `<t:${Math.floor(checkInTime / 1000)}:T>`, inline: true },
                    { name: 'เวลาออก', value: `<t:${Math.floor(checkOutTime / 1000)}:T>`, inline: true },
                    { name: 'รวมเวลาทำงานทั้งหมด', value: `\`${formatDuration(durationMs)}\``, inline: false }
                );
            await logChannel.send({ embeds: [embed] });
        }
    }
});

client.login(config.token);
