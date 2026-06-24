const orderService = require('../services/orderService');
const productService = require('../services/productService');
const messages = require('../utils/messages');
const { postDeliveryKeyboard } = require('../utils/keyboard');

module.exports = (bot) => {
    // User clicks "Đã thanh toán" button
    bot.action(/^check_paid_(\d+)$/, async (ctx) => {
        const orderId = parseInt(ctx.match[1]);
        const order = orderService.getById(orderId);

        if (!order) {
            return ctx.answerCbQuery('❌ Đơn hàng không tồn tại');
        }

        if (order.status === 'delivered') {
            return ctx.answerCbQuery('✅ Đơn hàng đã được giao');
        }

        if (order.status === 'cancelled') {
            return ctx.answerCbQuery('❌ Đơn hàng đã bị hủy');
        }

        // For now, show pending message (admin needs to confirm)
        ctx.answerCbQuery();
        ctx.replyWithHTML(messages.paymentPending);
    });

    // Data main callback
    bot.action('data_main', (ctx) => {
        ctx.answerCbQuery();
        ctx.reply('📊 Tính năng đang phát triển...');
    });

    // Buy again callback
    bot.action('buy_again', (ctx) => {
        ctx.answerCbQuery();
        // Trigger product listing
        const products = productService.getAll();
        const { productListKeyboard } = require('../utils/keyboard');
        ctx.reply(messages.productHeader, productListKeyboard(products));
    });

    // View delivered accounts callback
    bot.action(/^view_rec_(\d+)$/, async (ctx) => {
        const orderId = parseInt(ctx.match[1]);
        const order = orderService.getById(orderId);

        if (!order) {
            return ctx.answerCbQuery('❌ Đơn hàng không tồn tại');
        }

        // Security check
        if (order.user_id !== ctx.from.id) {
            return ctx.answerCbQuery('⛔ Bạn không có quyền xem thông tin đơn hàng này.');
        }

        if (order.status !== 'delivered' || !order.delivered_data) {
            return ctx.answerCbQuery('❌ Đơn hàng chưa có thông tin tài khoản.');
        }

        ctx.answerCbQuery();

        try {
            const accounts = JSON.parse(order.delivered_data);
            const product = productService.getById(order.product_id);
            
            let msg =
                `🔑 <b>Thông tin tài khoản đơn hàng #${order.id}:</b>\n\n` +
                `📦 Sản phẩm: ${product ? product.name : order.product_name}\n` +
                `📊 Số lượng: ${order.quantity}\n\n` +
                `🔐 <b>Danh sách tài khoản:</b>\n`;

            accounts.forEach((acc, i) => {
                msg += `${i + 1})\n<code>${acc}</code>\n`;
            });

            msg += `\n📖 <b>Hướng dẫn:</b> maill | passmail | passchatgpt\n` +
                `log vào outlook.com để lấy code nha các bạn`;

            await ctx.replyWithHTML(msg);
        } catch (err) {
            console.error('Failed to parse delivered_data:', err.message);
            ctx.reply('❌ Đã xảy ra lỗi khi đọc thông tin tài khoản.');
        }
    });
};

/**
 * Deliver order (called by admin confirm or webhook)
 */
async function deliverOrder(bot, orderId) {
    const result = orderService.confirmAndDeliver(orderId);

    if (!result.success) {
        return result;
    }

    const order = result.order;
    const product = productService.getById(order.product_id);

    try {
        // Send success notification
        await bot.telegram.sendMessage(
            order.user_id,
            messages.orderSuccessNotify(order.quantity),
            { parse_mode: 'HTML' }
        );

        // Send account details
        await bot.telegram.sendMessage(
            order.user_id,
            messages.orderSuccess(product, order.quantity, result.accounts),
            {
                parse_mode: 'HTML',
                ...postDeliveryKeyboard(),
            }
        );
    } catch (err) {
        console.error(`Failed to send delivery to ${order.user_id}:`, err.message);
    }

    return result;
}

module.exports.deliverOrder = deliverOrder;
