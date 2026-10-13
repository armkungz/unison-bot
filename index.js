// ฝังคำสั่งบังคับใช้ IPv4 ทันทีเพื่อทะลุกำแพงเครือข่ายของเซิร์ฟเวอร์
const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

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
const express = require('express');

// --- ส่วนของ Web Server สำหรับรองรับ cron-job.org ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Discord Check-in Bot is online!');
});

app.listen(port, () => {
    console.log(`✅ Web server is running on port ${port}`);
});
// ---------------------------------------------

// ตั้งค่า Token และ ID ช่อง
const config = {
    token: process.env.BOT_TOKEN,
    logChannelId: '1559104694150758410'
};

// ไฟล์สำหรับเก็บข้อมูล
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

// ฟังก์ชันแปลงหน่วย Milliseconds
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
    ],
    rest: { timeout: 15000 } // บังคับให้แจ้ง Error ถ้าเชื่อมต่อเกิน 15 วินาที จะได้ไม่ค้าง
});

client.once(Events.ClientReady, c => {
    console.log(`✅ Bot is ready! Logged in as ${c.user.tag}`);
});

// คำสั่ง !setup
client.on(Events.MessageCreate, async message => {
    if (message.content === '!setup' && message.member.permissions.has('Administrator')) {
        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle('🕒 ระบบเช็คอิน - เช็คเอาท์')
            .setDescription('กดปุ่มด้านล่างเพื่อบันทึกเวลาเข้าและออกของคุณ');

        const btnCheckIn = new ButtonBuilder()
            .setCustomId('btn_checkin')
            .setLabel('เข้า (Check-In)')
            .setStyle(ButtonStyle.Success);

        const btnCheckOut = new ButtonBuilder()
            .setCustomId('btn_checkout')
            .setLabel('ออก (Check-Out)')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(btnCheckIn, btnCheckOut);

        await message.channel.send({ embeds: [embed], components: [row] });
        await message.delete();
    }
});

// จัดการการกดปุ่ม
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;

    const userId = interaction.user.id;
    let data = loadData();
    const logChannel = client.channels.cache.get(config.logChannelId);

    if (interaction.customId === 'btn_checkin') {
        if (data[userId] && data[userId].checkInTime) {
            return interaction.reply({ content: '❌ คุณได้ทำการเช็คอินไปแล้ว กรุณาเช็คเอาท์ก่อนทำรายการใหม่ครับ', ephemeral: true });
        }

        data[userId] = { checkInTime: Date.now() };
        saveData(data);

        await interaction.reply({ content: '✅ บันทึกเวลาเข้าเรียบร้อยแล้ว!', ephemeral: true });

        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('📥 เช็คอินเข้า')
                .setColor('#00ff00')
                .addFields(
                    { name: 'ผู้ใช้งาน', value: `<@${userId}>`, inline: true },
                    { name: 'เวลาเข้า', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
                );
            await logChannel.send({ embeds: [embed] });
        }
    }

    if (interaction.customId === 'btn_checkout') {
        if (!data[userId] || !data[userId].checkInTime) {
            return interaction.reply({ content: '❌ คุณยังไม่ได้ทำการเช็คอินครับ', ephemeral: true });
        }

        const checkInTime = data[userId].checkInTime;
        const checkOutTime = Date.now();
        const durationMs = checkOutTime - checkInTime; 
        
        delete data[userId];
        saveData(data);

        await interaction.reply({ content: '✅ บันทึกเวลาออกและสรุปยอดเรียบร้อยแล้ว!', ephemeral: true });

        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('📤 เช็คเอาท์และสรุปเวลา')
                .setColor('#ff0000')
                .addFields(
                    { name: 'ผู้ใช้งาน', value: `<@${userId}>`, inline: true },
                    { name: 'เวลาเข้า', value: `<t:${Math.floor(checkInTime / 1000)}:T>`, inline: true },
                    { name: 'เวลาออก', value: `<t:${Math.floor(checkOutTime / 1000)}:T>`, inline: true },
                    { name: 'รวมเวลาทั้งหมด', value: `\`${formatDuration(durationMs)}\``, inline: false }
                );
            await logChannel.send({ embeds: [embed] });
        }
    }
});

// ดักจับและแจ้งเตือนเมื่อบอทโดน Rate Limit จาก Discord ภายใน Client
client.rest.on('rateLimited', (rateLimitInfo) => {
    console.warn('⚠️ แจ้งเตือน: บอทติด Rate Limit จาก Discord API:');
    console.warn(`   - Route: ${rateLimitInfo.route}`);
    console.warn(`   - Timeout: ${rateLimitInfo.timeToReset}ms`);
});

// ดึง Log ระดับลึกของ Discord.js ออกมาดู
client.on('debug', info => console.log(`[DISCORD DEBUG] ${info}`));
client.on('warn', warn => console.log(`[DISCORD WARN] ${warn}`));
client.on('error', error => console.error(`[DISCORD ERROR]`, error));

// เพิ่มระบบตรวจสอบเครือข่ายก่อน Login (Pre-flight Network Check) + ระบบ Retry
async function startBot(retries = 6, delay = 5000) {
    console.log("กำลังทดสอบการเชื่อมต่อเซิร์ฟเวอร์ Discord (Pre-flight Check)...");
    
    try {
        const response = await fetch('https://discord.com/api/v10/gateway', {
            signal: AbortSignal.timeout(10000) // รอสูงสุด 10 วินาที
        });
        
        if (response.ok) {
            console.log("✅ เครือข่ายปกติ สามารถเข้าถึง Discord API ได้");
            
            console.log("กำลังพยายามเชื่อมต่อด้วย Token...");
            client.login(config.token).catch(err => {
                console.error("❌ เกิดข้อผิดพลาดในการ Login เข้า Discord:");
                console.error(err);
            });
        } else {
            console.log(`❌ Discord API ตอบกลับด้วยสถานะ: ${response.status}`);
            
            // หากติด 429 (Too Many Requests) หรือปัญหา Server อื่นๆ ให้ทำการ Retry
            if (response.status === 429 && retries > 0) {
                console.log(`⚠️ รอ ${delay / 1000} วินาทีเพื่อลองใหม่... (เหลือสิทธิ์ลองอีก ${retries} ครั้ง)`);
                setTimeout(() => startBot(retries - 1, delay * 2), delay);
            } else if (retries === 0) {
                console.error("🛑 [CRITICAL ERROR] หมดโควต้าการลองใหม่! เซิร์ฟเวอร์ Render เครื่องนี้ถูก Discord บล็อก IP อย่างสมบูรณ์");
                console.error("💡 คำแนะนำ: ให้กด Suspend หรือ Stop บน Render ทิ้งไว้ 30-60 นาที แล้วค่อยกด Resume เพื่อให้ได้ IP ใหม่ / ปลดล็อค Rate Limit");
            }
        }
    } catch (error) {
        console.error("🛑 [CRITICAL ERROR] ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ Discord ได้!");
        console.error(error.message);
        
        if (retries > 0) {
            console.log(`⚠️ รอ ${delay / 1000} วินาทีเพื่อลองใหม่... (เหลือสิทธิ์ลองอีก ${retries} ครั้ง)`);
            setTimeout(() => startBot(retries - 1, delay * 2), delay);
        }
    }
}

// ป้องกันแอปแครชจาก Unhandled Promise Rejections และ Uncaught Exceptions
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

if (!config.token) {
    console.log("❌ ไม่พบ Token ในระบบ! (อ่านค่าจากเว็บ Render ไม่ได้)");
} else {
    startBot();
}
