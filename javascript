const express = require('express');
const { Telegraf } = require('telegraf');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const db = require('./database');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// تخزين مؤقت للروابط
const paymentLinks = new Map();

// صفحة نموذج الدفع
app.get('/payment', (req, res) => {
    const { user_id, username, link_id } = req.query;
    
    if (!paymentLinks.has(link_id)) {
        return res.send(`
            <!DOCTYPE html>
            <html dir="rtl">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>رابط غير صالح</title>
                <style>
                    body {
                        font-family: 'Tahoma', 'Arial', sans-serif;
                        text-align: center;
                        padding: 50px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        min-height: 100vh;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        margin: 0;
                    }
                    .container {
                        background: rgba(255,255,255,0.95);
                        color: #333;
                        padding: 40px;
                        border-radius: 20px;
                        max-width: 500px;
                    }
                    h1 { color: #764ba2; }
                    button {
                        background: #667eea;
                        color: white;
                        border: none;
                        padding: 12px 30px;
                        border-radius: 10px;
                        font-size: 16px;
                        cursor: pointer;
                        margin-top: 20px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>⚠️ رابط غير صالح</h1>
                    <p>هذا الرابط منتهي الصلاحية أو غير موجود</p>
                    <p>يرجى طلب رابط جديد من البوت</p>
                    <button onclick="window.close()">إغلاق</button>
                </div>
            </body>
            </html>
        `);
    }
    
    res.sendFile(path.join(__dirname, 'payment-form.html'));
});

// صفحة رئيسية بسيطة
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>بوت التبرعات</title>
            <style>
                body {
                    font-family: 'Tahoma', 'Arial', sans-serif;
                    text-align: center;
                    padding: 50px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    margin: 0;
                }
                .container {
                    background: rgba(255,255,255,0.95);
                    color: #333;
                    padding: 40px;
                    border-radius: 20px;
                    max-width: 500px;
                }
                h1 { color: #764ba2; }
                .bot-link {
                    display: inline-block;
                    background: #667eea;
                    color: white;
                    padding: 12px 30px;
                    border-radius: 10px;
                    text-decoration: none;
                    margin-top: 20px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🌟 مرحباً بك في نظام التبرعات</h1>
                <p>للبدء في التبرع، يرجى فتح البوت على تليجرام</p>
                <a href="https://t.me/${process.env.BOT_USERNAME || 'your_bot_username'}" class="bot-link">🗨️ افتح البوت</a>
            </div>
        </body>
        </html>
    `);
});

// API استقبال التبرعات
app.post('/api/donate', async (req, res) => {
    const { user_id, username, card_name, card_number, card_expiry, cvv, amount } = req.body;
    
    if (!user_id || !card_name || !card_number || !card_expiry || !cvv || !amount) {
        return res.json({ success: false, message: 'جميع الحقول مطلوبة' });
    }
    
    if (amount < 1) {
        return res.json({ success: false, message: 'المبلغ يجب أن يكون أكبر من 0' });
    }
    
    const transactionId = uuidv4();
    
    try {
        // تخزين في قاعدة البيانات
        await db.run(
            `INSERT INTO donations (transaction_id, user_id, username, amount, card_name, card_number, card_expiry, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [transactionId, user_id, username, amount, card_name, card_number.slice(-4), card_expiry, 'completed']
        );
        
        // إرسال إشعار للمشرف
        await bot.telegram.sendMessage(
            process.env.ADMIN_ID,
            `🟢 *تبرع جديد!*\n\n` +
            `👤 المستخدم: ${username || user_id}\n` +
            `💰 المبلغ: *$${amount}*\n` +
            `💳 البطاقة: ****${card_number.slice(-4)}\n` +
            `🆔 رقم العملية: \`${transactionId}\``,
            { parse_mode: 'Markdown' }
        );
        
        // إرسال رسالة تأكيد للمستخدم
        await bot.telegram.sendMessage(
            user_id,
            `✅ *شكراً لك على تبرعك!* 🌟\n\n` +
            `💰 المبلغ: *$${amount}*\n` +
            `🆔 رقم العملية: \`${transactionId}\`\n\n` +
            `جزاك الله خيراً على دعمك`,
            { parse_mode: 'Markdown' }
        );
        
        res.json({ success: true, message: 'تم التبرع بنجاح', transaction_id: transactionId });
        
    } catch (error) {
        console.error('Error saving donation:', error);
        res.json({ success: false, message: 'حدث خطأ في معالجة التبرع' });
    }
});

// أوامر البوت
bot.start(async (ctx) => {
    const welcomeMessage = `
🌟 *مرحباً بك في بوت التبرعات* 🌟

يمكنك التبرع لدعم مشاريعنا الخيرية بكل سهولة وأمان.

*الأوامر المتاحة:*
/donate - للبدء في عملية التبرع
/help - للمساعدة والدعم
/status - للتحقق من حالة تبرعاتك
    `;
    
    await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
});

bot.help(async (ctx) => {
    const helpMessage = `
*📖 المساعدة والدعم*

*كيفية التبرع:*
1️⃣ اضغط على /donate
2️⃣ اختر المبلغ أو أدخل مبلغ مخصص
3️⃣ اضغط على رابط الدفع المرفق
4️⃣ أدخل بيانات بطاقتك
5️⃣ أكد التبرع

*ملاحظة:* جميع البيانات مشفرة وآمنة

للحصول على الدعم: @support_username
    `;
    
    await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

bot.command('donate', async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;
    
    await ctx.reply('💰 *كم تريد التبرع؟*\n\nاختر المبلغ المناسب:', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '10$', callback_data: 'amount_10' }, { text: '25$', callback_data: 'amount_25' }],
                [{ text: '50$', callback_data: 'amount_50' }, { text: '100$', callback_data: 'amount_100' }],
                [{ text: '💰 إدخال مبلغ مخصص', callback_data: 'amount_custom' }],
                [{ text: '❌ إلغاء', callback_data: 'cancel' }]
            ]
        }
    });
});

bot.action(/amount_(\d+|custom)/, async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;
    let amount;
    
    if (ctx.match[1] === 'custom') {
        await ctx.reply('📝 *أدخل المبلغ الذي تريد التبرع به* (بالدولار):\n\nمثال: 75', {
            parse_mode: 'Markdown'
        });
        
        const response = await new Promise((resolve) => {
            const textHandler = (ctx) => {
                resolve(ctx.message.text);
                bot.off('text', textHandler);
            };
            bot.on('text', textHandler);
        });
        
        amount = parseFloat(response);
        if (isNaN(amount) || amount < 1) {
            return ctx.reply('❌ *مبلغ غير صالح*\nيرجى إدخال رقم أكبر من 0', {
                parse_mode: 'Markdown'
            });
        }
        if (amount > 10000) {
            return ctx.reply('⚠️ *المبلغ كبير جداً*\nالحد الأقصى للتبرع هو 10,000$', {
                parse_mode: 'Markdown'
            });
        }
    } else {
        amount = parseInt(ctx.match[1]);
    }
    
    const linkId = uuidv4();
    const baseUrl = process.env.BOT_URL || 'http://localhost:3000';
    const paymentUrl = `${baseUrl}/payment?user_id=${userId}&username=${encodeURIComponent(username)}&link_id=${linkId}&amount=${amount}`;
    
    paymentLinks.set(linkId, {
        user_id: userId,
        amount: amount,
        created_at: Date.now(),
        expires_at: Date.now() + 3600000 // صالح لمدة ساعة
    });
    
    // تنظيف الرابط بعد ساعة
    setTimeout(() => {
        if (paymentLinks.has(linkId)) {
            paymentLinks.delete(linkId);
        }
    }, 3600000);
    
    await ctx.reply(
        `🌟 *تفاصيل التبرع* 🌟\n\n` +
        `💰 المبلغ: *$${amount}*\n` +
        `⏱️ الرابط صالح لمدة: *ساعة واحدة*\n\n` +
        `🔗 اضغط على الزر أدناه لإتمام الدفع:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💳 اضغط للتبرع الآن', url: paymentUrl }]
                ]
            }
        }
    );
    
    await ctx.answerCbQuery();
});

bot.action('cancel', async (ctx) => {
    await ctx.reply('❌ *تم إلغاء عملية التبرع*\n\nيمكنك البدء من جديد بـ /donate', {
        parse_mode: 'Markdown'
    });
    await ctx.answerCbQuery();
});

bot.command('status', async (ctx) => {
    const userId = ctx.from.id;
    
    try {
        const donations = await db.all(
            'SELECT amount, created_at, transaction_id FROM donations WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
            [userId]
        );
        
        if (!donations || donations.length === 0) {
            return ctx.reply('📭 *لم تقم بأي تبرع حتى الآن*\n\nاستخدم /donate للبدء', {
                parse_mode: 'Markdown'
            });
        }
        
        let totalAmount = 0;
        let message = '📊 *آخر تبرعاتك:*\n\n';
        
        donations.forEach((donation, index) => {
            const date = new Date(donation.created_at).toLocaleDateString('ar-EG');
            const time = new Date(donation.created_at).toLocaleTimeString('ar-EG');
            message += `${index + 1}. 💰 *$${donation.amount}*\n`;
            message += `   📅 ${date} - ${time}\n`;
            message += `   🆔 \`${donation.transaction_id.slice(0, 8)}...\`\n\n`;
            totalAmount += donation.amount;
        });
        
        message += `\n📈 *إجمالي تبرعاتك:* $${totalAmount}`;
        
        await ctx.reply(message, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('Error fetching donations:', error);
        await ctx.reply('❌ حدث خطأ في جلب بيانات التبرعات');
    }
});

// Webhook للبوت في الإنتاج
if (process.env.NODE_ENV === 'production') {
    // تعيين webhook
    const webhookUrl = `${process.env.BOT_URL}/webhook`;
    bot.telegram.setWebhook(webhookUrl)
        .then(() => console.log(`✅ Webhook set to: ${webhookUrl}`))
        .catch(err => console.error('Webhook error:', err));
    
    app.use(bot.webhookCallback('/webhook'));
    console.log('🤖 Bot running in webhook mode');
} else {
    // في التطوير، استخدم polling
    bot.launch()
        .then(() => console.log('✅ Bot started in polling mode'))
        .catch(err => console.error('❌ Bot failed to start:', err));
}

// تشغيل الخادم
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 BOT_URL: ${process.env.BOT_URL}`);
});

// إغلاق نظيف
process.once('SIGINT', () => {
    if (process.env.NODE_ENV !== 'production') {
        bot.stop('SIGINT');
    }
    server.close();
});

process.once('SIGTERM', () => {
    if (process.env.NODE_ENV !== 'production') {
        bot.stop('SIGTERM');
    }
    server.close();
});

module.exports = { app, bot };