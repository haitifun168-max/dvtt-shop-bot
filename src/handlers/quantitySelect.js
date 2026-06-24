const productService = require('../services/productService');
const orderService = require('../services/orderService');
const paymentService = require('../services/paymentService');
const userService = require('../services/userService');
const messages = require('../utils/messages');
const config = require('../config');
const { Markup } = require('telegraf');
const { formatPrice } = require('../utils/keyboard');
const db = require('../database');

module.exports = (bot) => {
    // Handle quantity selection: qty_{productId}_{quantity}
    bot.action(/^qty_(\d+)_(\d+)$/, async (ctx) => {
        const productId = parseInt(ctx.match[1]);
        const quantity = parseInt(ctx.match[2]);
        const product = productService.getById(productId);

        if (!product) {
            return ctx.answerCbQuery('❌ Sản phẩm không tồn tại');
        }

        // Check stock availability (display_stock includes sheet_stock fallback)
        const availableStock = product.display_stock || product.stock_count;
        if (availableStock < quantity) {
            return ctx.answerCbQuery(`❌ Chỉ còn ${availableStock} sản phẩm`);
        }

        const user = userService.findOrCreate(ctx.from);
        const totalPrice = product.price * quantity;

        if (user.balance >= totalPrice) {
            ctx.answerCbQuery();
            const buttons = [
                [Markup.button.callback(`💵 Thanh toán số dư (${formatPrice(user.balance)})`, `pay_balance_${productId}_${quantity}`)],
                [Markup.button.callback('🏦 Chuyển khoản ngân hàng (VietQR)', `pay_bank_${productId}_${quantity}`)],
                [Markup.button.callback('❌ Hủy', 'cancel_order')]
            ];

            ctx.replyWithHTML(
                `📦 <b>${product.name}</b>\n` +
                `📊 Số lượng: ${quantity}\n` +
                `💵 Tổng tiền: <b>${formatPrice(totalPrice)}</b>\n\n` +
                `💰 Số dư của bạn: <b>${formatPrice(user.balance)}</b>\n\n` +
                `Vui lòng chọn phương thức thanh toán:`,
                Markup.inlineKeyboard(buttons)
            );
        } else {
            await proceedToBankTransfer(ctx, product, quantity);
        }
    });

    // Helper: proceed to bank transfer directly
    async function proceedToBankTransfer(ctx, product, quantity) {
        const banks = paymentService.getBanks();
        const productId = product.id;

        if (banks.length > 1) {
            // Multiple banks → show bank selection
            ctx.answerCbQuery();
            const totalPrice = product.price * quantity;
            const bankButtons = banks.map((b, i) =>
                [Markup.button.callback(`🏦 ${b.NAME}`, `bank_${productId}_${quantity}_${i}`)]
            );
            bankButtons.push([Markup.button.callback('❌ Hủy', 'cancel_order')]);

            ctx.replyWithHTML(
                `📦 <b>${product.name}</b>\n` +
                `📊 Số lượng: ${quantity}\n` +
                `💵 Tổng tiền: <b>${formatPrice(totalPrice)}</b>\n\n` +
                `🏦 Chọn ngân hàng thanh toán:`,
                Markup.inlineKeyboard(bankButtons)
            );
        } else {
            // Single bank → create order directly
            ctx.answerCbQuery('⏳ Đang tạo đơn hàng...');
            await createOrderAndPay(ctx, bot, product, quantity, 0);
        }
    }

    // Handle pay_bank: pay_bank_{productId}_{quantity}
    bot.action(/^pay_bank_(\d+)_(\d+)$/, async (ctx) => {
        const productId = parseInt(ctx.match[1]);
        const quantity = parseInt(ctx.match[2]);
        const product = productService.getById(productId);
        if (!product) return ctx.answerCbQuery('❌ Sản phẩm không tồn tại');

        const availableStock = product.display_stock || product.stock_count;
        if (availableStock < quantity) {
            return ctx.answerCbQuery(`❌ Chỉ còn ${availableStock} sản phẩm`);
        }

        ctx.answerCbQuery();
        await proceedToBankTransfer(ctx, product, quantity);
    });

    // Handle pay_balance: pay_balance_{productId}_{quantity}
    bot.action(/^pay_balance_(\d+)_(\d+)$/, async (ctx) => {
        const productId = parseInt(ctx.match[1]);
        const quantity = parseInt(ctx.match[2]);
        const product = productService.getById(productId);
        if (!product) return ctx.answerCbQuery('❌ Sản phẩm không tồn tại');

        const availableStock = product.display_stock || product.stock_count;
        if (availableStock < quantity) {
            return ctx.answerCbQuery(`❌ Chỉ còn ${availableStock} sản phẩm`);
        }

        const user = userService.findOrCreate(ctx.from);
        const totalPrice = product.price * quantity;

        if (user.balance < totalPrice) {
            return ctx.answerCbQuery('❌ Số dư không đủ');
        }

        ctx.answerCbQuery('⏳ Đang thanh toán...');

        // Deduct balance
        const deductSuccess = userService.deductBalance(ctx.from.id, totalPrice);
        if (!deductSuccess) {
            return ctx.reply('❌ Giao dịch thất bại. Vui lòng kiểm tra lại số dư.');
        }

        // Create order
        const paymentCode = `BAL PAY-${paymentService.generatePaymentCode().split('-')[1]}`;
        const order = orderService.create(
            ctx.from.id,
            product.id,
            quantity,
            totalPrice,
            paymentCode
        );

        ctx.editMessageText('💵 Đang thực hiện trừ tiền và chuẩn bị giao hàng...', { parse_mode: 'HTML' }).catch(() => {});

        // Deliver order
        const { deliverOrder } = require('./paymentConfirm');
        const result = await deliverOrder(bot, order.id);

        if (result.success) {
            ctx.replyWithHTML(`✅ <b>Đã thanh toán thành công bằng số dư!</b>\n` +
                              `├ Đơn hàng: <b>#${order.id}</b>\n` +
                              `├ Tổng tiền: -${formatPrice(totalPrice)}\n` +
                              `└ Số dư còn lại: <b>${formatPrice(user.balance - totalPrice)}</b>`);
            
            // Notify Admin
            const userName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
            const adminMsg = 
                `🔔 <b>ĐƠN HÀNG MỚI BẰNG SỐ DƯ #${order.id}</b>\n\n` +
                `👤 Khách: <b>${userName}</b> (<code>${ctx.from.id}</code>)\n` +
                (ctx.from.username ? `📱 @${ctx.from.username}\n` : '') +
                `\n` +
                `📦 Sản phẩm: <b>${product.name}</b>\n` +
                `📊 Số lượng: ${quantity}\n` +
                `💰 Tổng tiền: <b>${formatPrice(totalPrice)}</b> (Đã trừ số dư)\n` +
                `⚡ <b>Đã giao hàng tự động thành công!</b>`;
                
            bot.telegram.sendMessage(config.ADMIN_ID, adminMsg, { parse_mode: 'HTML' }).catch(() => {});
        } else {
            // Manual delivery needed (no stock items)
            orderService.markPaid(order.id);
            
            // Notify customer
            ctx.replyWithHTML(`💵 <b>Đã thanh toán số dư thành công!</b>\n\n` +
                              `Hiện tại mặt hàng này tạm hết kho tự động. Admin đang chuẩn bị tài khoản để giao thủ công cho bạn.\n` +
                              `├ Mã đơn: <b>#${order.id}</b>\n` +
                              `└ Trạng thái: ⏳ Đang chờ admin giao hàng`);
                              
            // Store state for admin manual delivery
            const { setAdminState } = require('./adminActions');
            setAdminState(config.ADMIN_ID, {
                action: 'deliver_order',
                orderId: order.id,
                userId: order.user_id,
                productName: product.name,
                quantity: order.quantity,
            });

            // Notify Admin about manual delivery
            const userName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
            const adminMsg = 
                `⚠️ <b>CẦN GIAO HÀNG THỦ CÔNG ĐƠN BẰNG SỐ DƯ #${order.id}</b>\n\n` +
                `👤 Khách: <b>${userName}</b> (<code>${ctx.from.id}</code>)\n` +
                `📦 Sản phẩm: <b>${product.name}</b>\n` +
                `📊 Số lượng: ${quantity}\n` +
                `💵 Tổng tiền: <b>${formatPrice(totalPrice)}</b> (Đã thanh toán số dư)\n\n` +
                `👇 Gửi thông tin tài khoản ngay bây giờ để giao cho khách:`;
                
            bot.telegram.sendMessage(config.ADMIN_ID, adminMsg, { parse_mode: 'HTML' }).catch(() => {});
        }
    });

    // Handle bank selection: bank_{productId}_{quantity}_{bankIndex}
    bot.action(/^bank_(\d+)_(\d+)_(\d+)$/, async (ctx) => {
        const productId = parseInt(ctx.match[1]);
        const quantity = parseInt(ctx.match[2]);
        const bankIndex = parseInt(ctx.match[3]);
        const product = productService.getById(productId);

        if (!product) {
            return ctx.answerCbQuery('❌ Sản phẩm không tồn tại');
        }

        const availableStock = product.display_stock || product.stock_count;
        if (availableStock < quantity) {
            return ctx.answerCbQuery(`❌ Chỉ còn ${availableStock} sản phẩm`);
        }

        ctx.answerCbQuery('⏳ Đang tạo đơn hàng...');
        await createOrderAndPay(ctx, bot, product, quantity, bankIndex);
    });

    // ════════════════════════════════════
    // Shared: Create order + send QR + notify admin
    // ════════════════════════════════════
    async function createOrderAndPay(ctx, bot, product, quantity, bankIndex) {
        userService.findOrCreate(ctx.from);

        const totalPrice = product.price * quantity;
        const payment = paymentService.generatePayment(totalPrice, bankIndex);

        const order = orderService.create(
            ctx.from.id,
            product.id,
            quantity,
            totalPrice,
            payment.paymentCode
        );

        // 1. Send QR code to customer
        const caption =
            `⏳ <b>Đang chờ thanh toán ${formatPrice(totalPrice)}...</b>\n\n` +
            `Quét mã QR phía trên để chuyển khoản.\n\n` +
            `💰 <b>THANH TOÁN ĐƠN HÀNG</b>\n\n` +
            `📦 Sản phẩm: ${product.name}\n` +
            `📊 Số lượng: ${quantity}\n` +
            `💵 Tổng tiền: <b>${formatPrice(totalPrice)}</b>\n\n` +
            `━━━━━━━━━━━━━━━━━\n\n` +
            `🏦 Quét mã QR để chuyển khoản\n` +
            `├ Số tiền: <b>${formatPrice(totalPrice)}</b>\n` +
            `└ Nội dung CK: <code>${payment.paymentCode}</code>\n\n` +
            `⏰ QR hiệu lực trong <b>15 phút</b>\n` +
            `🚫 <b>KHÔNG</b> thay đổi nội dung chuyển khoản\n` +
            `✅ Sau khi CK thành công, hàng sẽ được\ngiao <b>tự động</b> trong vòng dưới 60 giây`;

        await ctx.replyWithPhoto(payment.qrUrl, {
            caption,
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ Hủy thanh toán', `cancel_order_${order.id}`)],
            ]),
        });

        // 2. Notify Admin
        const userName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
        const adminMsg =
            `🔔 <b>ĐƠN HÀNG MỚI #${order.id}</b>\n\n` +
            `👤 Khách: <b>${userName}</b> (<code>${ctx.from.id}</code>)\n` +
            (ctx.from.username ? `📱 @${ctx.from.username}\n` : '') +
            `\n` +
            `📦 Sản phẩm: <b>${product.name}</b>\n` +
            `📊 Số lượng: ${quantity}\n` +
            `💰 Tổng tiền: <b>${formatPrice(totalPrice)}</b>\n` +
            `🏦 Bank: <b>${payment.bankName}</b>\n` +
            `🔑 Mã CK: <code>${payment.paymentCode}</code>\n\n` +
            `━━━━━━━━━━━━━━━━━\n` +
            `✅ Xác nhận & giao hàng:\n` +
            `<code>/confirm ${order.id}</code>`;

        try {
            await bot.telegram.sendMessage(config.ADMIN_ID, adminMsg, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback(`✅ Xác nhận #${order.id}`, `admin_confirm_${order.id}`),
                        Markup.button.callback(`❌ Hủy #${order.id}`, `admin_cancel_${order.id}`),
                    ],
                ]),
            });
        } catch (err) {
            console.error('Failed to notify admin:', err.message);
        }
    }

    // ════════════════════════════════════
    // Admin quick-action buttons on order notification
    // ════════════════════════════════════
    bot.action(/^admin_confirm_(\d+)$/, async (ctx) => {
        if (ctx.from.id !== config.ADMIN_ID) return ctx.answerCbQuery('⛔');

        const orderId = parseInt(ctx.match[1]);
        const order = orderService.getById(orderId);
        if (!order) return ctx.answerCbQuery('❌ Đơn hàng không tồn tại');
        if (order.status !== 'pending') return ctx.answerCbQuery('⚠️ Đơn đã xử lý');

        // Check if product has real stock entries in stock table
        const product = productService.getById(order.product_id);
        const realStock = productService.getAvailableStock(order.product_id, order.quantity);

        if (realStock.length >= order.quantity) {
            // ── AUTO DELIVERY: Has stock entries → deliver automatically ──
            ctx.answerCbQuery('⏳ Đang xử lý...');
            const { deliverOrder } = require('./paymentConfirm');
            const result = await deliverOrder(bot, orderId);

            if (result.success) {
                ctx.editMessageText(
                    ctx.callbackQuery.message.text + '\n\n✅ ĐÃ XÁC NHẬN & GIAO HÀNG TỰ ĐỘNG!',
                    { parse_mode: 'HTML' }
                );
            } else {
                ctx.reply(`❌ Lỗi đơn #${orderId}: ${result.error}`);
            }
        } else {
            // ── MANUAL DELIVERY: No stock entries → ask admin to provide account info ──
            ctx.answerCbQuery('📝 Cần cung cấp tài khoản...');
            orderService.markPaid(orderId);

            // Store state for admin to reply with account info
            const { setAdminState } = require('./adminActions');
            setAdminState(ctx.from.id, {
                action: 'deliver_order',
                orderId: orderId,
                userId: order.user_id,
                productName: product.name,
                quantity: order.quantity,
            });

            ctx.editMessageText(
                ctx.callbackQuery.message.text + '\n\n💳 ĐÃ XÁC NHẬN THANH TOÁN',
                { parse_mode: 'HTML' }
            );

            ctx.replyWithHTML(
                `📝 <b>GIAO HÀNG THỦ CÔNG — Đơn #${orderId}</b>\n\n` +
                `📦 SP: <b>${product.name}</b>\n` +
                `📊 SL: ${order.quantity}\n\n` +
                `👇 Gửi thông tin tài khoản ngay bây giờ:\n\n` +
                `<i>Ví dụ:</i>\n` +
                `<code>email@outlook.com|passmail|passchatgpt</code>\n\n` +
                `Bot sẽ tự động chuyển cho khách.\n` +
                `Gõ /cancel để hủy.`
            );
        }
    });

    bot.action(/^admin_cancel_(\d+)$/, (ctx) => {
        if (ctx.from.id !== config.ADMIN_ID) return ctx.answerCbQuery('⛔');

        const orderId = parseInt(ctx.match[1]);
        orderService.cancel(orderId);
        ctx.answerCbQuery('❌ Đã hủy');
        ctx.editMessageText(
            ctx.callbackQuery.message.text + '\n\n❌ ĐÃ HỦY ĐƠN HÀNG',
            { parse_mode: 'HTML' }
        );

        // Notify customer
        const order = orderService.getById(orderId);
        if (order) {
            bot.telegram.sendMessage(order.user_id, '❌ Đơn hàng của bạn đã bị hủy. Liên hệ hỗ trợ nếu cần.').catch(() => { });
        }
    });

    // Handle cancel order (customer side)
    bot.action('cancel_order', (ctx) => {
        ctx.answerCbQuery('❌ Đã hủy');
        ctx.editMessageText('❌ Đơn hàng đã bị hủy.');
    });

    bot.action(/^cancel_order_(\d+)$/, (ctx) => {
        const orderId = parseInt(ctx.match[1]);
        orderService.cancel(orderId);
        ctx.answerCbQuery('❌ Đã hủy đơn hàng');
        ctx.reply('❌ Đơn hàng đã bị hủy.');
    });
};
