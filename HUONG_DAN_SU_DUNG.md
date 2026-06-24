# 📖 HƯỚNG DẪN SỬ DỤNG TELEGRAM SHOP BOT

Tài liệu này hướng dẫn chi tiết cách sử dụng các tính năng của **Telegram Shop Bot (DVTT Shop)** dành cho cả **Khách hàng (Người mua)** và **Admin (Quản trị viên)**.

---

## 👤 PHẦN 1: HƯỚNG DẪN DÀNH CHO KHÁCH HÀNG

Khách hàng tương tác với Bot thông qua các nút bấm menu hoặc gõ trực tiếp lệnh chat.

### 1. Danh sách lệnh chính
*   `/start` — 🔄 Khởi động lại bot và hiển thị lời chào kèm menu chính.
*   `/menu` — 👤 Xem thông tin tài khoản (Telegram ID, Số dư ví, ngày tham gia).
*   `/product` — 📦 Xem danh mục và danh sách sản phẩm đang bán.
*   `/nap [số tiền]` — 💰 Nạp số dư vào ví (Ví dụ: `/nap 50000`).
*   `/checkpay` — 🔍 Xem trạng thái của 5 đơn hàng gần nhất.
*   `/support` — 🆘 Lấy thông tin liên hệ hỗ trợ khi gặp sự cố.
*   `/myid` — 🆔 Xem Telegram ID của bản thân.

### 2. Luồng mua hàng (Thanh toán trực tiếp bằng VietQR)
1.  Gõ `/product` hoặc nhấn nút **📦 Sản phẩm** trên menu chính.
2.  Chọn sản phẩm muốn mua → Chọn số lượng muốn mua.
3.  Nếu tài khoản không đủ số dư ví, hệ thống sẽ mặc định thanh toán bằng chuyển khoản ngân hàng:
    *   Hệ thống sẽ hiển thị ảnh mã **QR VietQR** cùng thông tin thanh toán chi tiết.
    *   **QUAN TRỌNG:** Khách hàng cần quét mã QR và giữ nguyên **Nội dung chuyển khoản** (ví dụ: `NAP PAY-XYZ123`), tuyệt đối không được sửa đổi.
4.  Sau khi thực hiện chuyển khoản thành công từ ứng dụng ngân hàng, hệ thống sẽ tự động giao hàng trong vòng 30 - 60 giây.
5.  Tài khoản đã mua sẽ được gửi trực tiếp dưới dạng tin nhắn của Bot.

### 3. Luồng mua hàng (Thanh toán bằng Số dư ví - Nhanh chóng)
1.  Nếu số dư ví hiện tại của bạn $\ge$ tổng giá trị đơn hàng, khi chọn số lượng, hệ thống sẽ hiển thị thêm lựa chọn: **"💵 Thanh toán số dư"**.
2.  Nhấn nút **"Thanh toán số dư"**.
3.  Hệ thống lập tức trừ tiền ví của bạn và gửi thông tin tài khoản mua được ngay lập tức mà không cần chờ đợi quét mã ngân hàng.

### 4. Luồng Nạp số dư vào ví (`/nap`)
1.  Gõ lệnh `/nap [số tiền muốn nạp]` (ví dụ: `/nap 100000`).
2.  Bot gửi ảnh mã **QR VietQR** chuyển khoản.
3.  Tiến hành chuyển khoản đúng số tiền và đúng **Nội dung chuyển khoản** được yêu cầu.
4.  Sau khi ngân hàng nhận được tiền, SePay sẽ gửi webhook báo về, Bot tự động cộng tiền vào ví của bạn và gửi tin nhắn chúc mừng kèm thông tin số dư mới.

---

## 🔧 PHẦN 2: HƯỚNG DẪN DÀNH CHO ADMIN

Admin điều hành toàn bộ hệ thống thông qua các lệnh chat (chỉ tài khoản có Telegram ID khớp với `ADMIN_ID` trong `.env` mới có quyền dùng).

### 1. Panel quản lý tổng quan
*   Gõ lệnh `/admin` để xem bảng thống kê nhanh và các phím tắt quản lý:
    *   Tổng số khách hàng, tổng doanh thu thực tế, tồn kho và đơn chờ.

### 2. Quản lý Sản phẩm & Danh mục
*   `/addcategory [tên] | [emoji]` — Thêm danh mục mới (ví dụ: `/addcategory Canva | 🎨`).
*   `/addproduct [catID] | [tên] | [giá]` — Thêm sản phẩm mới vào danh mục (ví dụ: `/addproduct 1 | Tài khoản Canva Pro 1 năm | 120000`).
*   `/listproduct` — Liệt kê tất cả sản phẩm kèm theo mã ID của chúng.
*   `/editprice [productID] [giá mới]` — Sửa giá của sản phẩm (ví dụ: `/editprice 2 95000`).
*   `/editname [productID] [tên mới]` — Đổi tên sản phẩm.
*   `/toggleproduct [productID]` — Bật (🟢) hoặc Tắt (🔴) trạng thái mở bán của sản phẩm.
*   `/deleteproduct [productID]` — Xóa hoàn toàn sản phẩm và các kho hàng chưa bán liên quan.

### 3. Quản lý Kho hàng (Stock)
*   **Thêm hàng vào kho:**
    1. Gõ `/addstock [productID]` (ví dụ: `/addstock 2`).
    2. Bot sẽ yêu cầu bạn gửi danh sách tài khoản. Bạn gửi danh sách tài khoản theo định dạng sau (mỗi tài khoản nằm trên một dòng):
       ```text
       tài_khoản_1|mật_khẩu_1|thông_tin_phụ_nếu_có
       tài_khoản_2|mật_khẩu_2|thông_tin_phụ_nếu_có
       ```
    3. Bot tự động lưu và báo số lượng tồn kho mới.
*   `/viewstock [productID]` — Xem danh sách các tài khoản đang có trong kho chưa bán của sản phẩm đó.
*   `/clearstock [productID]` — Xóa toàn bộ tài khoản chưa bán trong kho của sản phẩm đó.

### 4. Quản lý Đơn hàng (Orders)
*   `/pending` — Xem danh sách các đơn hàng khách đã tạo và đang chờ thanh toán.
*   `/confirm [orderID]` — Xác nhận thanh toán thủ công cho đơn hàng và giao hàng tự động cho khách (sử dụng khi hệ thống SePay gặp sự cố không tự kích hoạt được webhook).
*   `/cancelorder [orderID]` — Hủy đơn hàng và gửi tin nhắn báo cho khách.
*   `/orders` — Xem danh sách 20 đơn hàng gần nhất trong hệ thống.

### 5. Quản lý Ví Số dư của Khách hàng
*   `/addbalance [telegramID] [số tiền]` — Cộng tiền thủ công vào ví số dư của khách hàng (ví dụ: `/addbalance 123456789 50000`). Khách hàng sẽ nhận được thông báo biến động số dư.
*   `/deductbalance [telegramID] [số tiền]` — Trừ tiền ví của khách hàng.

### 6. Các lệnh khác
*   `/sync` — 🔄 Yêu cầu Bot đồng bộ ngay lập tức dữ liệu sản phẩm từ Google Sheets (nếu cấu hình).
*   `/users` — Xem danh sách 20 người dùng đăng ký gần nhất và số dư của họ.
*   `/broadcast` — Gửi thông báo hàng loạt cho toàn bộ người dùng trong hệ thống:
    1. Gõ `/broadcast`
    2. Gửi nội dung tin nhắn cần truyền thông (hỗ trợ các thẻ định dạng HTML như `<b>`, `<i>`, `<code>`,...).
    3. Bot gửi thông báo và báo kết quả thành công/thất bại.

---

## 🛠️ PHẦN 3: ĐỒNG BỘ GOOGLE SHEET & CẤU HÌNH WEBHOOK (NÂNG CAO)

### 1. Đồng bộ sản phẩm qua Google Sheets
Hệ thống tự động quét và cập nhật giá bán, tồn kho, ẩn/hiện sản phẩm từ file Google Sheet mỗi 5 phút (hoặc khi chạy `/sync`).
*   **Các cột trên Sheet cần tuân thủ:**
    *   **Cột A (ID):** Mã số sản phẩm (trùng khớp với ID sản phẩm trên bot).
    *   **Cột B:** Tên sản phẩm.
    *   **Cột C:** Giá bán (chỉ nhập số).
    *   **Cột D:** Đơn vị tính (ví dụ: *tài khoản*, *tháng*).
    *   **Cột E:** Số lượng tồn kho ảo (hiển thị khi kho thực tế của bot trống).
    *   **Cột F:** Còn hàng (Điền `TRUE` để mở bán, `FALSE` để ẩn).
    *   **Cột G:** Link liên hệ (ví dụ: link Zalo của bạn khi sản phẩm cần liên hệ trực tiếp để mua).
    *   **Cột H:** Ghi chú/Khuyến mãi (sẽ hiển thị dạng thẻ tag khuyến mãi).

### 2. Cấu hình Webhook SePay
Để tự động nhận diện thanh toán:
1.  Truy cập trang quản trị SePay.
2.  Tạo tích hợp Webhook mới.
3.  Điền URL webhook trỏ về địa chỉ IP máy chủ của bạn với endpoint:
    `http://[IP-MAY-CHU]:3000/webhook/sepay`
4.  Cấu hình giá trị `SEPAY_API_KEY` khớp giữa tài khoản SePay và file `.env` của bạn để bảo mật giao dịch.
