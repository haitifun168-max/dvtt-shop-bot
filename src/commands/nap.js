const paymentService = require('../services/paymentService');
const messages = require('../utils/messages');
const { formatPrice } = require('../utils/keyboard');
const userService = require('../services/userService');
const db = require('../database');

module.exports = (bot) => {
    const handleNap = (ctx, amountStr) => {
        if (!amountStr || isNaN(amountStr)) {
            return ctx.replyWithHTML(
                '💰 <b>NẠP SỐ DƯ</b>\n\n' +
                'Cách dùng: /nap [số tiền]\n' +
                'Ví dụ: /nap 50000\n\n' +
                '💡 Số tiền tối thiểu: 10.000đ'
            );
        }

        const amount = parseInt(amountStr);
        if (amount < 10000) {
            return ctx.reply('❌ Số tiền tối thiểu là 10.000đ');
        }

        // Ensure user exists in database
        userService.findOrCreate(ctx.from);

        const payment = paymentService.generatePayment(amount);

        // Record deposit request in database
        db.prepare('INSERT INTO deposits (user_id, amount, payment_code) VALUES (?, ?, ?)')
          .run(ctx.from.id, amount, payment.paymentCode);

        // Send QR image
        ctx.replyWithPhoto(payment.qrUrl, {
            caption:
                `💰 <b>NẠP SỐ DƯ</b>\n\n` +
                `Quét mã QR để nạp ${formatPrice(amount)} vào tài khoản.\n\n` +
                `🏦 Quét mã QR để chuyển khoản\n` +
                `├ Số tiền: <b>${formatPrice(amount)}</b>\n` +
                `└ Nội dung CK: <code>${payment.paymentCode}</code>\n\n` +
                `⏳ Sau khi chuyển khoản, số dư sẽ được cập nhật tự động.`,
            parse_mode: 'HTML',
        });
    };

    bot.command('nap', (ctx) => {
        const text = ctx.message.text.split(' ');
        handleNap(ctx, text[1]);
    });

    bot.hears('💰 Nạp tiền', (ctx) => {
        handleNap(ctx, null);
    });
};
