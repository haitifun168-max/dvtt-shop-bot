const userService = require('../services/userService');
const messages = require('../utils/messages');

module.exports = (bot) => {
    const showMenu = (ctx) => {
        const user = userService.findOrCreate(ctx.from);
        ctx.replyWithHTML(messages.accountInfo(user));
    };

    bot.command('menu', showMenu);
    bot.hears('👤 Tài khoản', showMenu);
};
