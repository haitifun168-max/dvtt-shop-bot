const orderService = require('../services/orderService');
const messages = require('../utils/messages');
const { Markup } = require('telegraf');

module.exports = (bot) => {
    const handleCheckPay = (ctx) => {
        const orders = orderService.getRecentByUser(ctx.from.id, 5);

        if (orders.length === 0) {
            return ctx.reply('📋 Bạn chưa có đơn hàng nào.');
        }

        let text = '🔍 <b>ĐƠN HÀNG GẦN ĐÂY</b>\n\n';
        orders.forEach((order) => {
            text += messages.checkPayStatus(order) + '\n\n━━━━━━━━━━━━━━━━━\n\n';
        });

        const buttons = [];
        orders.forEach((order) => {
            if (order.status === 'delivered' && order.delivered_data) {
                buttons.push([Markup.button.callback(`🔑 Xem tài khoản #${order.id}`, `view_rec_${order.id}`)]);
            } else if (order.status === 'pending') {
                buttons.push([Markup.button.callback(`💳 Check thanh toán #${order.id}`, `check_paid_${order.id}`)]);
            }
        });

        if (buttons.length > 0) {
            ctx.replyWithHTML(text, Markup.inlineKeyboard(buttons));
        } else {
            ctx.replyWithHTML(text);
        }
    };

    bot.command('checkpay', handleCheckPay);
    bot.hears('🔍 Kiểm tra thanh toán', handleCheckPay);
};
