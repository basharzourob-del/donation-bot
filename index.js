const express = require('express');
const { Telegraf } = require('telegraf');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const db = require('./database');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const paymentLinks = new Map();

// صفحة رئيسية
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>نظام التبرعات</title></head>
        <body style="text-align:center; padding:50px; font-family:Arial;">
            <h1>🌟 نظام التبرعات</h1>
            <p>البوت يعمل بنجاح!</p>
            <p>افتح تليجرام وابحث عن البوت للبدء</p>
        </body>
        </html>
    `);
});

// صفحة نموذج الدفع
app.get('/payment', (req, res) => {
    const { user_id, username, link_id } = req.query;
    
    if (!paymentLinks.has(link_id)) {
        return res.send('<h1>⚠️ رابط غير صالح</h1><p>الرابط منتهي الصلاحية. يرجى طلب رابط جديد من البوت.</p>');
    }
    
    res.sendFile(path.join(__dirname, 'payment-form.html'));
});

// استقبال التبرعات
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
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO donations (transaction_id, user_id, username, amount, card_name, card_number, card_expiry, status) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [transactionId, user_id, username, amount, card_name, card_number.slice(-4), card_expiry, 'completed'],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
        
        // إشعار للمشرف (إذا تم تعيين ADMIN_ID)
        if (process.env.ADMIN_ID && process.env.ADMIN_ID !== 'your_telegram_user_id') {
            await bot.telegram.sendMessage(
                process.env.ADMIN_ID,
                `🟢 تبرع جديد!\n\n👤 المستخدم: ${username || user_id}\n💰 المبلغ: $${amount}\n💳 البطاقة: ****${card_number.slice(-4)}`
            );
        }
        
        // رسالة تأكيد للمستخدم
        await bot.telegram.sendMessage(
            user_id,
            `✅ تم استلام تبرعك بنجاح! 🌟\n\n💰 المبلغ: $${amount}\n🆔 رقم العملية: ${transactionId.slice(0, 8)}\n\nشكراً لدعمك!`
        );
        
        res.json({ success: true, message: 'تم التبرع بنجاح! شكراً لك' });
        
    } catch (error) {
        console.error('Error:', error);
        res.json({ success: false, message: 'حدث خطأ، يرجى المحاولة مرة أخرى' });
    }
});

// أوامر البوت
bot.start((ctx) => {
    ctx.reply(`🌟 مرحباً بك في بوت التبرعات 🌟\n\nيمكنك التبرع لدعم مشاريعنا الخيرية.\n\nاستخدم /donate للبدء`);
});

bot.help((ctx) => {
    ctx.reply(`📖 المساعدة:\n\n/donate - للتبرع\n/status - لعرض تبرعاتك\n/help - هذه الرسالة`);
});

bot.command('donate', async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;
    
    await ctx.reply('💰 كم تريد التبرع؟\n\nاختر المبلغ:', {
        reply_markup: {
            inline_keyboard: [
                [{ text: '10$', callback_data: '10' }, { text: '25$', callback_data: '25' }],
                [{ text: '50$', callback_data: '50' }, { text: '100$', callback_data: '100' }],
                [{ text: '💰 مبلغ مخصص', callback_data: 'custom' }]
            ]
        }
    });
});

bot.action(/^\d+$/, async (ctx) => {
    const amount = parseInt(ctx.match[0]);
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;
    
    const linkId = uuidv4();
    const paymentUrl = `http://localhost:3000/payment?user_id=${userId}&username=${encodeURIComponent(username)}&link_id=${linkId}&amount=${amount}`;
    
    paymentLinks.set(linkId, {
        user_id: userId,
        amount: amount,
        created_at: Date.now()
    });
    
    setTimeout(() => paymentLinks.delete(linkId), 3600000);
    
    await ctx.reply(`🌟 تفاصيل التبرع:\n\n💰 المبلغ: $${amount}\n\n🔗 رابط الدفع:\n${paymentUrl}\n\n⚠️ الرابط صالح لمدة ساعة واحدة`, {
        reply_markup: {
            inline_keyboard: [[{ text: '💳 اضغط للتبرع', url: paymentUrl }]]
        }
    });
    
    await ctx.answerCbQuery();
});

bot.action('custom', async (ctx) => {
    await ctx.reply('📝 أدخل المبلغ الذي تريد التبرع به (بالدولار):\n\nمثال: 75');
    await ctx.answerCbQuery();
    
    const textHandler = async (ctx) => {
        const amount = parseFloat(ctx.message.text);
        if (isNaN(amount) || amount < 1) {
            return ctx.reply('❌ مبلغ غير صحيح. يرجى إدخال رقم أكبر من 0');
        }
        
        const userId = ctx.from.id;
        const username = ctx.from.username || ctx.from.first_name;
        const linkId = uuidv4();
        const paymentUrl = `http://localhost:3000/payment?user_id=${userId}&username=${encodeURIComponent(username)}&link_id=${linkId}&amount=${amount}`;
        
        paymentLinks.set(linkId, { user_id: userId, amount });
        setTimeout(() => paymentLinks.delete(linkId), 3600000);
        
        await ctx.reply(`🌟 تفاصيل التبرع:\n\n💰 المبلغ: $${amount}\n\n🔗 رابط الدفع:\n${paymentUrl}\n\n⚠️ الرابط صالح لمدة ساعة`, {
            reply_markup: {
                inline_keyboard: [[{ text: '💳 اضغط للتبرع', url: paymentUrl }]]
            }
        });
        
        bot.off('text', textHandler);
    };
    
    bot.on('text', textHandler);
});

bot.command('status', async (ctx) => {
    const userId = ctx.from.id;
    
    try {
        const donations = await new Promise((resolve, reject) => {
            db.all('SELECT amount, created_at FROM donations WHERE user_id = ? ORDER BY created_at DESC LIMIT 5', [userId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        if (!donations || donations.length === 0) {
            return ctx.reply('📭 لم تقم بأي تبرع حتى الآن\n\nاستخدم /donate للبدء');
        }
        
        let message = '📊 آخر تبرعاتك:\n\n';
        let total = 0;
        donations.forEach((d, i) => {
            const date = new Date(d.created_at).toLocaleDateString('ar-EG');
            message += `${i+1}. 💰 $${d.amount} - ${date}\n`;
            total += d.amount;
        });
        message += `\n📈 إجمالي التبرعات: $${total}`;
        
        ctx.reply(message);
    } catch (error) {
        console.error(error);
        ctx.reply('❌ حدث خطأ في جلب البيانات');
    }
});

// تشغيل الخادم
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    bot.launch();
    console.log('✅ Bot started successfully');
});

process.once('SIGINT', () => {
    bot.stop('SIGINT');
    process.exit();
});