const { Telegraf, session } = require('telegraf');
const config = require('./config');

// Validate token
if (!config.BOT_TOKEN || config.BOT_TOKEN === 'your_bot_token_here') {
    console.error('❌ BOT_TOKEN chưa được cấu hình! Hãy cập nhật file .env');
    process.exit(1);
}

const bot = new Telegraf(config.BOT_TOKEN);

// Debug logging middleware
bot.use((ctx, next) => {
    console.log(`[Debug Update] Type: ${ctx.updateType} | From: ${ctx.from?.id} (${ctx.from?.username}) | Text/Data: ${ctx.message?.text || ctx.callbackQuery?.data || 'None'}`);
    return next();
});

// Enable session for admin stock input
bot.use(session());

// Error handler
bot.catch((err, ctx) => {
    console.error(`❌ Error for ${ctx.updateType}:`, err.message);
    try {
        ctx.reply('❌ Đã xảy ra lỗi. Vui lòng thử lại sau.');
    } catch (e) {
        // ignore
    }
});

// Register commands
require('./commands/start')(bot);
require('./commands/menu')(bot);
require('./commands/product')(bot);
require('./commands/nap')(bot);
require('./commands/checkpay')(bot);
require('./commands/support')(bot);
require('./commands/myid')(bot);

// Register handlers
require('./handlers/productSelect')(bot);
require('./handlers/quantitySelect')(bot);
require('./handlers/paymentConfirm')(bot);
require('./handlers/adminActions')(bot);

// Set bot commands for menu
bot.telegram.setMyCommands([
    { command: 'start', description: '🔄 Bắt đầu / Khởi động lại' },
    { command: 'menu', description: '👤 Thông tin tài khoản' },
    { command: 'product', description: '📦 Danh sách sản phẩm' },
    { command: 'nap', description: '💰 Nạp số dư' },
    { command: 'checkpay', description: '🔍 Kiểm tra thanh toán' },
    { command: 'support', description: '🆘 Hỗ trợ' },
    { command: 'myid', description: '🆔 Lấy ID của bạn' },
]);

// Launch bot
bot.launch()
    .then(() => {
        console.log(`🤖 ${config.SHOP_NAME} Bot đã khởi động!`);
        console.log(`👤 Admin ID: ${config.ADMIN_ID}`);
        console.log(`🏦 Bank: ${config.BANK.NAME} - ${config.BANK.ACCOUNT}`);
        
        // Fetch and save bot username dynamically
        bot.telegram.getMe().then((me) => {
            config.BOT_USERNAME = me.username;
            console.log(`👤 Bot Username: @${me.username}`);
        }).catch((err) => {
            console.error('⚠️ Không thể lấy thông tin Bot Username:', err.message);
        });
    })
    .catch((err) => {
        console.error('❌ Không thể khởi động bot:', err.message);
        console.error('💡 Kiểm tra lại BOT_TOKEN trong file .env');
        process.exit(1);
    });

// Start Webhook server
const { startWebhookServer } = require('./services/webhookService');
startWebhookServer(bot);

// Prevent crash on network errors
process.on('unhandledRejection', (err) => {
    console.error('⚠️ Unhandled rejection (ignored):', err.message || err);
});
process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught exception:', err.message || err);
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        console.log('🔄 Network error, bot continues running...');
        return; // Don't crash on network errors
    }
    process.exit(1);
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
