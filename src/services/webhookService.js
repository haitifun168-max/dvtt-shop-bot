const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const orderService = require('./orderService');
const userService = require('./userService');
const { deliverOrder } = require('../handlers/paymentConfirm');
const db = require('../database');

function extractPaymentCode(content) {
    if (!content) return null;
    const match = content.match(/NAP\s*PAY\s*-?\s*([A-Z0-9]{6})/i);
    if (match) {
        return `NAP PAY-${match[1].toUpperCase()}`;
    }
    return null;
}

function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach((cookie) => {
        const parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
    return list;
}

function startWebhookServer(bot) {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    let currentOtp = null;
    let otpExpiresAt = 0;

    // Automatically capture public URL from incoming host headers (to update Telegram buttons)
    app.use((req, res, next) => {
        const host = req.headers.host;
        if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
            config.PUBLIC_URL = `https://${host}`;
        }
        
        // Auto-login if token is in query parameters
        if (req.query.token && req.query.token === config.DASHBOARD_TOKEN) {
            res.setHeader('Set-Cookie', `admin_session=${config.DASHBOARD_TOKEN}; Path=/; HttpOnly; Max-Age=2592000`);
        }
        next();
    });

    function isAuthenticated(req) {
        const cookies = parseCookies(req.headers.cookie);
        const session = cookies.admin_session;
        if (session && session === config.DASHBOARD_TOKEN) {
            return true;
        }
        if (req.query.token && req.query.token === config.DASHBOARD_TOKEN) {
            return true;
        }
        return false;
    }

    app.post('/webhook/sepay', async (req, res) => {
        const authHeader = req.headers['authorization'];
        
        // Secure webhook: check key if configured
        if (config.SEPAY_API_KEY) {
            if (authHeader !== `Apikey ${config.SEPAY_API_KEY}`) {
                console.log('⚠️ Unauthorized webhook request (invalid API Key)');
                return res.status(401).json({ error: 'Unauthorized' });
            }
        }

        const tx = req.body;
        const rawContent = (tx.content || tx.transactionContent || '').trim();

        if (!tx || !rawContent) {
            return res.status(400).json({ error: 'Bad Request' });
        }

        const paymentCode = extractPaymentCode(rawContent);
        const amount = Math.abs(parseInt(tx.transferAmount || tx.amountIn || 0));

        console.log(`🏦 Nhận webhook SePay: "${rawContent}" (Mã trích xuất: ${paymentCode}) | Số tiền: ${amount}`);

        if (!paymentCode) {
            // Check if it's a test webhook from SePay
            if (rawContent.toUpperCase().includes('TEST') || rawContent.toUpperCase().includes('SEPAY')) {
                console.log(`🔍 Nhận webhook thử nghiệm từ SePay: "${rawContent}". Phản hồi OK.`);
                return res.json({ success: true, message: 'Test connection successful' });
            }

            console.log(`❓ Webhook: Không tìm thấy mã thanh toán hợp lệ trong nội dung chuyển khoản: "${rawContent}"`);
            return res.status(400).json({ error: 'Invalid payment code' });
        }

        try {
            // 1. Check if payment matches a pending order
            const order = orderService.getByPaymentCode(paymentCode);
            if (order) {
                if (order.status === 'pending') {
                    if (amount >= order.total_price) {
                        const result = await deliverOrder(bot, order.id);
                        if (result.success) {
                            console.log(`✅ Webhook auto-delivered order #${order.id}`);
                            return res.json({ success: true, message: `Order #${order.id} delivered` });
                        } else {
                            console.log(`❌ Webhook deliverOrder failed for order #${order.id}: ${result.error}`);
                            // Mark order as paid so admin can manual deliver
                            orderService.markPaid(order.id);
                            
                            // Notify admin about failed auto-delivery due to stock
                            await bot.telegram.sendMessage(config.ADMIN_ID, 
                                `⚠️ <b>LỖI GIAO HÀNG TỰ ĐỘNG</b>\n` +
                                `Đơn hàng <b>#${order.id}</b> đã thanh toán thành công qua Webhook nhưng không thể giao tự động: <i>${result.error}</i>\n` +
                                `Admin vui lòng giao hàng thủ công.`
                            , { parse_mode: 'HTML' });
                            
                            return res.json({ success: false, error: result.error });
                        }
                    } else {
                        console.log(`⚠️ Webhook order amount mismatch: order total is ${order.total_price}, transfer is ${amount}`);
                        return res.status(400).json({ error: 'Amount mismatch' });
                    }
                } else {
                    console.log(`ℹ️ Webhook order #${order.id} already processed (status: ${order.status})`);
                    return res.json({ success: true, message: 'Already processed' });
                }
            }

            // 2. Check if payment matches a pending deposit
            const deposit = db.prepare('SELECT * FROM deposits WHERE payment_code = ?').get(paymentCode);
            if (deposit) {
                if (deposit.status === 'pending') {
                    userService.addBalance(deposit.user_id, amount);
                    
                    db.prepare('UPDATE deposits SET status = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?')
                      .run('completed', deposit.id);

                    console.log(`✅ Webhook deposit success: +${amount}đ for user ${deposit.user_id}`);

                    // Notify customer
                    try {
                        const updatedUser = userService.get(deposit.user_id);
                        await bot.telegram.sendMessage(deposit.user_id, 
                            `💰 <b>NẠP SỐ DƯ THÀNH CÔNG!</b>\n\n` +
                            `Số tiền: <b>+${new Intl.NumberFormat('vi-VN').format(amount)}đ</b>\n` +
                            `Số dư hiện tại: <b>${new Intl.NumberFormat('vi-VN').format(updatedUser.balance)}đ</b>\n\n` +
                            `Cảm ơn bạn đã sử dụng dịch vụ!`,
                            { parse_mode: 'HTML' }
                        );
                    } catch (e) {
                        console.error('Failed to notify customer about deposit:', e.message);
                    }

                    // Notify Admin
                    try {
                        await bot.telegram.sendMessage(config.ADMIN_ID, 
                            `🔔 <b>GIAO DỊCH NẠP TIỀN THÀNH CÔNG</b>\n\n` +
                            `👤 Khách: <code>${deposit.user_id}</code>\n` +
                            `💰 Số tiền: <b>+${new Intl.NumberFormat('vi-VN').format(amount)}đ</b>\n` +
                            `🔑 Nội dung: <code>${paymentCode}</code> (Gốc: ${rawContent})`
                        , { parse_mode: 'HTML' });
                    } catch (e) {
                        console.error('Failed to notify admin about deposit:', e.message);
                    }

                    return res.json({ success: true, message: 'Deposit credited' });
                } else {
                    console.log(`ℹ️ Webhook deposit #${deposit.id} already processed (status: ${deposit.status})`);
                    return res.json({ success: true, message: 'Already processed' });
                }
            }

            console.log(`❓ Webhook: Không tìm thấy đơn hay giao dịch nạp tiền khớp với mã: ${paymentCode} (Nội dung gốc: "${rawContent}")`);
            return res.status(404).json({ error: 'Code not found' });

        } catch (err) {
            console.error('❌ Webhook error:', err.message);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // ═══════════════════════════════════════
    // WEB DASHBOARD ROUTES
    // ═══════════════════════════════════════

    // GET /admin/login
    app.get('/admin/login', (req, res) => {
        const filePath = path.join(__dirname, '..', 'public', 'login.html');
        if (fs.existsSync(filePath)) {
            res.send(fs.readFileSync(filePath, 'utf8'));
        } else {
            res.status(404).send('Login file not found');
        }
    });

    // POST /admin/api/send-otp
    app.post('/admin/api/send-otp', async (req, res) => {
        try {
            if (!config.ADMIN_ID) {
                return res.status(500).json({ error: 'Chưa cấu hình ADMIN_ID trong file .env' });
            }

            // Sinh mã OTP 6 chữ số ngẫu nhiên
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            currentOtp = otp;
            otpExpiresAt = Date.now() + 5 * 60 * 1000; // Hiệu lực 5 phút

            console.log(`🔑 Đã tạo OTP cho Admin: ${otp}`);

            // Gửi OTP tới Admin qua Telegram
            await bot.telegram.sendMessage(config.ADMIN_ID,
                `🔑 <b>XÁC THỰC ĐĂNG NHẬP DASHBOARD</b>\n\n` +
                `Mã xác thực OTP của bạn là: <code>${otp}</code>\n` +
                `Thời gian hiệu lực: <b>5 phút</b>.\n\n` +
                `⚠️ <i>Nếu không phải bạn thực hiện yêu cầu này, vui lòng bỏ qua.</i>`,
                { parse_mode: 'HTML' }
            );

            return res.json({ success: true, message: 'Mã OTP đã được gửi đến Telegram của Admin.' });
        } catch (err) {
            console.error('Lỗi gửi OTP:', err.message);
            return res.status(500).json({ error: 'Không thể gửi OTP qua Telegram. Vui lòng thử lại.' });
        }
    });

    // POST /admin/login
    app.post('/admin/login', (req, res) => {
        const { otp } = req.body;
        if (!config.DASHBOARD_TOKEN) {
            return res.status(500).json({ error: 'Chưa cấu hình DASHBOARD_TOKEN trong file .env' });
        }

        if (!otp) {
            return res.status(400).json({ error: 'Vui lòng nhập mã OTP' });
        }

        if (!currentOtp || Date.now() > otpExpiresAt) {
            return res.status(401).json({ error: 'Mã OTP đã hết hạn hoặc chưa được tạo. Vui lòng nhấn gửi lại mã.' });
        }

        if (otp === currentOtp) {
            // Hủy OTP sau khi sử dụng để tránh replay attack
            currentOtp = null;
            otpExpiresAt = 0;

            res.setHeader('Set-Cookie', `admin_session=${config.DASHBOARD_TOKEN}; Path=/; HttpOnly; Max-Age=2592000`);
            return res.json({ success: true });
        }

        return res.status(401).json({ error: 'Mã OTP không chính xác' });
    });

    // GET /admin/dashboard
    app.get('/admin/dashboard', (req, res) => {
        if (!isAuthenticated(req)) {
            return res.redirect('/admin/login');
        }
        const filePath = path.join(__dirname, '..', 'public', 'dashboard.html');
        if (fs.existsSync(filePath)) {
            res.send(fs.readFileSync(filePath, 'utf8'));
        } else {
            res.status(404).send('Dashboard file not found');
        }
    });

    // GET /admin/logout
    app.get('/admin/logout', (req, res) => {
        res.setHeader('Set-Cookie', 'admin_session=; Path=/; HttpOnly; Max-Age=0');
        res.redirect('/admin/login');
    });

    // GET /admin/api/stats
    app.get('/admin/api/stats', (req, res) => {
        if (!isAuthenticated(req)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            // 1. General KPI Stats
            const totalOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'delivered'").get().c;
            const totalRevenue = db.prepare("SELECT COALESCE(SUM(total_price), 0) as s FROM orders WHERE status = 'delivered'").get().s;
            const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c;
            const totalStock = db.prepare('SELECT COUNT(*) as c FROM stock WHERE is_sold = 0').get().c;
            const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;

            // 2. Best selling products
            const bestSellers = db.prepare(`
                SELECT p.name, COUNT(o.id) as sales_count, SUM(o.quantity) as total_qty, SUM(o.total_price) as product_revenue
                FROM orders o
                JOIN products p ON o.product_id = p.id
                WHERE o.status = 'delivered'
                GROUP BY o.product_id
                ORDER BY total_qty DESC
                LIMIT 5
            `).all();

            // 3. Last 7 days revenue for chart
            const weeklyRevenue = db.prepare(`
                SELECT date(delivered_at) as order_date, SUM(total_price) as daily_revenue, COUNT(id) as daily_orders
                FROM orders
                WHERE status = 'delivered' AND delivered_at >= date('now', '-7 days')
                GROUP BY order_date
                ORDER BY order_date ASC
            `).all();

            // 4. Products inventory
            const inventory = db.prepare(`
                SELECT p.id, p.name, p.sheet_stock, p.price,
                  (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) as real_stock
                FROM products p
                WHERE p.is_active = 1
            `).all();

            // 5. Recent 10 orders
            const recentOrders = db.prepare(`
                SELECT o.id, o.user_id, o.quantity, o.total_price, o.status, o.created_at, p.name as product_name, u.full_name as user_name
                FROM orders o
                JOIN products p ON o.product_id = p.id
                JOIN users u ON o.user_id = u.telegram_id
                ORDER BY o.created_at DESC
                LIMIT 10
            `).all();

            res.json({
                success: true,
                stats: {
                    totalOrders,
                    totalRevenue,
                    pendingOrders,
                    totalStock,
                    totalUsers
                },
                bestSellers,
                weeklyRevenue,
                inventory,
                recentOrders,
                shopName: config.SHOP_NAME
            });
        } catch (err) {
            console.error('API Stats Error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // GET /admin/api/products - Lấy danh mục và sản phẩm
    app.get('/admin/api/products', (req, res) => {
        if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
            const products = db.prepare(`
                SELECT p.*, c.name as category_name, c.emoji as category_emoji,
                  (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) as stock_count
                FROM products p
                JOIN categories c ON p.category_id = c.id
                ORDER BY p.category_id, p.id
            `).all();
            res.json({ success: true, categories, products });
        } catch (err) {
            console.error('API Products Error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // POST /admin/api/products/add - Thêm sản phẩm mới
    app.post('/admin/api/products/add', (req, res) => {
        if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const { category_id, name, price, emoji, promotion, contact_only } = req.body;
            if (!category_id || !name || !price) {
                return res.status(400).json({ error: 'Thiếu thông tin bắt buộc (Danh mục, Tên, Giá)' });
            }
            const result = db.prepare(
                'INSERT INTO products (category_id, name, price, emoji, promotion, contact_only) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(
                parseInt(category_id),
                name.trim(),
                parseInt(price),
                emoji || '📦',
                promotion || null,
                contact_only ? 1 : 0
            );
            res.json({ success: true, id: result.lastInsertRowid });
        } catch (err) {
            console.error('API Add Product Error:', err.message);
            res.status(500).json({ error: 'Không thể thêm sản phẩm' });
        }
    });

    // POST /admin/api/products/edit - Chỉnh sửa sản phẩm
    app.post('/admin/api/products/edit', (req, res) => {
        if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const { id, category_id, name, price, is_active, emoji, promotion, contact_only } = req.body;
            if (!id || !category_id || !name || !price) {
                return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
            }
            db.prepare(`
                UPDATE products 
                SET category_id = ?, name = ?, price = ?, is_active = ?, emoji = ?, promotion = ?, contact_only = ?
                WHERE id = ?
            `).run(
                parseInt(category_id),
                name.trim(),
                parseInt(price),
                is_active ? 1 : 0,
                emoji || '📦',
                promotion || null,
                contact_only ? 1 : 0,
                parseInt(id)
            );
            res.json({ success: true });
        } catch (err) {
            console.error('API Edit Product Error:', err.message);
            res.status(500).json({ error: 'Không thể chỉnh sửa sản phẩm' });
        }
    });

    // POST /admin/api/products/delete - Xóa sản phẩm
    app.post('/admin/api/products/delete', (req, res) => {
        if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Vui lòng cung cấp ID sản phẩm' });

            // Xóa kho chưa bán trước
            db.prepare('DELETE FROM stock WHERE product_id = ? AND is_sold = 0').run(parseInt(id));
            // Xóa sản phẩm
            db.prepare('DELETE FROM products WHERE id = ?').run(parseInt(id));
            res.json({ success: true });
        } catch (err) {
            console.error('API Delete Product Error:', err.message);
            res.status(500).json({ error: 'Không thể xóa sản phẩm' });
        }
    });

    // GET /admin/api/stock - Lấy danh sách tài khoản chưa bán của sản phẩm
    app.get('/admin/api/stock', (req, res) => {
        if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const { product_id } = req.query;
            if (!product_id) return res.status(400).json({ error: 'Thiếu ID sản phẩm' });

            const items = db.prepare('SELECT id, data FROM stock WHERE product_id = ? AND is_sold = 0 ORDER BY id DESC').all(parseInt(product_id));
            res.json({ success: true, items });
        } catch (err) {
            console.error('API Get Stock Error:', err.message);
            res.status(500).json({ error: 'Không thể lấy dữ liệu kho' });
        }
    });

    // POST /admin/api/stock/add - Nhập thêm kho sản phẩm
    app.post('/admin/api/stock/add', (req, res) => {
        if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const { product_id, stock_data } = req.body;
            if (!product_id || !stock_data) {
                return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
            }

            const lines = stock_data.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length === 0) {
                return res.status(400).json({ error: 'Dữ liệu nhập vào trống' });
            }

            const insert = db.prepare('INSERT INTO stock (product_id, data) VALUES (?, ?)');
            const insertMany = db.transaction((lines) => {
                for (const line of lines) {
                    insert.run(parseInt(product_id), line);
                }
            });
            insertMany(lines);

            res.json({ success: true, count: lines.length });
        } catch (err) {
            console.error('API Add Stock Error:', err.message);
            res.status(500).json({ error: 'Không thể thêm tài khoản vào kho' });
        }
    });

    // POST /admin/api/stock/delete - Xóa lẻ tài khoản trong kho
    app.post('/admin/api/stock/delete', (req, res) => {
        if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Thiếu ID kho' });

            db.prepare('DELETE FROM stock WHERE id = ? AND is_sold = 0').run(parseInt(id));
            res.json({ success: true });
        } catch (err) {
            console.error('API Delete Stock Item Error:', err.message);
            res.status(500).json({ error: 'Không thể xóa tài khoản khỏi kho' });
        }
    });

    // POST /admin/api/stock/clear - Xóa toàn bộ kho chưa bán của sản phẩm
    app.post('/admin/api/stock/clear', (req, res) => {
        if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const { product_id } = req.body;
            if (!product_id) return res.status(400).json({ error: 'Thiếu ID sản phẩm' });

            const result = db.prepare('DELETE FROM stock WHERE product_id = ? AND is_sold = 0').run(parseInt(product_id));
            res.json({ success: true, changes: result.changes });
        } catch (err) {
            console.error('API Clear Stock Error:', err.message);
            res.status(500).json({ error: 'Không thể xóa kho sản phẩm' });
        }
    });

    const port = config.WEBHOOK_PORT || 3000;
    app.listen(port, () => {
        console.log(`🌐 Webhook server đang lắng nghe tại cổng ${port}`);
    });
}

module.exports = { startWebhookServer };
